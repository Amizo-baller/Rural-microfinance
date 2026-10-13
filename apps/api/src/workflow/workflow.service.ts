import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { keccak256, toUtf8Bytes } from 'ethers';
import { PrismaService } from '../prisma.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { StartPaymentDto, ReviewPaymentDto } from './dto';

export type WorkflowActor = { sub: string; role: string };
export const REVIEW_ROLES = ['TREASURER', 'GROUP_MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const memberSelect = { id: true, memberId: true, firstName: true, lastName: true } as const;

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService, private readonly gateway: PaymentGatewayService) {}
  private reviewer(actor: WorkflowActor) { return REVIEW_ROLES.includes(actor.role); }
  private groupScope(actor: WorkflowActor): Prisma.CommunityGroupWhereInput {
    return actor.role === 'GROUP_MANAGER' ? { managerId: actor.sub } : {};
  }
  private paymentScope(actor: WorkflowActor): Prisma.PaymentSubmissionWhereInput {
    return this.reviewer(actor) ? { group: this.groupScope(actor) } : { userId: actor.sub };
  }
  private async ownedMember(memberId: string, actor: WorkflowActor) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { id: true, memberId: true, email: true, firstName: true, lastName: true, status: true, memberships: { include: { group: true } } } });
    if (!user || user.status !== 'ACTIVE' || user.memberId !== memberId.trim()) throw new ForbiddenException('Enter your own registered member ID.');
    const membership = user.memberships.find((row) => row.status === 'ACTIVE' && row.group.status === 'ACTIVE');
    if (!membership) throw new ConflictException('An active community-group membership is required. Ask the group manager to add your account.');
    return { user, membership };
  }
  private week(value?: string) {
    const date = value ? new Date(value + 'T00:00:00Z') : new Date();
    if (!Number.isFinite(date.getTime()) || (value && date.toISOString().slice(0, 10) !== value) || date.getTime() > Date.now()) throw new BadRequestException('Choose a valid contribution week, not a future date.');
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date;
  }
  private async payment(id: string, actor: WorkflowActor, receipt = false) {
    const row = await this.prisma.paymentSubmission.findFirst({ where: { id, ...this.paymentScope(actor) }, include: { user: { select: memberSelect }, reviewer: { select: memberSelect }, group: { select: { id: true, name: true } } } });
    if (!row) throw new NotFoundException('Payment submission not found.');
    return receipt ? row : { ...row, receipt: undefined, hasReceipt: Boolean(row.receipt) };
  }
  async summary(actor: WorkflowActor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.sub }, select: { memberId: true, memberships: { select: { groupId: true } } } });
    const groups = this.reviewer(actor) ? this.groupScope(actor) : { id: { in: user.memberships.map((m) => m.groupId) } };
    const savingsWhere: Prisma.SavingsAccountWhereInput = this.reviewer(actor) ? { currency: 'SLE', groupMember: { group: groups } } : { currency: 'SLE', groupMember: { userId: actor.sub } };
    const [total, groupTotal, unread, pending, loans] = await Promise.all([
      this.prisma.savingsAccount.aggregate({ where: savingsWhere, _sum: { balance: true } }),
      this.prisma.savingsAccount.aggregate({ where: { currency: 'SLE', groupMember: { group: groups } }, _sum: { balance: true } }),
      this.prisma.notification.count({ where: { userId: actor.sub, status: { not: 'READ' } } }),
      this.prisma.paymentSubmission.count({ where: { ...this.paymentScope(actor), status: 'SUBMITTED' } }),
      this.prisma.loan.findMany({ where: { groupMember: { userId: actor.sub }, status: 'ACTIVE' }, select: { id: true, loanReference: true, outstandingBalance: true, currency: true } }),
    ]);
    return { memberId: user.memberId, totalSavings: total._sum.balance ?? 0, groupSavings: groupTotal._sum.balance ?? 0, unread, pending, canReview: this.reviewer(actor), gatewayConfigured: this.gateway.configured(), loans };
  }
  async start(dto: StartPaymentDto, actor: WorkflowActor) {
    const { user, membership } = await this.ownedMember(dto.memberId, actor);
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('The payment amount must be positive.');
    if (!this.gateway.configured()) throw new ConflictException('The treasurer has not configured online checkout yet. No payment has been taken.');
    let currency = 'SLE';
    if (dto.kind === 'REPAYMENT') {
      const loan = await this.prisma.loan.findFirst({ where: { id: dto.loanId ?? '', groupMemberId: membership.id, status: 'ACTIVE' } });
      if (!loan || amount.gt(loan.outstandingBalance)) throw new ConflictException('Choose your active loan and an amount within its outstanding balance.');
      currency = loan.currency;
    }
    const reference = `PAY-${dto.requestId}`;
    let row = await this.prisma.paymentSubmission.findUnique({ where: { reference } });
    if (row && (row.userId !== actor.sub || row.kind !== dto.kind || !row.amount.equals(amount) || row.loanId !== (dto.loanId ?? null))) throw new ConflictException('This payment reference is already in use for different details.');
    const email = dto.receiptEmail?.trim() || user.email;
    if (!email) throw new BadRequestException('Enter an email address for the gateway payment receipt.');
    if (!row) {
      try { row = await this.prisma.paymentSubmission.create({ data: { userId: actor.sub, groupId: membership.groupId, loanId: dto.kind === 'REPAYMENT' ? dto.loanId : null, kind: dto.kind, currency, amount, reference, weekStart: dto.kind === 'CONTRIBUTION' ? this.week(dto.weekStart) : null } }); }
      catch (error) { if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This payment request is already being started. Refresh and use its existing checkout.'); throw error; }
    }
    if (row.status !== 'AWAITING_PAYMENT') return this.payment(row.id, actor);
    if (!row.checkoutUrl) {
      const checkout = await this.gateway.checkout(reference, amount, email, `${user.firstName} ${user.lastName}`, row.currency);
      await this.prisma.paymentSubmission.update({ where: { id: row.id }, data: { gateway: checkout.gateway, checkoutUrl: checkout.url } });
    }
    return this.payment(row.id, actor);
  }
  async verifyPayment(id: string, actor: WorkflowActor) {
    const row = await this.payment(id, actor);
    if (row.userId !== actor.sub) throw new ForbiddenException('Only the paying member can verify this checkout.');
    if (row.gatewayPaidAt) return row;
    if (!row.gateway) throw new ConflictException('Start online checkout first.');
    const gatewayId = await this.gateway.verify(row.reference, row.amount, row.gateway, row.currency);
    try {
      await this.prisma.paymentSubmission.updateMany({ where: { id, status: 'AWAITING_PAYMENT', gatewayPaidAt: null }, data: { status: 'PAID', gatewayId, gatewayPaidAt: new Date() } });
    } catch (error) { if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This gateway transaction has already been used.'); throw error; }
    return this.payment(id, actor);
  }
  async submitReceipt(id: string, receipt: string, actor: WorkflowActor) {
    const row = await this.payment(id, actor);
    if (row.userId !== actor.sub) throw new ForbiddenException('Only the paying member can submit a receipt.');
    if (!row.gatewayPaidAt || !['PAID','REJECTED'].includes(row.status)) throw new ConflictException('Verify a successful gateway payment before submitting a receipt.');
    const match = receipt.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('Attach a PNG or JPEG receipt.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 2000000 || bytes.length < 8 || !(match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216)) throw new BadRequestException('Receipt image is invalid or exceeds 2 MB.');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentSubmission.updateMany({ where: { id, status: row.status }, data: { receipt, status: 'SUBMITTED', submittedAt: new Date(), reviewerId: null, reviewedAt: null, reviewNotes: null } });
      if (!updated.count) throw new ConflictException('This receipt has already been submitted.');
      const staff = await tx.user.findMany({ where: { status: 'ACTIVE', OR: [{ role: { name: { in: ['TREASURER','ADMIN','SUPER_ADMIN'] } } }, { managedGroups: { some: { id: row.groupId } } }] }, select: { id: true } });
      await tx.notification.createMany({ data: staff.map((person) => ({ userId: person.id, title: 'Payment awaiting confirmation', message: `Member ${row.user.memberId} submitted SLE ${row.amount.toFixed(2)}. Reference ${row.reference}.`, type: 'GENERAL', status: 'SENT', sentAt: new Date() })) });
    });
    return this.payment(id, actor);
  }
  async list(actor: WorkflowActor, page = 1) {
    const where = this.paymentScope(actor);
    const [items, total] = await Promise.all([
      this.prisma.paymentSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page-1)*20, take: 20, omit: { receipt: true }, include: { user: { select: memberSelect }, reviewer: { select: memberSelect }, group: { select: { name: true } } } }),
      this.prisma.paymentSubmission.count({ where }),
    ]);
    return { items, total, page, limit: 20 };
  }
  async receipt(id: string, actor: WorkflowActor) { const row = await this.payment(id, actor, true); return { receipt: row.receipt }; }

  async review(id: string, dto: ReviewPaymentDto, actor: WorkflowActor) {
    if (!this.reviewer(actor)) throw new ForbiddenException('Treasurer or group manager confirmation is required.');
    const row = await this.payment(id, actor, true);
    if (row.userId === actor.sub) throw new ForbiddenException('You cannot confirm your own payment.');
    if (row.status !== 'SUBMITTED' || !row.receipt || !row.gatewayPaidAt || !row.gateway) throw new ConflictException('A verified payment and submitted receipt are required.');
    if (dto.decision === 'REJECT' && !dto.notes?.trim()) throw new BadRequestException('State the reason for rejecting this receipt.');
    // Recheck the provider before applying a credit; member screenshots cannot authorize a credit.
    await this.gateway.verify(row.reference, row.amount, row.gateway, row.currency);
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentSubmission.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: dto.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED', reviewedAt, reviewerId: actor.sub, reviewNotes: dto.notes?.trim() } });
      if (!claimed.count) throw new ConflictException('This payment was already reviewed.');
      if (dto.decision === 'REJECT') {
        await tx.notification.create({ data: { userId: row.userId, title: 'Receipt needs correction', message: `Payment ${row.reference}: ${dto.notes}. Your gateway payment remains recorded; correct the receipt and resubmit or contact the treasurer.`, type: 'GENERAL', status: 'SENT', sentAt: reviewedAt } });
        await tx.auditLog.create({ data: { userId: actor.sub, action: 'PAYMENT_RECEIPT_REJECTED', entityType: 'PaymentSubmission', entityId: id, newValues: { notes: dto.notes ?? '', reviewedAt: reviewedAt.toISOString() } } });
        return;
      }
      const membership = await tx.groupMember.findFirst({ where: { userId: row.userId, groupId: row.groupId, status: 'ACTIVE', group: { status: 'ACTIVE' } } });
      if (!membership) throw new ConflictException('The member or community is no longer active.');
      let contributionId: string | undefined, repaymentId: string | undefined;
      if (row.kind === 'CONTRIBUTION') {
        const account = await tx.savingsAccount.upsert({ where: { groupMemberId_currency: { groupMemberId: membership.id, currency: 'SLE' } }, create: { groupMemberId: membership.id, currency: 'SLE', accountNumber: `SAV-SLE-${membership.id.replaceAll('-', '').toUpperCase()}` }, update: {} });
        if (account.status !== 'ACTIVE') throw new ConflictException('The savings account is not active.');
        const entry = await tx.contribution.create({ data: { savingsAccountId: account.id, groupMemberId: membership.id, currency: row.currency, amount: row.amount, reference: row.reference, contributionDate: row.gatewayPaidAt!, paymentMethod: 'CARD', description: `Weekly contribution: ${row.weekStart?.toISOString().slice(0,10)}`, status: 'CONFIRMED' } });
        contributionId = entry.id;
        await tx.savingsAccount.update({ where: { id: account.id }, data: { balance: { increment: row.amount } } });
      } else {
        const loan = await tx.loan.findFirst({ where: { id: row.loanId!, groupMemberId: membership.id, status: 'ACTIVE' } });
        if (!loan || row.amount.gt(loan.outstandingBalance)) throw new ConflictException('This repayment exceeds the current loan balance. Contact the treasurer for correction/refund.');
        const remaining = loan.outstandingBalance.minus(row.amount);
        const changed = await tx.loan.updateMany({ where: { id: loan.id, status: 'ACTIVE', outstandingBalance: { gte: row.amount } }, data: { outstandingBalance: { decrement: row.amount }, status: remaining.isZero() ? 'COMPLETED' : 'ACTIVE' } });
        if (!changed.count) throw new ConflictException('Loan balance changed; refresh before confirming.');
        const entry = await tx.loanRepayment.create({ data: { loanId: loan.id, groupMemberId: membership.id, currency: row.currency, amount: row.amount, principalPaid: row.amount, interestPaid: 0, paidAt: row.gatewayPaidAt!, reference: row.reference, status: 'CONFIRMED' } });
        repaymentId = entry.id;
      }
      const transaction = await tx.transaction.create({ data: { groupId: row.groupId, groupMemberId: membership.id, contributionId, loanRepaymentId: repaymentId, loanId: row.loanId, type: row.kind === 'CONTRIBUTION' ? 'CONTRIBUTION' : 'LOAN_REPAYMENT', amount: row.amount, currency: row.currency, reference: row.reference, status: 'COMPLETED', occurredAt: row.gatewayPaidAt!, description: `Verified online ${row.kind.toLowerCase()} confirmed ${reviewedAt.toISOString()}`, metadata: { proofVersion: 2, paymentId: id, reviewerId: actor.sub, reviewedAt: reviewedAt.toISOString(), gateway: row.gateway, gatewayId: row.gatewayId, weekStart: row.weekStart?.toISOString() ?? null } } });
      await tx.paymentSubmission.update({ where: { id }, data: { transactionId: transaction.id } });
      const groupTotal = await tx.savingsAccount.aggregate({ where: { currency: 'SLE', groupMember: { groupId: row.groupId } }, _sum: { balance: true } });
      const memberTotal = await tx.savingsAccount.aggregate({ where: { currency: 'SLE', groupMemberId: membership.id }, _sum: { balance: true } });
      const groupSavings = String(groupTotal._sum.balance ?? 0), memberSavings = String(memberTotal._sum.balance ?? 0);
      const canonical = JSON.stringify({ version: 2, id: transaction.id, reference: transaction.reference, type: transaction.type, amount: transaction.amount.toString(), currency: transaction.currency, groupId: transaction.groupId, groupMemberId: transaction.groupMemberId, occurredAt: transaction.occurredAt.toISOString(), status: transaction.status, description: transaction.description });
      await tx.proofDelivery.create({ data: { reference: transaction.reference, recordHash: keccak256(toUtf8Bytes(canonical)), transactionType: transaction.type, payload: { userId: row.userId, groupId: row.groupId, transactionId: transaction.id, kind: row.kind, currency: row.currency, amount: row.amount.toString(), groupSavings, memberSavings, reviewedAt: reviewedAt.toISOString() } } });
      await tx.notification.create({ data: { userId: row.userId, title: 'Payment successfully confirmed', message: `${row.currency} ${row.amount.toFixed(2)} confirmed at ${reviewedAt.toISOString()}. Your savings: SLE ${memberSavings}. Community savings: SLE ${groupSavings}. Blockchain verification pending.`, type: row.kind === 'CONTRIBUTION' ? 'CONTRIBUTION' : 'REPAYMENT', status: 'SENT', sentAt: reviewedAt, dedupeKey: `payment-confirmed:${id}` } });
      await tx.auditLog.create({ data: { userId: actor.sub, action: 'PAYMENT_CONFIRMED', entityType: 'PaymentSubmission', entityId: id, newValues: { transactionId: transaction.id, reviewedAt: reviewedAt.toISOString(), memberSavings, groupSavings } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.payment(id, actor);
  }
}
