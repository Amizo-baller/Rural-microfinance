import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type Payout = { id: string; status: string; amount?: { currency: string; value: number }; destination?: { transactionReference?: string }; fees?: { amount?: { currency?: string; value?: number } }[]; failureDetail?: { message?: string }; };

@Injectable()
export class MonimePayoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonimePayoutService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() { this.timer = setInterval(() => void this.reconcile(), 30000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async handleWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    const secret = process.env.MONIME_WEBHOOK_SECRET?.trim();
    if (!secret || !rawBody?.length || !signatureHeader) throw new UnauthorizedException('Monime webhook authentication is not configured.');

    const parts = new Map<string, string>();
    for (const part of signatureHeader.split(',')) {
      const separator = part.indexOf('=');
      if (separator < 1) throw new UnauthorizedException('Invalid Monime signature.');
      const key = part.slice(0, separator).trim();
      if (parts.has(key)) throw new UnauthorizedException('Invalid Monime signature.');
      parts.set(key, part.slice(separator + 1).trim());
    }
    const timestampText = parts.get('t');
    const signatureText = parts.get('v1');
    if (!timestampText || !/^\d{1,12}$/.test(timestampText) || !signatureText || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText))
      throw new UnauthorizedException('Invalid Monime signature.');
    const timestamp = Number(timestampText);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300)
      throw new UnauthorizedException('Expired Monime webhook signature.');

    const supplied = Buffer.from(signatureText, 'base64');
    if (supplied.length !== 32 || supplied.toString('base64') !== signatureText)
      throw new UnauthorizedException('Invalid Monime signature.');
    const expected = createHmac('sha256', secret).update(`${timestampText}_`).update(rawBody).digest();
    if (!timingSafeEqual(expected, supplied)) throw new UnauthorizedException('Invalid Monime signature.');

    let event: { event?: { id?: string; name?: string }; object?: { id?: string; type?: string }; data?: { id?: string; metadata?: { withdrawalRequestId?: string; reference?: string } } };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid Monime webhook payload.');
    }
    const payoutId = event.object?.id;
    if (!event.event?.id || !['payout.completed', 'payout.failed'].includes(event.event.name ?? '') || event.object?.type !== 'payout' || !payoutId || (event.data?.id && event.data.id !== payoutId))
      throw new UnauthorizedException('Unsupported Monime webhook event.');

    let withdrawal = await this.prisma.withdrawalRequest.findFirst({ where: { payoutId }, select: { id: true, status: true } });
    if (!withdrawal && event.data?.metadata?.withdrawalRequestId && event.data.metadata.reference) {
      const candidate = await this.prisma.withdrawalRequest.findUnique({ where: { id: event.data.metadata.withdrawalRequestId }, select: { id: true, status: true, reference: true, payoutId: true } });
      if (candidate?.status === 'PROCESSING' && candidate.reference === event.data.metadata.reference && (!candidate.payoutId || candidate.payoutId === payoutId)) {
        await this.prisma.withdrawalRequest.updateMany({ where: { id: candidate.id, status: 'PROCESSING', OR: [{ payoutId: null }, { payoutId }] }, data: { payoutId, payoutNextAttemptAt: new Date() } });
        withdrawal = { id: candidate.id, status: candidate.status };
      }
    }
    if (!withdrawal || withdrawal.status !== 'PROCESSING') return { received: true };

    // The signed event only wakes reconciliation. The authenticated Get Payout API remains authoritative.
    await this.process(withdrawal.id);
    return { received: true };
  }

  async providers() {
    const { token } = this.config();
    const response = await fetch('https://api.monime.io/v1/momos?country=SL&limit=50', {
      headers: { Authorization: `Bearer ${token}`, 'Monime-Version': 'caph.2025-08-23' },
      signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    const payload = await response.json() as { success?: boolean; result?: { providerId: string; name: string; status?: { active?: boolean }; featureSet?: { payout?: { canPayTo?: boolean } } }[] };
    if (!response.ok || payload.success !== true || !Array.isArray(payload.result)) throw new Error('Monime mobile money providers could not be loaded.');
    return payload.result.filter((provider) => provider.status?.active && provider.featureSet?.payout?.canPayTo).map(({ providerId, name }) => ({ providerId, name }));
  }

  private config() {
    const token = process.env.MONIME_ACCESS_TOKEN?.trim() ?? '';
    const space = process.env.MONIME_SPACE_ID?.trim() ?? '';
    if (process.env.PAYMENT_PROVIDER !== 'monime' || token.startsWith('mon_test_') || !token.startsWith('mon_') || !/^spc-[A-Za-z0-9-]+$/.test(space))
      throw new Error('Live Monime payout credentials and Space ID are required.');
    return { token, space };
  }

  private async call(path: string, body?: object, idempotencyKey?: string): Promise<Payout> {
    const { token, space } = this.config();
    const response = await fetch(`https://api.monime.io/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Monime-Space-Id': space, 'Monime-Version': 'caph.2025-08-23', 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    const payload = await response.json() as { success?: boolean; result?: Payout };
    if (!response.ok || payload.success !== true || !payload.result) throw new Error(`Monime payout request failed with HTTP ${response.status}.`);
    return payload.result;
  }

  async process(id: string) {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { savingsAccount: { include: { groupMember: true } } } });
    if (!row || row.status !== 'PROCESSING' || !row.payoutIdempotencyKey) return;
    const account = row.savingsAccount;
    try {
      const payout = row.payoutId
        ? await this.call(`/payouts/${encodeURIComponent(row.payoutId)}`)
        : await this.call('/payouts', {
            amount: { currency: row.savingsAccount.currency, value: Number(row.amount.mul(100).toFixed(0)) },
            destination: row.payoutDestination as object,
            metadata: { withdrawalRequestId: row.id, reference: row.reference },
          }, row.payoutIdempotencyKey);
      if (!payout.id || payout.amount?.currency !== row.savingsAccount.currency || payout.amount.value !== Number(row.amount.mul(100).toFixed(0))) throw new Error('Monime payout response did not match the withdrawal amount.');
      const feesMinor = (payout.fees ?? []).reduce((sum, fee) => {
        if (fee.amount?.currency && fee.amount.currency !== row.savingsAccount.currency) throw new Error('Monime returned a payout fee in an unexpected currency.');
        const value = fee.amount?.value ?? 0;
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Monime returned an invalid payout fee.');
        return sum + value;
      }, 0);
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.withdrawalRequest.findUnique({ where: { id } });
        if (!current || current.status !== 'PROCESSING') return;
        if (['pending', 'processing'].includes(payout.status)) {
          await tx.withdrawalRequest.update({ where: { id }, data: { payoutId: payout.id, payoutReference: payout.destination?.transactionReference ?? null, payoutFees: new Prisma.Decimal(feesMinor).div(100), payoutReceipt: payout as Prisma.InputJsonValue, payoutAttempts: { increment: 1 }, payoutNextAttemptAt: new Date(Date.now() + 60_000), payoutLastError: null } });
          return;
        }
        if (payout.status === 'completed') {
          const claimed = await tx.withdrawalRequest.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'COMPLETED', payoutId: payout.id, payoutReference: payout.destination?.transactionReference ?? payout.id, payoutFees: new Prisma.Decimal(feesMinor).div(100), payoutReceipt: payout as Prisma.InputJsonValue, payoutNextAttemptAt: null, payoutLastError: null } });
          if (!claimed.count) return;
          const fee = new Prisma.Decimal(feesMinor).div(100);
          if (fee.gt(0)) {
            const feeAccount = await tx.savingsAccount.findUnique({ where: { id: current.savingsAccountId }, select: { balance: true } });
            if (!feeAccount) throw new Error('Savings account for payout fee settlement was not found.');
            const collected = Prisma.Decimal.min(Prisma.Decimal.max(0, feeAccount.balance), fee);
            const due = fee.minus(collected);
            await tx.savingsAccount.update({ where: { id: current.savingsAccountId }, data: { balance: { decrement: collected }, ...(due.gt(0) ? { withdrawalFeeDue: { increment: due } } : {}) } });
          }
          await tx.transaction.create({ data: { groupId: account.groupMember.groupId, groupMemberId: account.groupMemberId, type: 'WITHDRAWAL', amount: current.amount, currency: account.currency, reference: current.reference, status: 'COMPLETED', description: current.reason, metadata: { withdrawalRequestId: id, monimePayoutId: payout.id, receipt: payout } } });
          await tx.auditLog.create({ data: { userId: current.requesterId, action: 'WITHDRAWAL_PAYOUT_CONFIRMED', entityType: 'WithdrawalRequest', entityId: id, oldValues: { status: 'PROCESSING' }, newValues: { status: 'COMPLETED', payoutId: payout.id, payoutReference: payout.destination?.transactionReference ?? payout.id, fees: (new Prisma.Decimal(feesMinor).div(100)).toFixed(2) } } });
          await tx.notification.create({ data: { userId: current.requesterId, type: 'GENERAL', title: 'Withdrawal successful', message: `${account.currency} ${current.amount.toFixed(2)} was paid out. Monime fee: SLE ${(new Prisma.Decimal(feesMinor).div(100)).toFixed(2)}. Reference: ${payout.destination?.transactionReference ?? payout.id}`, status: 'SENT', sentAt: new Date() } });
          return;
        }
        if (payout.status === 'failed') {
          const failed = await tx.withdrawalRequest.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', payoutId: payout.id, payoutReceipt: payout as Prisma.InputJsonValue, payoutNextAttemptAt: null, payoutLastError: payout.failureDetail?.message ?? 'Payout failed' } });
          if (failed.count !== 1) return;
          await tx.savingsAccount.update({ where: { id: current.savingsAccountId }, data: { balance: { increment: current.amount } } });
          await tx.auditLog.create({ data: { userId: current.requesterId, action: 'WITHDRAWAL_PAYOUT_FAILED', entityType: 'WithdrawalRequest', entityId: id, oldValues: { status: 'PROCESSING' }, newValues: { status: 'FAILED', payoutId: payout.id, failure: payout.failureDetail?.message ?? 'Payout failed' } } });
          await tx.notification.create({ data: { userId: current.requesterId, type: 'GENERAL', title: 'Withdrawal failed', message: payout.failureDetail?.message ?? 'Monime confirmed the payout failed. The reserved savings are available again.', status: 'SENT', sentAt: new Date() } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      this.logger.warn(`Withdrawal payout ${id} remains processing for reconciliation.`);
      await this.prisma.withdrawalRequest.updateMany({ where: { id, status: 'PROCESSING' }, data: { payoutAttempts: { increment: 1 }, payoutNextAttemptAt: new Date(Date.now() + 60_000), payoutLastError: String(error).slice(0, 500) } });
    }
  }

  async reconcile() {
    const rows = await this.prisma.withdrawalRequest.findMany({ where: { status: 'PROCESSING', payoutNextAttemptAt: { lte: new Date() } }, select: { id: true }, take: 50, orderBy: { payoutNextAttemptAt: 'asc' } });
    for (const row of rows) await this.process(row.id);
  }
}
