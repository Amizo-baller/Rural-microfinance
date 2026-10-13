import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';

@Injectable()
export class ProofDeliveryService {
  private running = false;
  private readonly logger = new Logger(ProofDeliveryService.name);
  constructor(private readonly prisma: PrismaService, private readonly blockchain: BlockchainService) {}
  @Interval(15000)
  async deliver() {
    if (this.running || !this.blockchain.configured()) return;
    this.running = true;
    try {
      const jobs = await this.prisma.proofDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 5 });
      for (const job of jobs) {
        try {
          const result = await this.blockchain.attest(job.reference, job.recordHash, job.transactionType);
          const payload = job.payload as Record<string, string>;
          await this.prisma.$transaction(async (tx) => {
            const done = await tx.proofDelivery.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'CONFIRMED', confirmedAt: new Date(), transactionHash: result.transactionHash, lastError: null } });
            if (!done.count) return;
            if (payload.transactionId) await tx.transaction.update({ where: { id: payload.transactionId }, data: { blockchainStatus: 'CONFIRMED', ...(result.transactionHash ? { blockchainHash: result.transactionHash } : {}) } });
            if (payload.transactionId && result.transactionHash) await tx.blockchainTransaction.upsert({ where: { transactionId: payload.transactionId }, create: { transactionId: payload.transactionId, transactionHash: result.transactionHash, network: 'CONFIGURED_NETWORK', method: 'recordProof', status: 'CONFIRMED', confirmedAt: new Date() }, update: { status: 'CONFIRMED', confirmedAt: new Date() } });
            const message = payload.kind === 'LOAN_APPROVAL'
              ? `Your loan was successfully approved at ${payload.reviewedAt}. Approval proof ${job.reference} is verified on-chain.`
              : `${payload.currency} ${payload.amount} ${payload.kind.toLowerCase()} confirmed at ${payload.reviewedAt}. Your savings: SLE ${payload.memberSavings}. Community total savings: SLE ${payload.groupSavings}. Proof ${job.reference} is verified on-chain.`;
            await tx.notification.upsert({ where: { dedupeKey: `blockchain:${job.id}:${payload.userId}` }, create: { userId: payload.userId, title: 'Blockchain confirmation verified', message, type: 'SECURITY', status: 'SENT', sentAt: new Date(), dedupeKey: `blockchain:${job.id}:${payload.userId}` }, update: {} });
            if (payload.kind === 'CONTRIBUTION') {
              const members = await tx.groupMember.findMany({ where: { groupId: payload.groupId, status: 'ACTIVE', userId: { not: payload.userId } }, select: { userId: true } });
              await tx.notification.createMany({ data: members.map((member) => ({ userId: member.userId, title: 'Community savings updated', message: `Community total savings: SLE ${payload.groupSavings}. Contribution proof ${job.reference} verified on-chain. Confirmed at ${payload.reviewedAt}.`, type: 'CONTRIBUTION', status: 'SENT', sentAt: new Date(), dedupeKey: `blockchain:${job.id}:${member.userId}` })), skipDuplicates: true });
            }
          });
        } catch {
          // Retry independently of the credited payment; an outage never credits twice.
          await this.prisma.proofDelivery.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(300000, 15000 * (job.attempts + 1))), lastError: 'Blockchain delivery unavailable; retry scheduled.' } });
          this.logger.warn('Blockchain proof delivery will be retried');
        }
      }
    } catch { this.logger.warn('Proof delivery queue temporarily unavailable'); }
    finally { this.running = false; }
  }
}
