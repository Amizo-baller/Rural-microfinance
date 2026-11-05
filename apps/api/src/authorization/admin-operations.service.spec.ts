/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminOperationsService } from './admin-operations.service';

describe('AdminOperationsService', () => {
  let db: any;
  let service: AdminOperationsService;
  const actor = { sub: 'admin', role: 'ADMIN' };
  const account = () => ({
    id: 'account',
    status: 'ACTIVE',
    currency: 'SLE',
    balance: new Prisma.Decimal(100),
    withdrawalFeeDue: new Prisma.Decimal(0),
    groupMemberId: 'member',
    groupMember: {
      userId: 'owner',
      groupId: 'group',
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
      group: { status: 'ACTIVE' },
    },
  });
  const withdrawal = () => ({
    id: 'request',
    savingsAccountId: 'account',
    requesterId: 'owner',
    status: 'PENDING',
    reference: 'WD-TEST-12345',
    amount: new Prisma.Decimal(30),
    payoutDestination: { type: 'momo', providerId: 'orange', accountNumber: '+23276123456' },
    reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
    savingsAccount: account(),
  });
  beforeEach(() => {
    const model = () => ({
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
    });
    db = {
      withdrawalRequest: model(),
      savingsAccount: model(),
      transaction: model(),
      auditLog: model(),
      notification: model(),
      communityGroup: model(),
      savingsCycle: model(),
      blockchainTransaction: model(),
      proofDelivery: model(),
    };
    db.$transaction = jest.fn((work) =>
      typeof work === 'function' ? work(db) : Promise.all(work),
    );
    service = new AdminOperationsService(db);
    db.withdrawalRequest.findUnique.mockResolvedValue(withdrawal());
    db.withdrawalRequest.update.mockResolvedValue({ status: 'APPROVED' });
    db.savingsAccount.findUnique.mockResolvedValue(account());
    db.savingsAccount.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each(['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER'])(
    'denies %s access to platform audit and decisions',
    async (role) => {
      await expect(
        service.audit({ page: 1, limit: 25 }, { sub: 'other', role }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.reviewWithdrawal(
          'request',
          { decision: 'APPROVED', notes: 'Reviewed receipt' },
          { sub: 'other', role },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('moves an approved withdrawal to processing and notifies and audits it', async () => {
    await service.reviewWithdrawal(
      'request',
      { decision: 'APPROVED', notes: 'Reviewed receipt' },
      actor,
    );
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 10000,
      timeout: 30000,
    });
    expect(db.savingsAccount.updateMany).not.toHaveBeenCalled();
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.withdrawalRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING', payoutIdempotencyKey: expect.any(String) }) }));
    expect(db.auditLog.create).toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalled();
  });

  it('rejects without touching the balance or ledger', async () => {
    await service.reviewWithdrawal(
      'request',
      { decision: 'REJECTED', notes: 'Missing documentation' },
      actor,
    );
    expect(db.savingsAccount.update).toHaveBeenCalledWith({ where: { id: 'account' }, data: { balance: { increment: new Prisma.Decimal(30) } } });
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.withdrawalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });

  it('prevents double processing of an approved withdrawal', async () => {
    db.withdrawalRequest.findUnique.mockResolvedValue({ ...withdrawal(), status: 'APPROVED' });
    await expect(
      service.reviewWithdrawal('request', { decision: 'APPROVED', notes: 'Try again' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.savingsAccount.updateMany).not.toHaveBeenCalled();
  });

  it.each(['requester', 'account owner'])('prevents self-review as %s', async (kind) => {
    const row = withdrawal();
    if (kind === 'requester') row.requesterId = actor.sub;
    else row.savingsAccount.groupMember.userId = actor.sub;
    db.withdrawalRequest.findUnique.mockResolvedValue(row);
    await expect(
      service.reviewWithdrawal('request', { decision: 'APPROVED', notes: 'Own request' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.savingsAccount.updateMany).not.toHaveBeenCalled();
  });

  it('cannot overdraw or debit frozen accounts', async () => {
    const row = withdrawal();
    row.savingsAccount.status = 'FROZEN';
    db.withdrawalRequest.findUnique.mockResolvedValue(row);
    await expect(
      service.reviewWithdrawal(
        'request',
        { decision: 'APPROVED', notes: 'Reviewed receipt' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.withdrawalRequest.update).not.toHaveBeenCalled();
  });

  it('validates review notes', async () => {
    await expect(
      service.reviewWithdrawal('request', { decision: 'REJECTED', notes: '     ' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps pending requests within available savings', async () => {
    db.withdrawalRequest.findUnique.mockResolvedValue(null);
    db.savingsAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.requestWithdrawal(
        {
          savingsAccountId: 'account',
          amount: '30',
          reference: 'WD-TEST-12345',
          reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
        },
        { sub: 'owner', role: 'MEMBER' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('includes outstanding Monime fees in the atomic available-savings check', async () => {
    db.withdrawalRequest.findUnique.mockResolvedValue(null);
    db.savingsAccount.findUnique.mockResolvedValue({ ...account(), balance: new Prisma.Decimal(50), withdrawalFeeDue: new Prisma.Decimal(25) });
    db.savingsAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.requestWithdrawal({
      savingsAccountId: 'account', amount: '30', reference: 'WD-FEE-TEST-123', reason: 'School fees',
      providerId: 'orange', payoutPhone: '+23276123456',
    }, { sub: 'owner', role: 'MEMBER' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.savingsAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ balance: { gte: new Prisma.Decimal(55) } }),
    }));
    expect(db.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('returns the existing request on a matching retry', async () => {
    await expect(
      service.requestWithdrawal(
        {
          savingsAccountId: 'account',
          amount: '30',
          reference: 'WD-TEST-12345',
          reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
        },
        { sub: 'owner', role: 'MEMBER' },
      ),
    ).resolves.toMatchObject({ id: 'request' });
    expect(db.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('denies a member access to another member’s savings', async () => {
    await expect(
      service.requestWithdrawal(
        {
          savingsAccountId: 'account',
          amount: '30',
          reference: 'WD-TEST-12345',
          reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
        },
        { sub: 'stranger', role: 'MEMBER' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes member withdrawal history to the account owner', async () => {
    db.withdrawalRequest.findMany.mockResolvedValue([]);
    db.withdrawalRequest.count.mockResolvedValue(0);
    await service.withdrawals({ page: 1, limit: 25 }, { sub: 'owner', role: 'MEMBER' });
    expect(db.withdrawalRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { savingsAccount: { groupMember: { userId: 'owner' } } } }),
    );
  });

  it('handles concurrent updates as a recoverable conflict', async () => {
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(
      service.reviewWithdrawal(
        'request',
        { decision: 'APPROVED', notes: 'Reviewed receipt' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid cycle dates and targets', async () => {
    await expect(
      service.createCycle(
        {
          groupId: 'group',
          name: 'Term',
          startDate: '2026-10-01',
          endDate: '2026-09-01',
          targetAmount: '100',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents a second active cycle for the same group', async () => {
    db.savingsCycle.findUnique.mockResolvedValue({
      id: 'cycle',
      groupId: 'group',
      status: 'PLANNED',
    });
    db.communityGroup.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    db.savingsCycle.count.mockResolvedValue(1);
    await expect(service.cycleStatus('cycle', { status: 'ACTIVE' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.savingsCycle.update).not.toHaveBeenCalled();
  });

  it('cannot reopen a completed cycle', async () => {
    db.savingsCycle.findUnique.mockResolvedValue({ status: 'COMPLETED' });
    await expect(service.cycleStatus('cycle', { status: 'ACTIVE' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('serializes blockchain block numbers safely for JSON responses', async () => {
    db.blockchainTransaction.findMany.mockResolvedValue([
      { id: 'chain', blockNumber: BigInt('12345678901234567') },
    ]);
    db.blockchainTransaction.count.mockResolvedValue(1);
    db.proofDelivery.groupBy.mockResolvedValue([]);
    const result = await service.blockchain({ page: 1, limit: 25 }, actor);
    expect(JSON.parse(JSON.stringify(result)).items[0].blockNumber).toBe('12345678901234567');
  });
});
