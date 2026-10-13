import { Injectable } from '@nestjs/common';
import { LoanApplicationStatus, LoanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ReportsFilterDto } from './dto';

type Actor = { sub: string; role: string };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private hasFullAccess(actor: Actor) { return ['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER'].includes(actor.role); }

  private buildDateRange(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
    return {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  private asNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return value === null || value === undefined ? 0 : Number(value);
  }

  private toMonthlySeries(items: Array<{ date: Date | string | null; amount: Prisma.Decimal | number | string | null }>) {
    const buckets = new Map<string, number>();
    for (const item of items) {
      const entryDate = item.date ? new Date(item.date) : null;
      if (!entryDate || Number.isNaN(entryDate.valueOf())) continue;
      const monthKey = entryDate.toISOString().slice(0, 7);
      buckets.set(monthKey, (buckets.get(monthKey) ?? 0) + this.asNumber(item.amount));
    }
    return Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([month, total]) => ({ month, total }));
  }

  private memberScope(actor: Actor, groupId?: string, memberId?: string): Prisma.GroupMemberWhereInput {
    const base: Prisma.GroupMemberWhereInput = {
      ...(groupId ? { groupId } : {}),
      ...(memberId ? { id: memberId } : {}),
    };
    if (this.hasFullAccess(actor)) return base;
    if (actor.role === 'GROUP_MANAGER') return { ...base, group: { managerId: actor.sub } };
    return { ...base, userId: actor.sub };
  }

  private loanScope(actor: Actor, groupId?: string, memberId?: string): Prisma.LoanWhereInput {
    const base: Prisma.LoanWhereInput = {
      ...(groupId ? { groupId } : {}),
      ...(memberId ? { groupMemberId: memberId } : {}),
    };
    if (this.hasFullAccess(actor)) return base;
    if (actor.role === 'GROUP_MANAGER') return { ...base, group: { managerId: actor.sub } } as Prisma.LoanWhereInput;
    return { ...base, groupMember: { userId: actor.sub } } as Prisma.LoanWhereInput;
  }

  private transactionScope(actor: Actor, groupId?: string, memberId?: string): Prisma.TransactionWhereInput {
    const base: Prisma.TransactionWhereInput = {
      ...(groupId ? { groupId } : {}),
      ...(memberId ? { groupMemberId: memberId } : {}),
    };
    if (this.hasFullAccess(actor)) return base;
    if (actor.role === 'GROUP_MANAGER') return { ...base, group: { managerId: actor.sub } } as Prisma.TransactionWhereInput;
    return { ...base, groupMember: { userId: actor.sub } } as Prisma.TransactionWhereInput;
  }

  async analytics(query: ReportsFilterDto, actor: Actor) {
    const groupId = query.groupId ?? query.group;
    const memberId = query.memberId ?? query.member;
    const dateRange = this.buildDateRange(query.from, query.to);

    const memberWhere = this.memberScope(actor, groupId, memberId);
    const loanWhere = this.loanScope(actor, groupId, memberId);
    const transactionWhere = this.transactionScope(actor, groupId, memberId);
    const typedTransactionWhere: Prisma.TransactionWhereInput | undefined = query.transactionType
      ? { ...transactionWhere, type: query.transactionType }
      : undefined;
    const hasBlockchainTransactionScope = Boolean(query.transactionType || groupId || memberId || !this.hasFullAccess(actor));
    const blockchainScope = hasBlockchainTransactionScope
      ? { transaction: { is: typedTransactionWhere ?? transactionWhere } }
      : {};

    const [members, activeMembers, inactiveMembers, , , rejectedApplications, totalLoans, approvedLoans, activeLoans, completedLoans, defaultedLoans, totalRepayments, totalBlockchainTxs, blockchainVerified, blockchainPending, blockchainFailed] = await Promise.all([
      this.prisma.groupMember.count({ where: { ...memberWhere, joinedAt: Object.keys(dateRange).length ? dateRange : undefined } }),
      this.prisma.groupMember.count({ where: { ...memberWhere, status: 'ACTIVE', joinedAt: Object.keys(dateRange).length ? dateRange : undefined } }),
      this.prisma.groupMember.count({ where: { ...memberWhere, status: { not: 'ACTIVE' }, joinedAt: Object.keys(dateRange).length ? dateRange : undefined } }),
      this.prisma.loanApplication.count({
        where: {
          ...(groupId ? { groupId } : {}),
          ...(memberId ? { groupMemberId: memberId } : {}),
          ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      this.prisma.loanApplication.count({
        where: {
          ...(groupId ? { groupId } : {}),
          ...(memberId ? { groupMemberId: memberId } : {}),
          ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
          status: 'APPROVED',
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      query.loanStatus && query.loanStatus !== LoanApplicationStatus.REJECTED ? Promise.resolve(0) : this.prisma.loanApplication.count({
        where: {
          ...(groupId ? { groupId } : {}),
          ...(memberId ? { groupMemberId: memberId } : {}),
          ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
          status: 'REJECTED',
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      query.loanStatus === LoanApplicationStatus.REJECTED ? Promise.resolve(0) : this.prisma.loan.count({
        where: {
          ...loanWhere,
          ...(query.loanStatus ? { status: query.loanStatus } : {}),
          ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
        },
      }),
      !query.loanStatus || query.loanStatus === LoanStatus.APPROVED ? this.prisma.loan.count({
        where: {
          ...loanWhere,
          status: LoanStatus.APPROVED,
          ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
        },
      }) : Promise.resolve(0),
      !query.loanStatus || query.loanStatus === LoanStatus.ACTIVE ? this.prisma.loan.count({
        where: {
          ...loanWhere,
          status: LoanStatus.ACTIVE,
          ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
        },
      }) : Promise.resolve(0),
      !query.loanStatus || query.loanStatus === LoanStatus.COMPLETED ? this.prisma.loan.count({
        where: {
          ...loanWhere,
          status: LoanStatus.COMPLETED,
          ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
        },
      }) : Promise.resolve(0),
      !query.loanStatus || query.loanStatus === LoanStatus.DEFAULTED ? this.prisma.loan.count({
        where: {
          ...loanWhere,
          status: LoanStatus.DEFAULTED,
          ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
        },
      }) : Promise.resolve(0),
      query.loanStatus === LoanApplicationStatus.REJECTED ? Promise.resolve({ _sum: { amount: 0 } }) : this.prisma.loanRepayment.aggregate({
        where: {
          ...(groupId ? { groupMember: { groupId } } : {}),
          ...(memberId ? { groupMemberId: memberId } : {}),
          ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
          ...(query.loanStatus ? { loan: { status: query.loanStatus as LoanStatus } } : {}),
          ...(typedTransactionWhere ? { transaction: { is: typedTransactionWhere } } : {}),
          ...(Object.keys(dateRange).length ? { paidAt: dateRange } : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.blockchainTransaction.count({
        where: {
          ...blockchainScope,
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      this.prisma.blockchainTransaction.count({
        where: {
          ...blockchainScope,
          status: 'CONFIRMED',
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      this.prisma.blockchainTransaction.count({
        where: {
          ...blockchainScope,
          status: { in: ['PENDING', 'SUBMITTED'] },
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
      this.prisma.blockchainTransaction.count({
        where: {
          ...blockchainScope,
          status: 'FAILED',
          ...(Object.keys(dateRange).length ? { submittedAt: dateRange } : {}),
        },
      }),
    ]);

    const savingsAccounts = await this.prisma.savingsAccount.findMany({
      where: {
        ...(groupId ? { groupMember: { groupId } } : {}),
        ...(memberId ? { groupMemberId: memberId } : {}),
        ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
        ...(query.to ? { openedAt: { lte: dateRange.lte } } : {}),
      },
      select: {
        balance: true,
        groupMemberId: true,
        groupMember: {
          select: {
            id: true,
            memberNumber: true,
            user: { select: { firstName: true, lastName: true } },
            group: { select: { id: true, name: true } },
          },
        },
      },
    });

    const historicalSavings = query.to
      ? await this.prisma.contribution.groupBy({
          by: ['groupMemberId'],
          where: {
            groupMember: { is: memberWhere },
            status: 'CONFIRMED',
            contributionDate: { lte: dateRange.lte },
          },
          _sum: { amount: true },
        })
      : null;
    const historicalSavingsByMember = new Map(
      (historicalSavings ?? []).map((item) => [item.groupMemberId, item._sum.amount ?? 0]),
    );
    const memberSavings = savingsAccounts.map((account) => ({
      memberId: account.groupMember.id,
      memberNumber: account.groupMember.memberNumber,
      name: `${account.groupMember.user.firstName} ${account.groupMember.user.lastName}`.trim(),
      groupId: account.groupMember.group.id,
      groupName: account.groupMember.group.name,
      savings: this.asNumber(query.to ? historicalSavingsByMember.get(account.groupMemberId) : account.balance),
    }));
    const totalSavings = memberSavings.reduce((sum, account) => sum.plus(account.savings), new Prisma.Decimal(0));

    const contributionRows = await this.prisma.contribution.findMany({
      where: {
        ...(groupId ? { groupMember: { groupId } } : {}),
        ...(memberId ? { groupMemberId: memberId } : {}),
        ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
        ...(typedTransactionWhere ? { transaction: { is: typedTransactionWhere } } : {}),
        ...(Object.keys(dateRange).length ? { contributionDate: dateRange } : {}),
      },
      select: { amount: true, contributionDate: true },
    });

    const repaymentRows = query.loanStatus === LoanApplicationStatus.REJECTED ? [] : await this.prisma.loanRepayment.findMany({
      where: {
        ...(groupId ? { groupMember: { groupId } } : {}),
        ...(memberId ? { groupMemberId: memberId } : {}),
        ...(this.hasFullAccess(actor) ? {} : { groupMember: { is: this.memberScope(actor, groupId, memberId) } }),
        ...(query.loanStatus ? { loan: { status: query.loanStatus as LoanStatus } } : {}),
        ...(typedTransactionWhere ? { transaction: { is: typedTransactionWhere } } : {}),
        ...(Object.keys(dateRange).length ? { paidAt: dateRange } : {}),
      },
      select: { amount: true, paidAt: true },
    });

    const loanRows = query.loanStatus === LoanApplicationStatus.REJECTED ? [] : await this.prisma.loan.findMany({
      where: {
        ...loanWhere,
        ...(query.loanStatus ? { status: query.loanStatus as LoanStatus } : {}),
        ...(Object.keys(dateRange).length ? { createdAt: dateRange } : {}),
      },
      select: { outstandingBalance: true, status: true, createdAt: true },
    });

    const outstandingLoanBalance = loanRows.reduce((sum, loan) => sum.plus(new Prisma.Decimal(loan.outstandingBalance ?? 0)), new Prisma.Decimal(0));
    const outstandingRepayments = loanRows.filter((loan) => this.asNumber(loan.outstandingBalance) > 0).reduce((sum, loan) => sum.plus(new Prisma.Decimal(loan.outstandingBalance ?? 0)), new Prisma.Decimal(0));

    return {
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
        groupId: groupId ?? null,
        memberId: memberId ?? null,
        transactionType: query.transactionType ?? null,
        loanStatus: query.loanStatus ?? null,
      },
      members: {
        totalMembers: members,
        activeMembers: activeMembers,
        inactiveMembers: inactiveMembers,
      },
      savings: {
        totalSavings: this.asNumber(totalSavings),
        monthlyContributions: this.toMonthlySeries(contributionRows.map((item) => ({ date: item.contributionDate, amount: item.amount }))),
        memberSavings,
      },
      loans: {
        totalLoans: totalLoans,
        approvedLoans: approvedLoans,
        rejectedLoans: rejectedApplications,
        activeLoans: activeLoans,
        completedLoans: completedLoans,
        defaultedLoans: defaultedLoans,
        outstandingBalance: this.asNumber(outstandingLoanBalance),
      },
      repayments: {
        totalRepayments: this.asNumber(totalRepayments._sum.amount ?? 0),
        monthlyRepayments: this.toMonthlySeries(repaymentRows.map((item) => ({ date: item.paidAt, amount: item.amount }))),
        outstandingRepayments: this.asNumber(outstandingRepayments),
      },
      blockchain: {
        totalTransactions: totalBlockchainTxs,
        verifiedTransactions: blockchainVerified,
        pendingTransactions: blockchainPending,
        failedTransactions: blockchainFailed,
      },
    };
  }
}
