/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminOperationsService } from './admin-operations.service';
import { LoansService } from './loans.service';
import { SavingsService } from '../savings/savings.service';
import { WorkflowService } from '../workflow/workflow.service';

describe('Treasurer financial workflows', () => {
  const actor = { sub: 'treasurer', role: 'TREASURER' };
  let db: any;
  let operations: AdminOperationsService;
  let loans: LoansService;
  let savings: SavingsService;
  let notifications: any;
  const withdrawal = () => ({
    id: 'withdrawal',
    requesterId: 'member',
    status: 'PENDING',
    amount: new Prisma.Decimal(20),
    savingsAccount: {
      status: 'ACTIVE',
      balance: new Prisma.Decimal(100),
      currency: 'SLE',
      groupMember: { userId: 'member' },
    },
  });
  beforeEach(() => {
    const model = () => ({
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    });
    db = {
      withdrawalRequest: model(),
      auditLog: model(),
      savingsAccount: model(),
      groupMember: model(),
      contribution: model(),
      transaction: model(),
      loanApplication: model(),
      loan: model(),
      notification: model(),
      paymentSubmission: model(),
    };
    db.$transaction = jest.fn((work) =>
      typeof work === 'function' ? work(db) : Promise.all(work),
    );
    notifications = { create: jest.fn() };
    operations = new AdminOperationsService(db);
    loans = new LoansService(db, notifications);
    savings = new SavingsService(db, notifications);
    db.withdrawalRequest.findUnique.mockResolvedValue(withdrawal());
    db.auditLog.create.mockImplementation(async ({ data }: any) => ({ id: 'audit', ...data }));
  });

  it('records a recommendation without approving or debiting a withdrawal', async () => {
    await expect(
      operations.financeReviewWithdrawal(
        'withdrawal',
        { decision: 'RECOMMEND_APPROVAL', notes: 'Receipt and balance checked' },
        actor,
      ),
    ).resolves.toMatchObject({
      action: 'WITHDRAWAL_FINANCE_REVIEWED',
      newValues: { decision: 'RECOMMEND_APPROVAL' },
    });
    expect(db.withdrawalRequest.update).not.toHaveBeenCalled();
    expect(db.savingsAccount.update).not.toHaveBeenCalled();
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it('records a rejection recommendation without changing savings', async () => {
    await operations.financeReviewWithdrawal(
      'withdrawal',
      { decision: 'RECOMMEND_REJECTION', notes: 'Supporting documents missing' },
      actor,
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newValues: expect.objectContaining({ decision: 'RECOMMEND_REJECTION' }),
      }),
    });
    expect(db.savingsAccount.updateMany).not.toHaveBeenCalled();
  });

  it('cannot review its own withdrawal', async () => {
    const row = withdrawal();
    row.savingsAccount.groupMember.userId = actor.sub;
    db.withdrawalRequest.findUnique.mockResolvedValue(row);
    await expect(
      operations.financeReviewWithdrawal(
        'withdrawal',
        { decision: 'RECOMMEND_APPROVAL', notes: 'My own request' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('cannot recommend approval without sufficient active savings', async () => {
    const row = withdrawal();
    row.savingsAccount.balance = new Prisma.Decimal(5);
    db.withdrawalRequest.findUnique.mockResolvedValue(row);
    await expect(
      operations.financeReviewWithdrawal(
        'withdrawal',
        { decision: 'RECOMMEND_APPROVAL', notes: 'Insufficient savings' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot review a finalized withdrawal', async () => {
    db.withdrawalRequest.findUnique.mockResolvedValue({ ...withdrawal(), status: 'APPROVED' });
    await expect(
      operations.financeReviewWithdrawal(
        'withdrawal',
        { decision: 'RECOMMEND_APPROVAL', notes: 'Already reviewed' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot make the final withdrawal or loan application decision', async () => {
    await expect(
      operations.reviewWithdrawal(
        'withdrawal',
        { decision: 'APPROVED', notes: 'Attempt final approval' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      loans.updateStatus('application', { status: 'APPROVED' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.loanApplication.findUnique).not.toHaveBeenCalled();
  });

  it('sees all withdrawals for financial review', async () => {
    db.withdrawalRequest.findMany.mockResolvedValue([]);
    db.withdrawalRequest.count.mockResolvedValue(0);
    await operations.withdrawals({ page: 1, limit: 25 }, actor);
    expect(db.withdrawalRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('exposes the latest immutable recommendation to Admin', async () => {
    db.withdrawalRequest.findMany.mockResolvedValue([{ id: 'withdrawal', status: 'PENDING' }]);
    db.withdrawalRequest.count.mockResolvedValue(1);
    db.auditLog.findMany.mockResolvedValue([
      {
        entityId: 'withdrawal',
        newValues: { decision: 'RECOMMEND_APPROVAL', notes: 'Reviewed account' },
      },
    ]);
    const result = await operations.withdrawals(
      { page: 1, limit: 25 },
      { sub: 'admin', role: 'ADMIN' },
    );
    expect(result.items[0].financeReview?.newValues).toEqual({
      decision: 'RECOMMEND_APPROVAL',
      notes: 'Reviewed account',
    });
  });

  it('cannot create a loan from an unapproved application', async () => {
    db.loanApplication.findUnique.mockResolvedValue({
      id: 'application',
      groupId: 'group',
      status: 'PENDING',
    });
    await expect(
      loans.createApprovedLoan(
        'application',
        { interestRate: '5', startDate: '2026-10-20', dueDate: '2027-01-20' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.loan.create).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'ACTIVE', 'COMPLETED'])('cannot disburse a %s loan', async (status) => {
    db.loan.findUnique.mockResolvedValue({ id: 'loan', groupId: 'group', status });
    await expect(loans.disburse('loan', {}, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it('records an approved disbursement with its original currency, audit and notification', async () => {
    db.loan.findUnique.mockResolvedValue({
      id: 'loan',
      loanReference: 'LN-001',
      groupId: 'group',
      groupMemberId: 'member',
      principalAmount: new Prisma.Decimal(100),
      currency: 'SLE',
      status: 'APPROVED',
      groupMember: { userId: 'member' },
    });
    db.transaction.create.mockResolvedValue({ id: 'transaction' });
    db.loan.update.mockResolvedValue({ id: 'loan', loanReference: 'LN-001', status: 'ACTIVE' });
    await expect(loans.disburse('loan', {}, actor)).resolves.toMatchObject({
      loan: { status: 'ACTIVE' },
    });
    expect(db.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'LOAN_DISBURSEMENT',
        currency: 'SLE',
        amount: new Prisma.Decimal(100),
      }),
    });
    expect(db.auditLog.create).toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalled();
  });

  it('reports a duplicate disbursement as a recoverable conflict', async () => {
    db.loan.findUnique.mockResolvedValue({ groupId: 'group' });
    db.$transaction.mockRejectedValue({ code: 'P2002' });
    await expect(loans.disburse('loan', {}, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a contribution atomically and audits the treasurer', async () => {
    db.savingsAccount.findUnique.mockResolvedValue({
      id: 'account',
      groupMemberId: 'member',
      status: 'ACTIVE',
    });
    db.savingsAccount.findUniqueOrThrow.mockResolvedValue({ currency: 'SLE' });
    db.groupMember.findUnique.mockResolvedValue({
      id: 'member',
      userId: 'owner',
      status: 'ACTIVE',
    });
    db.savingsAccount.findFirst.mockResolvedValue({ id: 'account' });
    db.contribution.create.mockResolvedValue({ id: 'contribution' });
    await savings.contribute(
      {
        savingsAccountId: 'account',
        amount: '50',
        reference: 'CASH-TEST-001',
        paymentMethod: 'CASH',
      },
      actor,
    );
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.savingsAccount.update).toHaveBeenCalledWith({
      where: { id: 'account' },
      data: { balance: { increment: new Prisma.Decimal(50) } },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: actor.sub, action: 'CONTRIBUTION_RECORDED' }),
    });
  });

  it('rejects zero contributions', async () => {
    await expect(
      savings.contribute(
        {
          savingsAccountId: 'account',
          amount: '0',
          reference: 'ZERO-TEST-001',
          paymentMethod: 'CASH',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not confirm an unverified contribution receipt', async () => {
    db.paymentSubmission.findFirst.mockResolvedValue({
      id: 'payment',
      userId: 'member',
      status: 'SUBMITTED',
      receipt: 'receipt',
      gatewayPaidAt: null,
    });
    const gateway: any = { verify: jest.fn() };
    const workflow = new WorkflowService(db, gateway);
    await expect(workflow.review('payment', { decision: 'CONFIRM' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(gateway.verify).not.toHaveBeenCalled();
  });

  it('rechecks the gateway and credits a verified contribution with an audit and blockchain proof', async () => {
    const row = {
      id: 'payment',
      userId: 'member',
      groupId: 'group',
      loanId: null,
      status: 'SUBMITTED',
      receipt: 'receipt',
      gatewayPaidAt: new Date(),
      gateway: 'monime',
      gatewayId: 'gateway-payment',
      currency: 'SLE',
      reference: 'PAY-VERIFIED',
      amount: new Prisma.Decimal(25),
      kind: 'CONTRIBUTION',
      weekStart: null,
    };
    db.paymentSubmission.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValue({ ...row, status: 'CONFIRMED' });
    db.paymentSubmission.updateMany.mockResolvedValue({ count: 1 });
    db.groupMember.findFirst.mockResolvedValue({ id: 'membership' });
    db.savingsAccount.upsert = jest.fn().mockResolvedValue({ id: 'account', status: 'ACTIVE' });
    db.contribution.create.mockResolvedValue({ id: 'contribution' });
    db.transaction.create.mockImplementation(async ({ data }: any) => ({
      id: 'transaction',
      ...data,
    }));
    db.savingsAccount.aggregate.mockResolvedValue({ _sum: { balance: new Prisma.Decimal(25) } });
    db.proofDelivery = { create: jest.fn() };
    const gateway: any = { verify: jest.fn().mockResolvedValue({}) };
    const workflow = new WorkflowService(db, gateway);
    await expect(workflow.review('payment', { decision: 'CONFIRM' }, actor)).resolves.toMatchObject(
      { status: 'CONFIRMED' },
    );
    expect(gateway.verify).toHaveBeenCalledWith(
      row.reference,
      row.amount,
      row.gateway,
      row.currency,
      row.gatewayId,
    );
    expect(db.savingsAccount.update).toHaveBeenCalledWith({
      where: { id: 'account' },
      data: { balance: { increment: row.amount } },
    });
    expect(db.proofDelivery.create).toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PAYMENT_CONFIRMED', userId: actor.sub }),
    });
  });
});
