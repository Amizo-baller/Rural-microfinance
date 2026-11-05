import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type Actor = { sub: string; role: string };
const WEEK = 7 * 24 * 60 * 60 * 1000;
export function monday(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}

// Each confirmed contribution is allocated once to its selected payment week,
// or its recorded date for staff-entered contributions. Pending receipts are not savings.
export function contributionObligations(
  joinedAt: Date,
  weeklyAmount: Prisma.Decimal | null,
  entries: { amount: Prisma.Decimal; contributionDate: Date; reference: string | null }[],
  payments: { reference: string; weekStart: Date | null }[],
  now = new Date(),
  policies: { effectiveAt: Date; amount: Prisma.Decimal }[] = [],
) {
  if (weeklyAmount === null)
    return { configured: false, weeklyAmount: null, currency: 'SLE', weeks: [], totalDue: '0.00' };
  const first = monday(joinedAt),
    current = monday(now);
  const paid = new Map<string, Prisma.Decimal>();
  const paymentWeeks = new Map(payments.map((row) => [row.reference, row.weekStart]));
  for (const entry of entries) {
    const key = monday(paymentWeeks.get(entry.reference ?? '') ?? entry.contributionDate)
      .toISOString()
      .slice(0, 10);
    paid.set(key, (paid.get(key) ?? new Prisma.Decimal(0)).plus(entry.amount));
  }
  let totalDue = new Prisma.Decimal(0);
  const weeks: {
    weekStart: string;
    dueDate: string;
    expected: string;
    paid: string;
    remaining: string;
    status: string;
  }[] = [];
  for (let time = first.getTime(); time <= current.getTime(); time += WEEK) {
    const policy = policies.filter((row) => monday(row.effectiveAt).getTime() <= time).at(-1);
    // A newly configured policy never creates debt for earlier unconfigured weeks.
    if (policies.length && !policy) continue;
    const expected = policy?.amount ?? weeklyAmount;
    const weekStart = new Date(time).toISOString().slice(0, 10);
    const amount = paid.get(weekStart) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(0, expected.minus(amount));
    totalDue = totalDue.plus(remaining);
    weeks.push({
      weekStart,
      dueDate: new Date(time + WEEK - 1).toISOString().slice(0, 10),
      expected: expected.toFixed(2),
      paid: amount.toFixed(2),
      remaining: remaining.toFixed(2),
      status: remaining.isZero() ? 'PAID' : time < current.getTime() ? 'OVERDUE' : 'DUE',
    });
  }
  return {
    configured: true,
    weeklyAmount: weeklyAmount.toFixed(2),
    currency: 'SLE',
    weeks: weeks.reverse(),
    totalDue: totalDue.toFixed(2),
  };
}

@Injectable()
export class MemberSpaceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: Actor) {
    if (actor.role !== 'MEMBER') throw new ForbiddenException('Member access required');
    const membership = await this.prisma.groupMember.findUnique({
      where: { userId: actor.sub },
      select: {
        id: true,
        memberNumber: true,
        status: true,
        joinedAt: true,
        group: {
          select: {
            id: true,
            name: true,
            description: true,
            location: true,
            contactInfo: true,
            status: true,
            weeklyContributionAmount: true,
            withdrawalsAllowed: true,
          },
        },
      },
    });
    if (!membership) return { membership: null, accounts: [], obligations: null };
    const [accounts, entries, payments, policyLogs] = await Promise.all([
      this.prisma.savingsAccount.findMany({
        where: { groupMemberId: membership.id },
        select: { id: true, accountNumber: true, balance: true, withdrawalFeeDue: true, currency: true, status: true },
      }),
      this.prisma.contribution.findMany({
        where: { groupMemberId: membership.id, status: 'CONFIRMED', currency: 'SLE' },
        select: { amount: true, contributionDate: true, reference: true },
      }),
      this.prisma.paymentSubmission.findMany({
        where: {
          userId: actor.sub,
          groupId: membership.group.id,
          kind: 'CONTRIBUTION',
          status: 'CONFIRMED',
        },
        select: { reference: true, weekStart: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          entityType: 'CommunityGroup',
          entityId: membership.group.id,
          action: { in: ['GROUP_CREATED', 'GROUP_UPDATED'] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { createdAt: true, newValues: true },
      }),
    ]);
    const policies = policyLogs.flatMap((log) => {
      const value = log.newValues as { weeklyContributionAmount?: unknown } | null;
      return typeof value?.weeklyContributionAmount === 'string' &&
        /^\d+(\.\d{1,2})?$/.test(value.weeklyContributionAmount)
        ? [
            {
              effectiveAt: log.createdAt,
              amount: new Prisma.Decimal(value.weeklyContributionAmount),
            },
          ]
        : [];
    });
    return {
      membership,
      accounts: accounts.map((account) => ({
        ...account,
        availableBalance: Prisma.Decimal.max(0, account.balance.minus(account.withdrawalFeeDue ?? new Prisma.Decimal(0))).toFixed(2),
        canWithdraw:
          membership.status === 'ACTIVE' &&
          membership.group.status === 'ACTIVE' &&
          membership.group.withdrawalsAllowed &&
          account.status === 'ACTIVE',
      })),
      obligations: contributionObligations(
        membership.joinedAt,
        membership.group.weeklyContributionAmount,
        entries,
        payments,
        new Date(),
        policies,
      ),
    };
  }
}
