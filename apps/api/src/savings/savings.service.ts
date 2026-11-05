import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ContributionStatus, Prisma, SavingsAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateSavingsAccountDto, ListContributionsDto, RecordContributionDto, StatementDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

type Actor = { sub: string; role: string };

const accountSelect = {
  currency: true,
  id: true, accountNumber: true, balance: true, status: true, openedAt: true, closedAt: true, createdAt: true,
  groupMember: { select: { id: true, memberNumber: true, status: true, userId: true, groupId: true, user: { select: { firstName: true, lastName: true } }, group: { select: { name: true } } } },
} satisfies Prisma.SavingsAccountSelect;

const contributionSelect = {
  currency: true,
  id: true, amount: true, contributionDate: true, reference: true, paymentMethod: true, description: true, status: true, createdAt: true,
  savingsAccount: { select: { id: true, accountNumber: true } },
  groupMember: { select: { id: true, memberNumber: true, userId: true, groupId: true, user: { select: { firstName: true, lastName: true } }, group: { select: { id: true, name: true } } } },
} satisfies Prisma.ContributionSelect;

@Injectable()
export class SavingsService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  private hasFullAccess(actor: Actor) { return ['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'AUDITOR'].includes(actor.role); }

  private async memberOrThrow(id: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { id }, select: { id: true, userId: true, groupId: true, memberNumber: true, status: true } });
    if (!member) throw new NotFoundException('Group member not found');
    return member;
  }

  private async assertMemberAccess(member: { userId: string; groupId: string }, actor: Actor) {
    if (this.hasFullAccess(actor) || member.userId === actor.sub) return;
    if (actor.role === 'GROUP_MANAGER') {
      const group = await this.prisma.communityGroup.findUnique({ where: { id: member.groupId }, select: { managerId: true } });
      if (group?.managerId === actor.sub) return;
    }
    throw new ForbiddenException('You cannot access this savings account');
  }

  private async accountOrThrow(id: string) {
    const account = await this.prisma.savingsAccount.findUnique({ where: { id }, select: { id: true, groupMemberId: true, status: true } });
    if (!account) throw new NotFoundException('Savings account not found');
    return account;
  }

  async createAccount(dto: CreateSavingsAccountDto, actor: Actor) {
    const member = await this.memberOrThrow(dto.groupMemberId);
    await this.assertMemberAccess(member, actor);
    if (member.status !== 'ACTIVE') throw new ConflictException('Only active members can open savings accounts');
    try {
      return await this.prisma.savingsAccount.create({
        data: { groupMemberId: member.id, currency: 'SLE', accountNumber: `SAV-SLE-${member.id.replaceAll('-', '').toUpperCase()}` }, select: accountSelect,
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('This member already has a savings account');
      throw error;
    }
  }

  async account(id: string, actor: Actor) {
    const account = await this.accountOrThrow(id);
    const member = await this.memberOrThrow(account.groupMemberId);
    await this.assertMemberAccess(member, actor);
    return this.prisma.savingsAccount.findUnique({ where: { id }, select: accountSelect });
  }

  async updateAccountStatus(id: string, status: SavingsAccountStatus, actor: Actor) {
    if (!['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'GROUP_MANAGER'].includes(actor.role)) throw new ForbiddenException('Only savings administrators can change account status');
    const account = await this.accountOrThrow(id);
    const member = await this.memberOrThrow(account.groupMemberId);
    await this.assertMemberAccess(member, actor);
    return this.prisma.savingsAccount.update({ where: { id }, data: { status, closedAt: status === SavingsAccountStatus.CLOSED ? new Date() : null }, select: accountSelect });
  }

  async contribute(dto: RecordContributionDto, actor: Actor) {
    if (actor.role === 'MEMBER') throw new ForbiddenException('Use Pay contribution, complete online checkout, and submit your receipt for confirmation.');
    if (new Prisma.Decimal(dto.amount).lte(0)) throw new ConflictException('Contribution amount must be positive');
    const contributionDate = dto.contributionDate ? new Date(dto.contributionDate) : new Date();
    if (Number.isNaN(contributionDate.valueOf())) throw new ConflictException('Invalid contribution date');
    const account = await this.accountOrThrow(dto.savingsAccountId);
    const currency = (await this.prisma.savingsAccount.findUniqueOrThrow({ where: { id: account.id }, select: { currency: true } })).currency;
    const member = await this.memberOrThrow(account.groupMemberId);
    await this.assertMemberAccess(member, actor);
    if (account.status !== SavingsAccountStatus.ACTIVE || member.status !== 'ACTIVE') throw new ConflictException('An active member and savings account are required');
    try {
      // The contribution, immutable financial record, and balance increment either
      // all commit together or all roll back. The unique reference is the idempotency key.
      const contribution = await this.prisma.$transaction(async (tx) => {
        const activeAccount = await tx.savingsAccount.findFirst({ where: { id: account.id, status: SavingsAccountStatus.ACTIVE, groupMember: { status: 'ACTIVE' } }, select: { id: true } });
        if (!activeAccount) throw new ConflictException('An active member and savings account are required');
        const contribution = await tx.contribution.create({ data: {
          savingsAccountId: account.id, groupMemberId: member.id, amount: new Prisma.Decimal(dto.amount), reference: dto.reference.trim(),
          contributionDate, paymentMethod: dto.paymentMethod, description: dto.description?.trim(), status: ContributionStatus.CONFIRMED,
          currency,
        }, select: contributionSelect });
        await tx.transaction.create({ data: {
          groupId: member.groupId, groupMemberId: member.id, contributionId: contribution.id, type: 'CONTRIBUTION', amount: new Prisma.Decimal(dto.amount),
          currency,
          reference: `CONTR-${dto.reference.trim()}`, status: 'COMPLETED', occurredAt: contributionDate,
          metadata: { paymentMethod: dto.paymentMethod, description: dto.description?.trim() ?? null },
        } });
        await tx.savingsAccount.update({ where: { id: account.id }, data: { balance: { increment: new Prisma.Decimal(dto.amount) } } });
        await tx.auditLog.create({ data: { userId: actor.sub, action: 'CONTRIBUTION_RECORDED', entityType: 'Contribution', entityId: contribution.id, newValues: { amount: dto.amount, currency, reference: dto.reference.trim(), paymentMethod: dto.paymentMethod } } });
        return contribution;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.notifications.create(member.userId, 'Contribution recorded', `Your contribution of SLE ${dto.amount} was recorded successfully.`, 'CONTRIBUTION');
      return contribution;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('A contribution with this reference already exists');
      throw error;
    }
  }

  private scope(actor: Actor): Prisma.GroupMemberWhereInput {
    if (this.hasFullAccess(actor)) return {};
    return actor.role === 'GROUP_MANAGER' ? { group: { managerId: actor.sub } } : { userId: actor.sub };
  }

  async contributions(query: ListContributionsDto, actor: Actor) {
    const search = query.search?.trim();
    const where: Prisma.ContributionWhereInput = {
      groupMember: { is: { ...this.scope(actor), ...(query.groupMemberId ? { id: query.groupMemberId } : {}), ...(query.groupId ? { groupId: query.groupId } : {}) } },
      ...(query.savingsAccountId ? { savingsAccountId: query.savingsAccountId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { contributionDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { savingsAccount: { accountNumber: { contains: search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contribution.findMany({ where, select: contributionSelect, orderBy: { contributionDate: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.contribution.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async statement(id: string, query: StatementDto, actor: Actor) {
    const account = await this.accountOrThrow(id);
    const member = await this.memberOrThrow(account.groupMemberId);
    await this.assertMemberAccess(member, actor);
    const dateWhere: Prisma.ContributionWhereInput = { savingsAccountId: id, status: ContributionStatus.CONFIRMED, ...(query.from || query.to ? { contributionDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } } : {}) };
    const [details, entries, totals] = await Promise.all([
      this.prisma.savingsAccount.findUnique({ where: { id }, select: accountSelect }),
      this.prisma.contribution.findMany({ where: dateWhere, select: contributionSelect, orderBy: { contributionDate: 'desc' } }),
      this.prisma.contribution.aggregate({ where: dateWhere, _sum: { amount: true }, _count: true }),
    ]);
    return { account: details, period: { from: query.from ?? null, to: query.to ?? null }, contributionCount: totals._count, totalContributions: totals._sum.amount ?? 0, entries };
  }

  async dashboard(actor: Actor) {
    const members = await this.prisma.groupMember.findMany({ where: this.scope(actor), select: { id: true } });
    const memberIds = members.map((member) => member.id);
    const [accounts, contributions] = await Promise.all([
      this.prisma.savingsAccount.findMany({ where: { groupMemberId: { in: memberIds } }, select: accountSelect, orderBy: { openedAt: 'desc' } }),
      this.prisma.contribution.aggregate({ where: { groupMemberId: { in: memberIds }, status: ContributionStatus.CONFIRMED }, _sum: { amount: true }, _count: true }),
    ]);
    return { accounts, totalBalance: accounts.reduce((sum, account) => sum.plus(account.balance), new Prisma.Decimal(0)), contributionCount: contributions._count, totalContributions: contributions._sum.amount ?? 0 };
  }
}
