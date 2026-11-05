import { ForbiddenException, Injectable } from '@nestjs/common';
import { LoanApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type Actor = { sub: string; role: string };

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private asNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return value === null || value === undefined ? 0 : Number(value);
  }

  private monthKeysForLastSixMonths() {
    const months: string[] = [];
    const now = new Date();
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      months.push(date.toISOString().slice(0, 7));
    }
    return months;
  }

  private seriesFromMonthKeys(months: string[], values: Record<string, number>) {
    return months.map((month) => ({ month, value: values[month] ?? 0 }));
  }

  async dashboard(actor: Actor) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) throw new ForbiddenException('Only administrators can access the admin dashboard');

    const monthKeys = this.monthKeysForLastSixMonths();

    const [
      totalUsers,
      totalGroups,
      totalMembers,
      totalSavings,
      totalLoans,
      outstandingLoans,
      totalRepayments,
      recentTransactions,
      pendingApplications,
      pendingApplicationCount,
      notifications,
      unreadNotificationCount,
      blockchainSummary,
      loanStatusSummary,
      contributionRows,
      repaymentRows,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.communityGroup.count(),
      this.prisma.groupMember.count(),
      this.prisma.savingsAccount.aggregate({ where: { currency: 'SLE' }, _sum: { balance: true } }),
      this.prisma.loan.count(),
      this.prisma.loan.aggregate({ where: { outstandingBalance: { gt: 0 } }, _sum: { outstandingBalance: true } }),
      this.prisma.loanRepayment.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amount: true } }),
      this.prisma.transaction.findMany({
        orderBy: { occurredAt: 'desc' },
        take: 8,
        select: {
          id: true,
          type: true,
          amount: true,
          reference: true,
          status: true,
          occurredAt: true,
          description: true,
          group: { select: { name: true } },
          groupMember: { select: { memberNumber: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.loanApplication.findMany({
        where: { status: { in: [LoanApplicationStatus.PENDING, LoanApplicationStatus.UNDER_REVIEW] } },
        orderBy: { submittedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          requestedAmount: true,
          purpose: true,
          submittedAt: true,
          status: true,
          group: { select: { name: true } },
          groupMember: { select: { memberNumber: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.loanApplication.count({ where: { status: { in: [LoanApplicationStatus.PENDING, LoanApplicationStatus.UNDER_REVIEW] } } }),
      this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, title: true, message: true, type: true, status: true, createdAt: true, readAt: true },
      }),
      this.prisma.notification.count({ where: { status: { not: 'READ' } } }),
      this.prisma.blockchainTransaction.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.loan.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.contribution.findMany({
        where: { status: 'CONFIRMED', contributionDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1) } },
        select: { amount: true, contributionDate: true },
      }),
      this.prisma.loanRepayment.findMany({
        where: { status: 'CONFIRMED', paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1) } },
        select: { amount: true, paidAt: true },
      }),
    ]);

    const contributionsByMonth = contributionRows.reduce<Record<string, number>>((accumulator, row) => {
      const monthKey = new Date(row.contributionDate).toISOString().slice(0, 7);
      accumulator[monthKey] = (accumulator[monthKey] ?? 0) + this.asNumber(row.amount);
      return accumulator;
    }, {});

    const repaymentsByMonth = repaymentRows.reduce<Record<string, number>>((accumulator, row) => {
      const monthKey = new Date(row.paidAt).toISOString().slice(0, 7);
      accumulator[monthKey] = (accumulator[monthKey] ?? 0) + this.asNumber(row.amount);
      return accumulator;
    }, {});

    const blockchainStatus = ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'].map((status) => ({ status, value: blockchainSummary.find((item) => item.status === status)?._count._all ?? 0 }));
    const loanStatus = ['PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'WRITTEN_OFF', 'CANCELLED'].map((status) => ({ status, value: loanStatusSummary.find((item) => item.status === status)?._count._all ?? 0 }));

    return {
      metrics: {
        totalUsers,
        totalGroups,
        totalMembers,
        totalSavings: this.asNumber(totalSavings._sum.balance ?? 0),
        totalLoans,
        outstandingLoans: this.asNumber(outstandingLoans._sum.outstandingBalance ?? 0),
        totalRepayments: this.asNumber(totalRepayments._sum.amount ?? 0),
        pendingApplications: pendingApplicationCount,
        unreadNotifications: unreadNotificationCount,
      },
      charts: {
        savingsTrend: this.seriesFromMonthKeys(monthKeys, contributionsByMonth),
        repaymentTrend: this.seriesFromMonthKeys(monthKeys, repaymentsByMonth),
        loanStatus,
        blockchainStatus,
      },
      recentTransactions: recentTransactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: this.asNumber(transaction.amount),
        reference: transaction.reference,
        status: transaction.status,
        occurredAt: transaction.occurredAt,
        description: transaction.description,
        groupName: transaction.group?.name ?? null,
        member: transaction.groupMember ? `${transaction.groupMember.user.firstName} ${transaction.groupMember.user.lastName}`.trim() : null,
      })),
      pendingApplications: pendingApplications.map((application) => ({
        id: application.id,
        status: application.status,
        requestedAmount: this.asNumber(application.requestedAmount),
        purpose: application.purpose,
        submittedAt: application.submittedAt,
        groupName: application.group?.name ?? null,
        member: application.groupMember ? `${application.groupMember.user.firstName} ${application.groupMember.user.lastName}`.trim() : null,
      })),
      notifications: notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        status: notification.status,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
      })),
    };
  }
}
