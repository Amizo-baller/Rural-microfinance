/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
// Route metadata can be tested without loading the runtime JWT implementation.
jest.mock('../auth/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../workflow/proof-delivery.service', () => ({ ProofDeliveryService: class {} }));
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { contributionObligations, MemberSpaceService, monday } from './member-space.service';
import { MembersService } from './members.service';
import { SavingsService } from '../savings/savings.service';
import { AdminOperationsService } from '../authorization/admin-operations.service';
import { FinancialRecordsService } from '../authorization/financial-records.service';
import { WorkflowController } from '../workflow/workflow.controller';
import { MemberSpaceController } from './member-space.controller';

const decimal = (value: number) => new Prisma.Decimal(value);
const member = { sub: 'member-user', role: 'MEMBER' };

describe('Member contribution obligations', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const joined = new Date('2026-10-05T10:00:00Z');
  it('normalizes Sunday to the preceding Monday without mutating its input', () => {
    const sunday = new Date('2026-10-18T23:59:59Z');
    expect(monday(sunday).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(sunday.toISOString()).toBe('2026-10-18T23:59:59.000Z');
  });
  it('does not invent obligations before the group configures an amount', () => {
    expect(contributionObligations(joined, null, [], [], now)).toMatchObject({
      configured: false,
      weeks: [],
      totalDue: '0.00',
    });
  });
  it('allocates backdated checkout to the selected week once', () => {
    const result = contributionObligations(
      joined,
      decimal(50),
      [
        { amount: decimal(30), reference: 'PAY-one', contributionDate: now },
        { amount: decimal(20), reference: 'CASH-two', contributionDate: new Date('2026-10-08') },
      ],
      [{ reference: 'PAY-one', weekStart: new Date('2026-10-05') }],
      now,
    );
    expect(result.totalDue).toBe('100.00');
    expect(result.weeks[2]).toMatchObject({
      weekStart: '2026-10-05',
      paid: '50.00',
      remaining: '0.00',
      status: 'PAID',
    });
    expect(result.weeks[1].status).toBe('OVERDUE');
    expect(result.weeks[0].status).toBe('DUE');
  });
  it('does not count excess paid in one week toward another week', () => {
    const result = contributionObligations(
      joined,
      decimal(50),
      [{ amount: decimal(75), reference: null, contributionDate: joined }],
      [],
      now,
    );
    expect(result.totalDue).toBe('100.00');
    expect(result.weeks[2].remaining).toBe('0.00');
  });
  it('preserves old rates and does not create debt before the policy began', () => {
    const result = contributionObligations(joined, decimal(75), [], [], now, [
      { effectiveAt: new Date('2026-10-14'), amount: decimal(50) },
      { effectiveAt: now, amount: decimal(75) },
    ]);
    expect(result.weeks.map((row) => row.expected)).toEqual(['75.00', '50.00']);
    expect(result.totalDue).toBe('125.00');
  });
  it('supports a zero obligation', () => {
    expect(
      contributionObligations(joined, decimal(0), [], [], now).weeks.every(
        (row) => row.status === 'PAID',
      ),
    ).toBe(true);
  });
});
describe('Member self service and ownership', () => {
  let db: any;
  beforeEach(() => {
    const model = () => ({
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: decimal(0) } }),
      groupBy: jest.fn().mockResolvedValue([]),
    });
    db = {
      user: model(),
      communityGroup: model(),
      groupMember: model(),
      savingsAccount: model(),
      contribution: model(),
      paymentSubmission: model(),
      withdrawalRequest: model(),
      auditLog: model(),
      notification: model(),
      transaction: model(),
    };
    db.$transaction = jest.fn((work) =>
      typeof work === 'function' ? work(db) : Promise.all(work),
    );
    db.user.findUnique.mockResolvedValue({
      id: member.sub,
      status: 'ACTIVE',
      role: { name: 'MEMBER' },
    });
    db.communityGroup.findUnique.mockResolvedValue({
      id: 'group',
      name: 'Village savings',
      status: 'ACTIVE',
    });
    db.groupMember.findUnique.mockResolvedValue(null);
    db.groupMember.create.mockResolvedValue({ id: 'membership' });
  });
  it('joins using the authenticated identity and audits and notifies in the transaction', async () => {
    await new MembersService(db).join('group', member);
    expect(db.groupMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: member.sub, groupId: 'group' }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: member.sub }) }),
    );
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
  it.each(['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'GROUP_MANAGER', 'LOAN_OFFICER', 'AUDITOR'])(
    'prevents %s from using member joining',
    async (role) => {
      await expect(new MembersService(db).join('group', { ...member, role })).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.groupMember.create).not.toHaveBeenCalled();
    },
  );
  it('rejects joining a second group', async () => {
    db.groupMember.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(new MembersService(db).join('group', member)).rejects.toThrow(ConflictException);
  });
  it('rejects joining a suspended group', async () => {
    db.communityGroup.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(new MembersService(db).join('group', member)).rejects.toThrow(NotFoundException);
  });
  it('rejects suspended users even when called outside the controller', async () => {
    db.user.findUnique.mockResolvedValue({ status: 'SUSPENDED', role: { name: 'MEMBER' } });
    await expect(new MembersService(db).join('group', member)).rejects.toThrow(NotFoundException);
  });
  it('returns an empty workspace for an unassigned member', async () => {
    expect(await new MemberSpaceService(db).overview(member)).toEqual({
      membership: null,
      accounts: [],
      obligations: null,
    });
    expect(db.groupMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: member.sub } }),
    );
  });
  it('scopes accounts and confirmed contributions to the member and reports reserved balance accurately', async () => {
    db.groupMember.findUnique.mockResolvedValue({
      id: 'membership',
      status: 'ACTIVE',
      joinedAt: new Date(),
      group: {
        id: 'group',
        status: 'ACTIVE',
        weeklyContributionAmount: null,
        withdrawalsAllowed: true,
      },
    });
    db.savingsAccount.findMany.mockResolvedValue([
      { id: 'account', balance: decimal(100), currency: 'SLE', status: 'ACTIVE' },
    ]);
    db.withdrawalRequest.groupBy.mockResolvedValue([
      { savingsAccountId: 'account', _sum: { amount: decimal(30) } },
    ]);
    const result = await new MemberSpaceService(db).overview(member);
    expect(result.accounts[0]).toMatchObject({ availableBalance: '100.00', canWithdraw: true });
    expect(db.contribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupMemberId: 'membership', status: 'CONFIRMED', currency: 'SLE' },
      }),
    );
  });
  it.each(['ACTIVE', 'FROZEN', 'CLOSED'])(
    'prevents a member from setting savings status to %s',
    async (status) => {
      await expect(
        new SavingsService(db, {} as any).updateAccountStatus('account', status as any, member),
      ).rejects.toThrow(ForbiddenException);
      expect(db.savingsAccount.update).not.toHaveBeenCalled();
    },
  );
  it('prevents withdrawal from another member account', async () => {
    db.savingsAccount.findUnique.mockResolvedValue({
      id: 'account',
      groupMember: { userId: 'someone-else' },
    });
    await expect(
      new AdminOperationsService(db).requestWithdrawal(
        {
          savingsAccountId: 'account',
          amount: '10',
          reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
          reference: 'WD-reference-one',
        },
        member,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('enforces group withdrawal policy and pending reservations', async () => {
    const account = {
      id: 'account',
      status: 'ACTIVE',
      balance: decimal(100),
      groupMember: {
        userId: member.sub,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        group: { status: 'ACTIVE', withdrawalsAllowed: false },
      },
    };
    db.savingsAccount.findUnique.mockResolvedValue(account);
    const operations = new AdminOperationsService(db);
    const dto = {
      savingsAccountId: 'account',
      amount: '80',
      reason: 'School fees',
          providerId: 'orange', payoutPhone: '+23276123456',
      reference: 'WD-reference-one',
    };
    await expect(operations.requestWithdrawal(dto, member)).rejects.toThrow(ConflictException);
    account.groupMember.group.withdrawalsAllowed = true;
    db.savingsAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(operations.requestWithdrawal(dto, member)).rejects.toThrow(ConflictException);
    expect(db.withdrawalRequest.create).not.toHaveBeenCalled();
  });
  it('prevents an auditor from correcting financial records at the service layer', async () => {
    await expect(
      new FinancialRecordsService(db).correct(
        'record',
        { amount: '10', reference: 'CORR-one', reason: 'Correction reason' },
        { sub: 'auditor', role: 'AUDITOR' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('protects member routes and workflow writes with explicit metadata', () => {
    expect(Reflect.getMetadata('roles', MemberSpaceController)).toEqual(['MEMBER']);
    for (const method of ['start', 'verify', 'submit'] as const)
      expect(Reflect.getMetadata('permissions', WorkflowController.prototype[method])).toEqual([
        'financial:write',
      ]);
  });
});
