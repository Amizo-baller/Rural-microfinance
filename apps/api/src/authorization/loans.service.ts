import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LoanApplicationStatus, LoanStatus, NotificationType, Prisma, RepaymentStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateApprovedLoanDto, CreateLoanApplicationDto, DisburseLoanDto, ListLoanApplicationsDto, RecordLoanRepaymentDto, UpdateLoanApplicationDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { keccak256, toUtf8Bytes } from 'ethers';

type Actor = { sub: string; role: string };

const applicationSelect = {
  currency: true,
  loan: { select: { id: true, status: true, outstandingBalance: true, currency: true } },
  id: true, groupId: true, groupMemberId: true, requestedAmount: true, purpose: true, termMonths: true,
  proposedRate: true, status: true, submittedAt: true, supportingInformation: true, reviewedAt: true, reviewerId: true,
  reviewerNotes: true, rejectionReason: true, createdAt: true, updatedAt: true,
  group: { select: { id: true, name: true } },
  groupMember: { select: { id: true, memberNumber: true, userId: true, user: { select: { firstName: true, lastName: true } } } },
  reviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.LoanApplicationSelect;

const activeStatuses: LoanApplicationStatus[] = [LoanApplicationStatus.PENDING, LoanApplicationStatus.UNDER_REVIEW, LoanApplicationStatus.APPROVED];

@Injectable()
export class LoansService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  private hasManagementAccess(actor: Actor) { return ['LOAN_OFFICER', 'TREASURER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role); }
  private scope(actor: Actor): Prisma.GroupMemberWhereInput {
    return this.hasManagementAccess(actor) ? {} : actor.role === 'GROUP_MANAGER' ? { group: { managerId: actor.sub } } : { userId: actor.sub };
  }
  private async assertManagedGroup(groupId: string, actor: Actor) {
    if (this.hasManagementAccess(actor)) return;
    if (actor.role === 'GROUP_MANAGER' && await this.prisma.communityGroup.findFirst({ where: { id: groupId, managerId: actor.sub } })) return;
    throw new ForbiddenException('Only the treasurer or assigned group manager can manage this loan.');
  }

  private async memberForActor(actor: Actor) {
    const member = await this.prisma.groupMember.findUnique({ where: { userId: actor.sub }, select: { id: true, userId: true, groupId: true, status: true, group: { select: { status: true } } } });
    if (!member) throw new ForbiddenException('You must belong to a community group to apply for a loan');
    if (member.status !== 'ACTIVE' || member.group.status !== 'ACTIVE') throw new ConflictException('An active member of an active group is required');
    return member;
  }

  async create(dto: CreateLoanApplicationDto, actor: Actor) {
    const identity = await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { memberId: true } });
    if (!identity || identity.memberId !== dto.memberId?.trim()) throw new ForbiddenException('Enter your own registered member ID.');
    const member = await this.memberForActor(actor);
    const applicationDate = dto.applicationDate ? new Date(dto.applicationDate) : new Date();
    if (Number.isNaN(applicationDate.valueOf())) throw new ConflictException('Invalid application date');
    if (applicationDate > new Date()) throw new ConflictException('Application date cannot be in the future');
    if (new Prisma.Decimal(dto.amount).lessThanOrEqualTo(0)) throw new ConflictException('Loan amount must be positive');
    if (dto.purpose.trim().length < 10) throw new ConflictException('Loan purpose must contain at least 10 characters');
    const activeApplication = await this.prisma.loanApplication.findFirst({ where: { groupMemberId: member.id, status: { in: activeStatuses } }, select: { id: true } });
    if (activeApplication) throw new ConflictException('You already have an active loan application');
    try {
      const application = await this.prisma.$transaction(async (tx) => {
        const createdApplication = await tx.loanApplication.create({
          data: {
            groupId: member.groupId, groupMemberId: member.id, requestedAmount: new Prisma.Decimal(dto.amount), purpose: dto.purpose.trim(),
            termMonths: dto.durationMonths, status: LoanApplicationStatus.PENDING, submittedAt: applicationDate,
            supportingInformation: dto.supportingInformation?.trim(),
          }, select: applicationSelect,
        });
        await tx.auditLog.create({ data: { userId: actor.sub, action: 'LOAN_APPLICATION_SUBMITTED', entityType: 'LoanApplication', entityId: createdApplication.id, newValues: { status: createdApplication.status, requestedAmount: dto.amount, groupId: member.groupId } } });
        return createdApplication;
      });
      await this.notifications.create(member.userId, 'Loan submitted', `Your loan application for GHS ${dto.amount} was submitted.`, 'LOAN');
      return application;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('You already have an active loan application');
      throw error;
    }
  }

  async list(query: ListLoanApplicationsDto, actor: Actor) {
    const where: Prisma.LoanApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      groupMember: this.scope(actor),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loanApplication.findMany({ where, select: applicationSelect, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.loanApplication.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor) {
    const application = await this.prisma.loanApplication.findFirst({ where: { id, groupMember: this.scope(actor) }, select: applicationSelect });
    if (!application) throw new NotFoundException('Loan application not found');
    return application;
  }

  async audit(id: string, actor: Actor) {
    await this.get(id, actor);
    return this.prisma.auditLog.findMany({
      where: { entityType: 'LoanApplication', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, oldValues: true, newValues: true, createdAt: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async updateStatus(id: string, dto: UpdateLoanApplicationDto, actor: Actor) {
    const application = await this.prisma.loanApplication.findUnique({ where: { id }, select: { id: true, status: true, groupId: true, groupMember: { select: { userId: true } } } });
    if (!application) throw new NotFoundException('Loan application not found');
    await this.assertManagedGroup(application.groupId, actor);
    if (application.groupMember.userId === actor.sub) throw new ForbiddenException('You cannot review your own loan application.');
    if (['APPROVED','REJECTED'].includes(dto.status) && !['TREASURER','GROUP_MANAGER','ADMIN','SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenException('Treasurer or group manager confirmation is required before loan approval.');
    const closedStatuses: LoanApplicationStatus[] = [LoanApplicationStatus.CANCELLED, LoanApplicationStatus.REJECTED, LoanApplicationStatus.APPROVED];
    if (closedStatuses.includes(application.status)) throw new ConflictException('This loan application is already closed');
    const allowedNextStatuses: Partial<Record<LoanApplicationStatus, LoanApplicationStatus[]>> = {
      DRAFT: [LoanApplicationStatus.PENDING, LoanApplicationStatus.CANCELLED],
      PENDING: [LoanApplicationStatus.UNDER_REVIEW, LoanApplicationStatus.APPROVED, LoanApplicationStatus.REJECTED, LoanApplicationStatus.CANCELLED],
      UNDER_REVIEW: [LoanApplicationStatus.APPROVED, LoanApplicationStatus.REJECTED, LoanApplicationStatus.CANCELLED],
    };
    const nextStatuses = allowedNextStatuses[application.status];
    if (!nextStatuses?.includes(dto.status)) throw new ConflictException(`Cannot change a ${application.status} application to ${dto.status}`);
    if (dto.status === LoanApplicationStatus.REJECTED && !dto.rejectionReason?.trim()) throw new ConflictException('A rejection reason is required');
    const terminalStatuses: LoanApplicationStatus[] = [LoanApplicationStatus.APPROVED, LoanApplicationStatus.REJECTED, LoanApplicationStatus.CANCELLED];
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.loanApplication.updateMany({ where: { id, status: application.status }, data: {
        status: dto.status, reviewerId: actor.sub, reviewerNotes: dto.reviewerNotes?.trim(),
        rejectionReason: dto.status === LoanApplicationStatus.REJECTED ? dto.rejectionReason?.trim() : null,
        reviewedAt: terminalStatuses.includes(dto.status) ? new Date() : null,
      } });
      if (!claimed.count) throw new ConflictException('Another reviewer already changed this loan application.');
      const updated = await tx.loanApplication.findUniqueOrThrow({ where: { id }, select: applicationSelect });
      await tx.auditLog.create({ data: { userId: actor.sub, action: `LOAN_APPLICATION_${dto.status}`, entityType: 'LoanApplication', entityId: id, oldValues: { status: application.status }, newValues: { status: dto.status, reviewerNotes: dto.reviewerNotes?.trim() ?? null, rejectionReason: dto.rejectionReason?.trim() ?? null } } });
      if (dto.status === 'APPROVED') {
        const reference = `LOAN-APPROVAL-${id}`;
        const reviewedAt = updated.reviewedAt!.toISOString();
        const hash = keccak256(toUtf8Bytes(JSON.stringify({ id, memberId: updated.groupMember.userId, amount: updated.requestedAmount.toString(), status: updated.status, reviewerId: actor.sub, reviewedAt })));
        await tx.proofDelivery.create({ data: { reference, recordHash: hash, transactionType: 'LOAN_APPROVAL', payload: { userId: updated.groupMember.userId, kind: 'LOAN_APPROVAL', reviewedAt } } });
      }
      return updated;
    });
    const applicant = await this.prisma.loanApplication.findUnique({ where: { id }, select: { groupMember: { select: { userId: true } } } });
    if (applicant) await this.notifications.create(applicant.groupMember.userId, dto.status === LoanApplicationStatus.APPROVED ? 'Loan approved' : 'Loan application update', dto.status === LoanApplicationStatus.REJECTED ? `Your loan application was rejected. Reason: ${dto.rejectionReason}` : `Your loan application status is now ${dto.status}.`, 'LOAN');
    return updated;
  }

  async createApprovedLoan(applicationId: string, dto: CreateApprovedLoanDto, actor: Actor) {
    const application = await this.prisma.loanApplication.findUnique({ where: { id: applicationId }, select: { id: true, groupId: true, groupMemberId: true, requestedAmount: true, currency: true, termMonths: true, status: true } });
    if (!application) throw new NotFoundException('Loan application not found');
    await this.assertManagedGroup(application.groupId, actor);
    if (application.status !== LoanApplicationStatus.APPROVED) throw new ConflictException('Only approved applications can create loans');
    const startDate = new Date(dto.startDate);
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(startDate.valueOf()) || Number.isNaN(dueDate.valueOf()) || dueDate <= startDate) throw new ConflictException('Due date must be after the start date');
    const interestRate = new Prisma.Decimal(dto.interestRate);
    if (interestRate.lessThan(0)) throw new ConflictException('Interest rate cannot be negative');
    const existing = await this.prisma.loan.findUnique({ where: { loanApplicationId: application.id }, select: { id: true } });
    if (existing) throw new ConflictException('A loan already exists for this application');
    const loanReference = `LOAN-${application.id}`;
    return this.prisma.loan.create({ data: {
      loanApplicationId: application.id, groupId: application.groupId, groupMemberId: application.groupMemberId, loanReference,
      principalAmount: application.requestedAmount, currency: application.currency, interestRate, termMonths: application.termMonths,
      totalPayable: application.requestedAmount, outstandingBalance: application.requestedAmount, startDate, dueDate, status: LoanStatus.APPROVED,
    }, select: { id: true, loanReference: true, principalAmount: true, interestRate: true, termMonths: true, totalPayable: true, outstandingBalance: true, startDate: true, dueDate: true, status: true } });
  }

  async disburse(id: string, dto: DisburseLoanDto, actor: Actor) {
    const managedLoan = await this.prisma.loan.findUnique({ where: { id }, select: { groupId: true } });
    if (!managedLoan) throw new NotFoundException('Loan not found');
    await this.assertManagedGroup(managedLoan.groupId, actor);
    const result = await this.prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id }, select: { id: true, loanReference: true, groupId: true, groupMemberId: true, principalAmount: true, status: true, startDate: true, dueDate: true, groupMember: { select: { userId: true } } } });
      if (!loan) throw new NotFoundException('Loan not found');
      if (loan.status !== LoanStatus.APPROVED) throw new ConflictException('Only approved loans can be disbursed');
      const transaction = await tx.transaction.create({ data: {
        groupId: loan.groupId, groupMemberId: loan.groupMemberId, loanId: loan.id, type: TransactionType.LOAN_DISBURSEMENT,
        amount: loan.principalAmount, reference: `DISB-${loan.loanReference}`, status: TransactionStatus.COMPLETED,
        description: `Loan disbursement ${loan.loanReference}`,
        occurredAt: loan.startDate ?? new Date(), metadata: { groupId: loan.groupId, loanReference: loan.loanReference },
      } });
      let blockchainTransaction = null;
      if (dto.blockchainTransactionHash) {
        blockchainTransaction = await tx.blockchainTransaction.create({ data: {
          transactionId: transaction.id, loanId: loan.id, transactionHash: dto.blockchainTransactionHash,
          blockNumber: dto.blockNumber ? BigInt(dto.blockNumber) : null, network: dto.blockchainNetwork ?? 'UNSPECIFIED',
          contractAddress: dto.contractAddress, method: dto.blockchainMethod, status: 'SUBMITTED', submittedAt: new Date(),
        } });
        if (dto.blockchainTransactionHash) await tx.transaction.update({ where: { id: transaction.id }, data: { blockchainStatus: 'SUBMITTED', blockchainHash: dto.blockchainTransactionHash } });
      }
      const updatedLoan = await tx.loan.update({ where: { id: loan.id }, data: { status: LoanStatus.ACTIVE, disbursedAt: new Date() }, select: { id: true, loanReference: true, principalAmount: true, interestRate: true, termMonths: true, outstandingBalance: true, startDate: true, dueDate: true, disbursedAt: true, status: true } });
      return { loan: updatedLoan, transaction, blockchainTransaction, userId: loan.groupMember.userId };
    });
    await this.notifications.create(result.userId, 'Loan disbursed', `Loan ${result.loan.loanReference} has been disbursed.`, 'LOAN');
    return result;
  }

  async loans(query: ListLoanApplicationsDto, actor: Actor) {
    const where: Prisma.LoanWhereInput = { groupMember: this.scope(actor) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loan.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.loan.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async getLoan(id: string, actor: Actor) {
    const loan = await this.prisma.loan.findUnique({ where: { id }, include: { groupMember: { select: { userId: true } } } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!this.hasManagementAccess(actor) && loan.groupMember.userId !== actor.sub) await this.assertManagedGroup(loan.groupId, actor);
    return { id: loan.id, currency: loan.currency, loanReference: loan.loanReference, principalAmount: loan.principalAmount, interestRate: loan.interestRate, termMonths: loan.termMonths, outstandingBalance: loan.outstandingBalance, startDate: loan.startDate, dueDate: loan.dueDate, disbursedAt: loan.disbursedAt, status: loan.status };
  }

  async recordRepayment(loanId: string, dto: RecordLoanRepaymentDto, actor: Actor) {
    if (actor.role === 'MEMBER') throw new ForbiddenException('Use Repay loan with your member ID, complete online checkout, and submit a receipt for confirmation.');
    if (!['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'LOAN_OFFICER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenException('You cannot record loan repayments');
    const repaymentDate = dto.repaymentDate ? new Date(dto.repaymentDate) : new Date();
    if (Number.isNaN(repaymentDate.valueOf()) || repaymentDate > new Date()) throw new ConflictException('Repayment date must be valid and cannot be in the future');
    const amount = new Prisma.Decimal(dto.amount);
    const reference = dto.reference.trim();
    if (amount.lessThanOrEqualTo(0)) throw new ConflictException('Repayment amount must be positive');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findUnique({ where: { id: loanId }, select: { id: true, loanReference: true, groupId: true, groupMemberId: true, outstandingBalance: true, status: true, groupMember: { select: { userId: true } } } });
        if (!loan) throw new NotFoundException('Loan not found');
        if (!this.hasManagementAccess(actor) && loan.groupMember.userId !== actor.sub) throw new ForbiddenException('You cannot repay this loan');
        if (loan.status !== LoanStatus.ACTIVE) throw new ConflictException('Only active loans can receive repayments');
        if (amount.greaterThan(loan.outstandingBalance)) throw new ConflictException('Repayment cannot exceed the outstanding balance');
        const remainingBalance = loan.outstandingBalance.minus(amount);
        const updated = await tx.loan.updateMany({ where: { id: loan.id, status: LoanStatus.ACTIVE, outstandingBalance: { gte: amount } }, data: { outstandingBalance: { decrement: amount }, status: remainingBalance.isZero() ? LoanStatus.COMPLETED : LoanStatus.ACTIVE } });
        if (updated.count !== 1) throw new ConflictException('Loan balance changed; please retry the repayment');
        const repayment = await tx.loanRepayment.create({ data: { loanId: loan.id, groupMemberId: loan.groupMemberId, amount, principalPaid: amount, interestPaid: 0, paidAt: repaymentDate, reference, status: RepaymentStatus.CONFIRMED } });
        const transaction = await tx.transaction.create({ data: { groupId: loan.groupId, groupMemberId: loan.groupMemberId, loanId: loan.id, loanRepaymentId: repayment.id, type: TransactionType.LOAN_REPAYMENT, amount, reference: `REPAY-${reference}`, status: TransactionStatus.COMPLETED, occurredAt: repaymentDate, description: `Loan repayment ${loan.loanReference}`, metadata: { loanReference: loan.loanReference, remainingBalance: remainingBalance.toString() } } });
        return { repayment, transaction, loan: { id: loan.id, loanReference: loan.loanReference, remainingBalance, status: remainingBalance.isZero() ? LoanStatus.COMPLETED : LoanStatus.ACTIVE }, userId: loan.groupMember.userId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.notifications.create(result.userId, 'Repayment recorded', `Repayment of GHS ${dto.amount} was recorded for ${result.loan.loanReference}.`, NotificationType.REPAYMENT);
      return result;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('A repayment with this reference already exists');
      throw error;
    }
  }

  async repayments(loanId: string, actor: Actor) {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, select: { id: true, groupId: true, groupMemberId: true, groupMember: { select: { userId: true } } } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (!this.hasManagementAccess(actor) && loan.groupMember.userId !== actor.sub) await this.assertManagedGroup(loan.groupId, actor);
    return this.prisma.loanRepayment.findMany({ where: { loanId }, orderBy: { paidAt: 'desc' }, select: { id: true, amount: true, paidAt: true, reference: true, status: true, principalPaid: true, interestPaid: true, loan: { select: { loanReference: true, outstandingBalance: true, dueDate: true, status: true } }, groupMember: { select: { memberNumber: true, user: { select: { firstName: true, lastName: true } } } } } });
  }
}
