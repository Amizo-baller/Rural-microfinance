import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { PaymentGatewayService, PaymentPendingException } from './payment-gateway.service';
import { WorkflowService } from './workflow.service';

@Injectable()
export class MonimeReconciliationService {
  private running = false;
  private cursor: string | undefined;
  private readonly logger = new Logger(MonimeReconciliationService.name);

  constructor(private readonly prisma: PrismaService, private readonly gateway: PaymentGatewayService,
    private readonly workflow: WorkflowService) {}

  @Interval(30000)
  async reconcile() {
    if (this.running || this.gateway.mode() !== 'live') return;
    this.running = true;
    try {
      const payments = await this.prisma.paymentSubmission.findMany({
        where: { gateway: 'monime', gatewayId: { not: null }, transactionId: null,
          status: { in: ['AWAITING_PAYMENT', 'PAID', 'SUBMITTED'] } },
        orderBy: { id: 'asc' }, take: 10,
        ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}),
        select: { id: true },
      });
      for (const payment of payments) {
        try { await this.workflow.synchronizeMonimePayment(payment.id); }
        catch (error) {
          // Pending sessions and mismatched details never authorize a credit.
          // Keep jobs available for retry, without leaking gateway credentials/payloads.
          if (!(error instanceof PaymentPendingException)) this.logger.warn(`Monime payment ${payment.id} could not be reconciled; will retry.`);
        }
      }
      this.cursor = payments.length === 10 ? payments[payments.length - 1].id : undefined;
    } catch { this.logger.warn('Monime reconciliation is unavailable; will retry.'); }
    finally { this.running = false; }
  }
}
