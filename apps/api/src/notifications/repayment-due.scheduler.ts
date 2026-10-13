import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Module 18 — scheduled "Repayment due" notifications.
 *
 * A daily job scans active loans that carry an outstanding balance and whose
 * due date falls within the reminder window (or is already overdue) and sends
 * the borrower a single in-app reminder. A deterministic idempotency key
 * ("repayment-due:<loanId>") guarantees the reminder is delivered only once per
 * loan, so repeated daily runs never spam the member.
 */
@Injectable()
export class RepaymentDueScheduler {
  private readonly logger = new Logger(RepaymentDueScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(process.env.REPAYMENT_DUE_CRON ?? CronExpression.EVERY_DAY_AT_8AM)
  async handleRepaymentReminders() {
    return this.run();
  }

  async run() {
    const windowDays = Number(process.env.REPAYMENT_DUE_REMINDER_DAYS ?? 7);
    const now = new Date();
    const horizon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const overdueLoans = await this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        outstandingBalance: { gt: 0 },
        dueDate: { not: null, lt: now },
      },
      select: { id: true, loanReference: true, outstandingBalance: true, dueDate: true, status: true },
    });

    let defaulted = 0;
    for (const loan of overdueLoans) {
      const updated = await this.prisma.loan.updateMany({
        where: { id: loan.id, status: 'ACTIVE', outstandingBalance: { gt: 0 }, dueDate: { not: null, lt: now } },
        data: { status: 'DEFAULTED' },
      });
      if (updated.count > 0) defaulted += 1;
    }

    const loans = await this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        outstandingBalance: { gt: 0 },
        dueDate: { not: null, lte: horizon },
      },
      select: {
        id: true,
        loanReference: true,
        dueDate: true,
        outstandingBalance: true,
        groupMember: { select: { userId: true } },
      },
    });

    let created = 0;
    for (const loan of loans) {
      const dedupeKey = `repayment-due:${loan.id}`;
      const alreadyNotified = await this.prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
      if (alreadyNotified) continue;

      const dueDate = loan.dueDate ? new Date(loan.dueDate) : null;
      const dueLabel = dueDate ? dueDate.toLocaleDateString() : 'the due date';
      const overdue = Boolean(dueDate && dueDate < now);
      const message = overdue
        ? `Loan ${loan.loanReference} was due on ${dueLabel} and still has an outstanding balance of GHS ${loan.outstandingBalance}. Please make a repayment as soon as possible.`
        : `Loan ${loan.loanReference} is due on ${dueLabel} with an outstanding balance of GHS ${loan.outstandingBalance}. Please prepare your repayment.`;

      try {
        await this.notifications.create(loan.groupMember.userId, 'Repayment due', message, 'REPAYMENT', dedupeKey);
        created += 1;
      } catch (error) {
        // A concurrent run may have inserted the same idempotency key first.
        if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') continue;
        this.logger.error(`Failed to create repayment-due notification for loan ${loan.id}`, error instanceof Error ? error.stack : String(error));
      }
    }

    this.logger.log(`Repayment-due reminders: checked ${loans.length} loan(s), defaulted ${defaulted} overdue loan(s), created ${created} notification(s).`);
    return { checked: loans.length, defaulted, created };
  }
}