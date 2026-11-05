/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
jest.mock('@nestjs/schedule', () => ({ Interval: () => () => undefined }));
import { WorkflowService } from './workflow.service';
import { MonimeReconciliationService } from './monime-reconciliation.service';

describe('Monime automatic accounting', () => {
  let db: any;
  let gateway: any;
  let service: WorkflowService;
  let row: any;
  beforeEach(() => {
    row = { id: 'payment', userId: 'member', groupId: 'group', loanId: null,
      kind: 'CONTRIBUTION', amount: new Prisma.Decimal('12.50'), currency: 'SLE',
      gateway: 'monime', gatewayId: 'cs-linked', reference: 'PAY-LINKED',
      gatewayPaidAt: null, status: 'AWAITING_PAYMENT', transactionId: null, weekStart: null,
      user: { id: 'member', memberId: 'MEM001', firstName: 'Test', lastName: 'Member' } };
    db = {
      paymentSubmission: { findUnique: jest.fn(async () => ({ ...row })), findFirst: jest.fn(async () => ({ ...row })),
        updateMany: jest.fn(async ({ data }) => { if (row.status === 'CONFIRMED') return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
        update: jest.fn(async ({ data }) => Object.assign(row, data)) },
      groupMember: { findFirst: jest.fn().mockResolvedValue({ id: 'membership' }) },
      savingsAccount: { upsert: jest.fn().mockResolvedValue({ id: 'savings', status: 'ACTIVE' }), update: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _sum: { balance: new Prisma.Decimal('12.50') } }) },
      contribution: { create: jest.fn().mockResolvedValue({ id: 'contribution' }) },
      transaction: { create: jest.fn(async ({ data }) => ({ id: 'ledger', ...data })) },
      proofDelivery: { create: jest.fn() }, notification: { create: jest.fn() }, auditLog: { create: jest.fn() },
      loan: { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      loanRepayment: { create: jest.fn().mockResolvedValue({ id: 'repayment' }) },
    };
    db.$transaction = jest.fn((work) => work(db));
    gateway = { mode: jest.fn().mockReturnValue('live'), verify: jest.fn().mockResolvedValue('cs-linked') };
    service = new WorkflowService(db, gateway);
  });

  it('verifies the stored session and credits a contribution without requiring a receipt', async () => {
    await service.synchronizeMonimePayment(row.id);
    expect(gateway.verify).toHaveBeenCalledWith('PAY-LINKED', new Prisma.Decimal('12.50'), 'monime', 'SLE', 'cs-linked');
    expect(db.savingsAccount.update).toHaveBeenCalledWith({ where: { id: 'savings' }, data: { balance: { increment: new Prisma.Decimal('12.50') } } });
    expect(row).toMatchObject({ status: 'CONFIRMED', transactionId: 'ledger', reviewerId: null });
    expect(row.gatewayPaidAt).toBeInstanceOf(Date);
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PAYMENT_CONFIRMED', newValues: expect.objectContaining({ automatic: true }) }) });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.proofDelivery.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('does not credit a repeated reconciliation', async () => {
    await service.synchronizeMonimePayment(row.id);
    await service.synchronizeMonimePayment(row.id);
    expect(db.savingsAccount.update).toHaveBeenCalledTimes(1);
    expect(db.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('does not credit when another worker has already claimed the payment', async () => {
    db.paymentSubmission.updateMany.mockResolvedValue({ count: 0 });
    await service.synchronizeMonimePayment(row.id);
    expect(db.contribution.create).not.toHaveBeenCalled();
    expect(db.savingsAccount.update).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict for a concurrent transaction without posting a credit', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(service.synchronizeMonimePayment(row.id)).rejects.toMatchObject({ status: 409 });
    expect(db.savingsAccount.update).not.toHaveBeenCalled();
  });

  it.each(['pending', 'mismatched amount', 'gateway unavailable'])('does not post when verification fails: %s', async (message) => {
    gateway.verify.mockRejectedValue(new ConflictException(message));
    await expect(service.synchronizeMonimePayment(row.id)).rejects.toThrow(message);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(row.status).toBe('AWAITING_PAYMENT');
  });

  it.each(['test', null])('does not automatically post in %s gateway mode', async (mode) => {
    gateway.mode.mockReturnValue(mode);
    await service.synchronizeMonimePayment(row.id);
    expect(gateway.verify).not.toHaveBeenCalled();
  });

  it.each([{ gatewayId: null }, { gateway: 'paystack' }, { status: 'REJECTED' }, { transactionId: 'existing' }])('ignores ineligible payment %j', async (changes) => {
    Object.assign(row, changes);
    await service.synchronizeMonimePayment(row.id);
    expect(gateway.verify).not.toHaveBeenCalled();
  });

  it('updates loan repayments without increasing savings', async () => {
    Object.assign(row, { kind: 'REPAYMENT', loanId: 'loan' });
    db.loan.findFirst.mockResolvedValue({ id: 'loan', outstandingBalance: new Prisma.Decimal('50') });
    await service.synchronizeMonimePayment(row.id);
    expect(db.loan.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outstandingBalance: { decrement: row.amount } }) }));
    expect(db.loanRepayment.create).toHaveBeenCalledTimes(1);
    expect(db.savingsAccount.update).not.toHaveBeenCalled();
    expect(db.contribution.create).not.toHaveBeenCalled();
  });

  it('lets the paying member trigger immediate live reconciliation', async () => {
    await expect(service.verifyPayment(row.id, { sub: 'member', role: 'MEMBER' })).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(db.contribution.create).toHaveBeenCalledTimes(1);
  });

  it('does not let another member verify this payment', async () => {
    await expect(service.verifyPayment(row.id, { sub: 'someone-else', role: 'MEMBER' })).rejects.toMatchObject({ status: 403 });
    expect(gateway.verify).not.toHaveBeenCalled();
  });

  it('does not credit an inactive membership', async () => {
    db.groupMember.findFirst.mockResolvedValue(null);
    await expect(service.synchronizeMonimePayment(row.id)).rejects.toThrow('no longer active');
    expect(db.savingsAccount.update).not.toHaveBeenCalled();
  });
});

describe('Monime reconciliation scheduling', () => {
  it('continues past one unavailable checkout and visits later pages', async () => {
    const batches = [Array.from({ length: 10 }, (_, n) => ({ id: `payment-${n}` })), [{ id: 'last' }]];
    const db: any = { paymentSubmission: { findMany: jest.fn().mockResolvedValueOnce(batches[0]).mockResolvedValueOnce(batches[1]) } };
    const gateway: any = { mode: () => 'live' };
    const workflow: any = { synchronizeMonimePayment: jest.fn().mockRejectedValueOnce(new ConflictException('pending')).mockResolvedValue(undefined) };
    const scheduler = new MonimeReconciliationService(db, gateway, workflow);
    await scheduler.reconcile();
    await scheduler.reconcile();
    expect(workflow.synchronizeMonimePayment).toHaveBeenCalledTimes(11);
    expect(db.paymentSubmission.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'payment-9' }, skip: 1 });
  });

  it('skips test mode and overlapping scheduled runs', async () => {
    let finish!: (rows: unknown[]) => void;
    const db: any = { paymentSubmission: { findMany: jest.fn(() => new Promise((resolve) => { finish = resolve; })) } };
    const gateway: any = { mode: jest.fn().mockReturnValue('test') };
    const scheduler = new MonimeReconciliationService(db, gateway, {} as any);
    await scheduler.reconcile();
    expect(db.paymentSubmission.findMany).not.toHaveBeenCalled();
    gateway.mode.mockReturnValue('live');
    const first = scheduler.reconcile();
    await scheduler.reconcile();
    expect(db.paymentSubmission.findMany).toHaveBeenCalledTimes(1);
    finish([]);
    await first;
  });
});
