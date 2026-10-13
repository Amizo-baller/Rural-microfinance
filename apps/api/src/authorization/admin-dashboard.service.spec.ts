/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  let prisma: any;
  let service: AdminDashboardService;

  beforeEach(() => {
    prisma = {
      user: { count: jest.fn().mockResolvedValue(42) },
      communityGroup: { count: jest.fn().mockResolvedValue(12) },
      groupMember: { count: jest.fn().mockResolvedValue(80) },
      savingsAccount: { aggregate: jest.fn().mockResolvedValue({ _sum: { balance: 125000 } }) },
      loan: {
        count: jest.fn().mockResolvedValue(24),
        aggregate: jest.fn().mockResolvedValue({ _sum: { outstandingBalance: 55000 } }),
        groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 6 } }, { status: 'DEFAULTED', _count: { _all: 2 } }]),
      },
      loanRepayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 35000 } }),
        findMany: jest.fn().mockResolvedValue([{ amount: 1000, paidAt: new Date('2026-01-10T00:00:00Z') }, { amount: 2000, paidAt: new Date('2026-02-10T00:00:00Z') }]),
      },
      transaction: { findMany: jest.fn().mockResolvedValue([{ id: 'tx-1', type: 'LOAN_REPAYMENT', amount: 1200, reference: 'REF-1', status: 'COMPLETED', occurredAt: new Date('2026-02-01T00:00:00Z'), description: 'Repayment', group: { name: 'Group A' }, groupMember: { memberNumber: 'MBR-001', user: { firstName: 'A', lastName: 'B' } } }]) },
      loanApplication: {
        findMany: jest.fn().mockResolvedValue([{ id: 'la-1', requestedAmount: 1500, purpose: 'School fees', submittedAt: new Date('2026-02-15T00:00:00Z'), status: 'PENDING', group: { name: 'Group A' }, groupMember: { memberNumber: 'MBR-002', user: { firstName: 'C', lastName: 'D' } } }]),
        count: jest.fn().mockResolvedValue(14),
      },
      notification: {
        findMany: jest.fn().mockResolvedValue([{ id: 'n-1', title: 'Alert', message: 'A message', type: 'GENERAL', status: 'SENT', createdAt: new Date('2026-02-15T00:00:00Z'), readAt: null }]),
        count: jest.fn().mockResolvedValue(11),
      },
      blockchainTransaction: { groupBy: jest.fn().mockResolvedValue([{ status: 'CONFIRMED', _count: { _all: 8 } }, { status: 'PENDING', _count: { _all: 3 } }]) },
      contribution: { findMany: jest.fn().mockResolvedValue([{ amount: 500, contributionDate: new Date('2026-01-02T00:00:00Z') }, { amount: 750, contributionDate: new Date('2026-02-03T00:00:00Z') }]) },
    };
    service = new AdminDashboardService(prisma);
  });

  it('returns the admin dashboard summary and chart data', async () => {
    const dashboard = await service.dashboard({ sub: 'admin-1', role: 'ADMIN' });

    expect(dashboard.metrics.totalUsers).toBe(42);
    expect(dashboard.metrics.totalGroups).toBe(12);
    expect(dashboard.metrics.totalMembers).toBe(80);
    expect(dashboard.metrics.totalSavings).toBe(125000);
    expect(dashboard.metrics.totalLoans).toBe(24);
    expect(dashboard.metrics.outstandingLoans).toBe(55000);
    expect(dashboard.metrics.totalRepayments).toBe(35000);
    expect(dashboard.metrics.pendingApplications).toBe(14);
    expect(dashboard.metrics.unreadNotifications).toBe(11);
    expect(dashboard.charts.savingsTrend.length).toBe(6);
    expect(dashboard.charts.loanStatus.some((item: any) => item.status === 'ACTIVE')).toBe(true);
    expect(dashboard.recentTransactions[0]).toMatchObject({ reference: 'REF-1' });
    expect(dashboard.pendingApplications[0]).toMatchObject({ purpose: 'School fees' });
  });

  it('blocks non-admin users from the dashboard', async () => {
    await expect(service.dashboard({ sub: 'member-1', role: 'MEMBER' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
