/* eslint-disable @typescript-eslint/no-explicit-any */
import { LoanApplicationStatus, LoanStatus, TransactionType } from '@prisma/client';
import { ReportsService } from './reports.service';

function createPrismaMock(): any {
  return {
    groupMember: { count: jest.fn().mockResolvedValue(0) },
    savingsAccount: { findMany: jest.fn().mockResolvedValue([]) },
    loanApplication: { count: jest.fn().mockResolvedValue(0) },
    loan: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    loanRepayment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contribution: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    blockchainTransaction: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('ReportsService', () => {
  it('applies transaction type to contributions, repayments, and blockchain records', async () => {
    const prisma = createPrismaMock();
    const service = new ReportsService(prisma);

    await service.analytics({ transactionType: TransactionType.LOAN_REPAYMENT }, { sub: 'admin-1', role: 'ADMIN' });

    expect(prisma.contribution.findMany.mock.calls[0][0].where).toMatchObject({
      transaction: { is: { type: TransactionType.LOAN_REPAYMENT } },
    });
    expect(prisma.contribution.findMany.mock.calls[0][0].where.paymentMethod).toBeUndefined();
    expect(prisma.loanRepayment.aggregate.mock.calls[0][0].where).toMatchObject({
      transaction: { is: { type: TransactionType.LOAN_REPAYMENT } },
    });
    expect(prisma.loanRepayment.findMany.mock.calls[0][0].where).toMatchObject({
      transaction: { is: { type: TransactionType.LOAN_REPAYMENT } },
    });
    expect(prisma.blockchainTransaction.count.mock.calls).toHaveLength(4);
    for (const [args] of prisma.blockchainTransaction.count.mock.calls) {
      expect(args.where).toMatchObject({
        transaction: { is: { type: TransactionType.LOAN_REPAYMENT } },
      });
    }
  });

  it('limits loan status counts to the selected status', async () => {
    const prisma = createPrismaMock();
    const service = new ReportsService(prisma);

    await service.analytics({ loanStatus: LoanStatus.ACTIVE }, { sub: 'admin-1', role: 'ADMIN' });

    expect(prisma.loan.count).toHaveBeenCalledTimes(2);
    for (const [args] of prisma.loan.count.mock.calls) {
      expect(args.where.status).toBe(LoanStatus.ACTIVE);
    }
    expect(prisma.loanRepayment.aggregate.mock.calls[0][0].where.loan.status).toBe(LoanStatus.ACTIVE);
    expect(prisma.loanRepayment.findMany.mock.calls[0][0].where.loan.status).toBe(LoanStatus.ACTIVE);
  });

  it('uses REJECTED to filter rejected applications without counting loan rows', async () => {
    const prisma = createPrismaMock();
    const service = new ReportsService(prisma);

    const report = await service.analytics({ loanStatus: LoanApplicationStatus.REJECTED }, { sub: 'admin-1', role: 'ADMIN' });

    expect(prisma.loanApplication.count.mock.calls.some(([args]: any[]) => args.where.status === LoanApplicationStatus.REJECTED)).toBe(true);
    expect(prisma.loan.count).not.toHaveBeenCalled();
    expect(prisma.loan.findMany).not.toHaveBeenCalled();
    expect(prisma.loanRepayment.aggregate).not.toHaveBeenCalled();
    expect(prisma.loanRepayment.findMany).not.toHaveBeenCalled();
    expect(report.loans).toMatchObject({ totalLoans: 0, approvedLoans: 0, rejectedLoans: 0, outstandingBalance: 0 });
    expect(report.repayments.totalRepayments).toBe(0);
  });

  it('reconstructs savings balances through the end date from confirmed contributions', async () => {
    const prisma = createPrismaMock();
    prisma.savingsAccount.findMany.mockResolvedValue([{
      balance: 90,
      groupMemberId: 'member-1',
      groupMember: {
        id: 'member-1',
        memberNumber: 'MBR-001',
        user: { firstName: 'Ari', lastName: 'Member' },
        group: { id: 'group-1', name: 'Group One' },
      },
    }]);
    prisma.contribution.groupBy.mockResolvedValue([{ groupMemberId: 'member-1', _sum: { amount: 40 } }]);
    const service = new ReportsService(prisma);

    const report = await service.analytics(
      { from: '2026-01-15', to: '2026-01-31' },
      { sub: 'admin-1', role: 'ADMIN' },
    );

    expect(prisma.contribution.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'CONFIRMED',
        contributionDate: { lte: new Date('2026-01-31T23:59:59.999Z') },
      }),
    }));
    expect(prisma.contribution.groupBy.mock.calls[0][0].where.contributionDate.gte).toBeUndefined();
    const historicalAccountsQuery = prisma.savingsAccount.findMany.mock.calls.find(([args]: any[]) => args.where.openedAt);
    expect(historicalAccountsQuery[0].where.openedAt.lte).toEqual(new Date('2026-01-31T23:59:59.999Z'));
    expect(report.savings.totalSavings).toBe(40);
    expect(report.savings.memberSavings[0].savings).toBe(40);
  });

  it('scopes blockchain counts to the group manager\'s group', async () => {
    const prisma = createPrismaMock();
    const service = new ReportsService(prisma);

    await service.analytics({}, { sub: 'manager-1', role: 'GROUP_MANAGER' });

    expect(prisma.blockchainTransaction.count).toHaveBeenCalledTimes(4);
    for (const [args] of prisma.blockchainTransaction.count.mock.calls) {
      expect(args.where.transaction.is.group).toEqual({ managerId: 'manager-1' });
    }
  });
});