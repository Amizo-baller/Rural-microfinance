import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MonimePayoutService } from './monime-payout.service';
import {
  AdminPageDto,
  CreateCycleDto,
  CreateWithdrawalDto,
  CycleStatusDto,
  ReviewWithdrawalDto,
  FinanceReviewWithdrawalDto,
} from './admin-operations.dto';

type Actor = { sub: string; role: string };

@Injectable()
export class AdminOperationsService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly payouts?: MonimePayoutService) {}

  private admin(actor: Actor) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role))
      throw new ForbiddenException('Administrator access required');
  }

  // A concurrent financial update must fail cleanly, without a partial debit.
  private async serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2034' || code === 'P2028')
        throw new ConflictException(
          'The record changed during this action. Refresh and try again.',
        );
      if (code === 'P2002')
        throw new ConflictException(
          'This reference or active savings cycle already exists. Refresh before retrying.',
        );
      throw error;
    }
  }

  async audit(query: AdminPageDto, actor: Actor) {
    this.admin(actor);
    const where: Prisma.AuditLogWhereInput = query.search
      ? {
          OR: [
            { action: { contains: query.search, mode: 'insensitive' } },
            { entityType: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async blockchain(query: AdminPageDto, actor: Actor) {
    this.admin(actor);
    const where: Prisma.BlockchainTransactionWhereInput = query.search
      ? { transactionHash: { contains: query.search, mode: 'insensitive' } }
      : {};
    const [rows, total, delivery] = await this.prisma.$transaction([
      this.prisma.blockchainTransaction.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.blockchainTransaction.count({ where }),
      this.prisma.proofDelivery.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return {
      items: rows.map((row) => ({ ...row, blockNumber: row.blockNumber?.toString() ?? null })),
      total,
      page: query.page,
      limit: query.limit,
      delivery,
    };
  }

  async withdrawals(query: AdminPageDto, actor: Actor) {
    const where: Prisma.WithdrawalRequestWhereInput = [
      'TREASURER',
      'ADMIN',
      'SUPER_ADMIN',
    ].includes(actor.role)
      ? {}
      : { savingsAccount: { groupMember: { userId: actor.sub } } };
    const [items, total, pendingCount] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          savingsAccount: {
            select: {
              accountNumber: true,
              currency: true,
              groupMember: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      }),
      this.prisma.withdrawalRequest.count({ where }),
      ['TREASURER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role)
        ? this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } })
        : this.prisma.withdrawalRequest.count({ where: { status: 'PENDING', savingsAccount: { groupMember: { userId: actor.sub } } } }),
    ]);
    const reviews = items.length
      ? await this.prisma.auditLog.findMany({
          where: {
            action: 'WITHDRAWAL_FINANCE_REVIEWED',
            entityType: 'WithdrawalRequest',
            entityId: { in: items.map((item) => item.id) },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            entityId: true,
            newValues: true,
            createdAt: true,
            user: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    return {
      items: items.map((item) => ({
        ...item,
        financeReview: reviews.find((review) => review.entityId === item.id) ?? null,
      })),
      total,
      pendingCount,
      page: query.page,
      limit: query.limit,
    };
  }

  async accounts(query: AdminPageDto, actor: Actor) {
    this.admin(actor);
    const where: Prisma.SavingsAccountWhereInput = query.search
      ? {
          OR: [
            { accountNumber: { contains: query.search, mode: 'insensitive' } },
            {
              groupMember: { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
            },
            {
              groupMember: { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
            },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.savingsAccount.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          accountNumber: true,
          balance: true,
          currency: true,
          status: true,
          groupMember: {
            select: {
              user: { select: { firstName: true, lastName: true } },
              group: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.savingsAccount.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async requestWithdrawal(dto: CreateWithdrawalDto, actor: Actor) {
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0) || dto.reason.trim().length < 5)
      throw new BadRequestException('Enter a positive amount and a withdrawal reason');
    if (this.payouts) {
      const providers = await this.payouts.providers();
      if (!providers.some((provider) => provider.providerId === dto.providerId))
        throw new BadRequestException('Choose an active Monime mobile money provider that supports payouts in Sierra Leone.');
    }
    return this.serial(async (tx) => {
      const account = await tx.savingsAccount.findUnique({
        where: { id: dto.savingsAccountId },
        include: { groupMember: { include: { user: true, group: true } } },
      });
      if (!account) throw new NotFoundException('Savings account not found');
      if (account.groupMember.userId !== actor.sub) this.admin(actor);
      if (account.currency !== 'SLE') throw new ConflictException('Monime mobile money withdrawals are currently supported in SLE only.');
      const existing = await tx.withdrawalRequest.findUnique({
        where: { reference: dto.reference },
      });
      if (existing) {
        const destination = existing.payoutDestination as { providerId?: string; accountNumber?: string } | null;
        if (
          existing.requesterId !== actor.sub ||
          existing.savingsAccountId !== account.id ||
          !existing.amount.equals(amount) ||
          existing.reason !== dto.reason.trim() ||
          destination?.providerId !== dto.providerId ||
          destination?.accountNumber !== dto.payoutPhone
        )
          throw new ConflictException('Reference already used for a different request');
        return existing;
      }
      if (
        account.groupMember.group.withdrawalsAllowed === false ||
        account.status !== 'ACTIVE' ||
        account.groupMember.status !== 'ACTIVE' ||
        account.groupMember.user.status !== 'ACTIVE' ||
        account.groupMember.group.status !== 'ACTIVE'
      )
        throw new ConflictException('Withdrawals must be permitted by the group and require an active account and member');
      // Outstanding Monime charges reduce the member's available savings too.
      // Keep this predicate in the conditional debit so concurrent requests
      // cannot spend funds already owed for payout fees.
      const reservationThreshold = amount.plus(account.withdrawalFeeDue ?? new Prisma.Decimal(0));
      const reserved = await tx.savingsAccount.updateMany({ where: { id: account.id, status: 'ACTIVE', balance: { gte: reservationThreshold } }, data: { balance: { decrement: amount } } });
      if (reserved.count !== 1) throw new ConflictException('Insufficient available savings');
      const row = await tx.withdrawalRequest.create({
        data: {
          ...dto,
          payoutDestination: { type: 'momo', providerId: dto.providerId, accountNumber: dto.payoutPhone },
          payoutFeePaid: true,
          reason: dto.reason.trim(), amount, requesterId: actor.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'WITHDRAWAL_REQUESTED',
          entityType: 'WithdrawalRequest',
          entityId: row.id,
          newValues: { amount: dto.amount, reference: dto.reference },
        },
      });
      return row;
    });
  }

  async financeReviewWithdrawal(id: string, dto: FinanceReviewWithdrawalDto, actor: Actor) {
    if (!['TREASURER', 'ADMIN', 'SUPER_ADMIN'].includes(actor.role))
      throw new ForbiddenException('Financial reviewer access required');
    if (dto.notes.trim().length < 5)
      throw new BadRequestException('Enter review notes of at least five characters');
    return this.serial(async (tx) => {
      const row = await tx.withdrawalRequest.findUnique({
        where: { id },
        include: {
          savingsAccount: {
            select: {
              balance: true,
              currency: true,
              status: true,
              groupMember: { select: { userId: true } },
            },
          },
        },
      });
      if (!row) throw new NotFoundException('Withdrawal request not found');
      if (row.status !== 'PENDING')
        throw new ConflictException('Only pending withdrawals can receive a financial review');
      if (row.requesterId === actor.sub || row.savingsAccount.groupMember.userId === actor.sub)
        throw new ForbiddenException('You cannot review your own withdrawal');
      if (
        dto.decision === 'RECOMMEND_APPROVAL' &&
        (row.savingsAccount.status !== 'ACTIVE' || row.amount.gt(row.savingsAccount.balance))
      )
        throw new ConflictException(
          'An active account with sufficient savings is required to recommend approval',
        );
      return tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'WITHDRAWAL_FINANCE_REVIEWED',
          entityType: 'WithdrawalRequest',
          entityId: id,
          newValues: {
            decision: dto.decision,
            notes: dto.notes.trim(),
            amount: row.amount.toFixed(2),
            currency: row.savingsAccount.currency,
          },
        },
      });
    });
  }

  async reviewWithdrawal(id: string, dto: ReviewWithdrawalDto, actor: Actor) {
    this.admin(actor);
    if (dto.decision === 'REJECTED' && (dto.notes?.trim().length ?? 0) < 5)
      throw new BadRequestException('Enter a rejection reason of at least five characters');
    const result = await this.serial(async (tx) => {
      const row = await tx.withdrawalRequest.findUnique({
        where: { id },
        include: {
          savingsAccount: { include: { groupMember: { include: { user: true, group: true } } } },
        },
      });
      if (!row) throw new NotFoundException('Withdrawal request not found');
      if (row.status !== 'PENDING')
        throw new ConflictException('This withdrawal has already been reviewed');
      const account = row.savingsAccount;
      if (row.requesterId === actor.sub || account.groupMember.userId === actor.sub)
        throw new ForbiddenException('Another administrator must review your withdrawal');
      if (dto.decision === 'APPROVED') {
        if (
          account.groupMember.group.withdrawalsAllowed === false ||
          account.groupMember.status !== 'ACTIVE' ||
          account.groupMember.user.status !== 'ACTIVE' ||
          account.groupMember.group.status !== 'ACTIVE'
        )
          throw new ConflictException('The member and group must be active');
        if (account.status !== 'ACTIVE')
          throw new ConflictException('Account is frozen, closed or has insufficient savings');
      }
      if (dto.decision === 'REJECTED') await tx.savingsAccount.update({ where: { id: account.id }, data: { balance: { increment: row.amount } } });
      const result = await tx.withdrawalRequest.update({
        where: { id },
        data: {
          status: dto.decision === 'APPROVED' ? 'PROCESSING' : 'REJECTED',
          reviewerId: actor.sub,
          reviewedAt: new Date(),
          reviewNotes: dto.decision === 'REJECTED' ? dto.notes!.trim() : null,
          ...(dto.decision === 'APPROVED' ? { payoutIdempotencyKey: `wd-${id.replaceAll('-', '')}`, payoutNextAttemptAt: new Date() } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: `WITHDRAWAL_${dto.decision === 'APPROVED' ? 'PROCESSING' : 'REJECTED'}`,
          entityType: 'WithdrawalRequest',
          entityId: id,
          oldValues: { status: row.status },
          newValues: { status: dto.decision === 'APPROVED' ? 'PROCESSING' : 'REJECTED', notes: dto.notes?.trim() ?? null },
        },
      });
      await tx.notification.create({
        data: {
          userId: account.groupMember.userId,
          type: 'GENERAL',
          title: dto.decision === 'APPROVED' ? 'Withdrawal processing' : 'Withdrawal rejected',
          message: dto.decision === 'APPROVED' ? `${account.currency} ${row.amount.toFixed(2)} payout is processing.` : `${account.currency} ${row.amount.toFixed(2)}: ${dto.notes!.trim()}`,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      return result;
    });
    if (dto.decision === 'APPROVED') await this.payouts?.process(id);
    return result;
  }

  async cycles(query: AdminPageDto, actor: Actor) {
    this.admin(actor);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.savingsCycle.findMany({
        orderBy: { startDate: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { group: { select: { name: true } } },
      }),
      this.prisma.savingsCycle.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async createCycle(dto: CreateCycleDto, actor: Actor) {
    this.admin(actor);
    if (
      new Date(dto.endDate) <= new Date(dto.startDate) ||
      new Prisma.Decimal(dto.targetAmount).lte(0) ||
      dto.name.trim().length < 2
    )
      throw new BadRequestException(
        'Enter a name, positive target and an end date after the start date',
      );
    return this.serial(async (tx) => {
      const group = await tx.communityGroup.findUnique({ where: { id: dto.groupId } });
      if (!group || group.status !== 'ACTIVE')
        throw new ConflictException('Choose an active group');
      const row = await tx.savingsCycle.create({
        data: {
          ...dto,
          name: dto.name.trim(),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'SAVINGS_CYCLE_CREATED',
          entityType: 'SavingsCycle',
          entityId: row.id,
          newValues: { ...dto },
        },
      });
      return row;
    });
  }

  async updateCycle(id: string, dto: CreateCycleDto, actor: Actor) {
    this.admin(actor);
    if (
      new Date(dto.endDate) <= new Date(dto.startDate) ||
      new Prisma.Decimal(dto.targetAmount).lte(0) ||
      dto.name.trim().length < 2
    )
      throw new BadRequestException(
        'Enter a name, positive target and an end date after the start date',
      );
    return this.serial(async (tx) => {
      const previous = await tx.savingsCycle.findUnique({ where: { id } });
      if (!previous) throw new NotFoundException('Savings cycle not found');
      if (previous.status !== 'PLANNED')
        throw new ConflictException('Only planned savings cycles can be edited');
      const group = await tx.communityGroup.findUnique({ where: { id: dto.groupId } });
      if (group?.status !== 'ACTIVE') throw new ConflictException('Choose an active group');
      const row = await tx.savingsCycle.update({
        where: { id },
        data: {
          ...dto,
          name: dto.name.trim(),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'SAVINGS_CYCLE_UPDATED',
          entityType: 'SavingsCycle',
          entityId: id,
          newValues: { ...dto },
        },
      });
      return row;
    });
  }

  async cycleStatus(id: string, dto: CycleStatusDto, actor: Actor) {
    this.admin(actor);
    return this.serial(async (tx) => {
      const row = await tx.savingsCycle.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Savings cycle not found');
      const allowed =
        row.status === 'PLANNED'
          ? ['ACTIVE', 'CANCELLED']
          : row.status === 'ACTIVE'
            ? ['COMPLETED', 'CANCELLED']
            : [];
      if (!allowed.includes(dto.status))
        throw new ConflictException('Invalid savings cycle transition');
      if (dto.status === 'ACTIVE') {
        const group = await tx.communityGroup.findUnique({ where: { id: row.groupId } });
        if (group?.status !== 'ACTIVE') throw new ConflictException('The group must be active');
        const overlap = await tx.savingsCycle.count({
          where: { groupId: row.groupId, status: 'ACTIVE', id: { not: id } },
        });
        if (overlap) throw new ConflictException('This group already has an active savings cycle');
      }
      const result = await tx.savingsCycle.update({ where: { id }, data: dto });
      await tx.auditLog.create({
        data: {
          userId: actor.sub,
          action: 'SAVINGS_CYCLE_STATUS_CHANGED',
          entityType: 'SavingsCycle',
          entityId: id,
          oldValues: { status: row.status },
          newValues: { status: dto.status },
        },
      });
      return result;
    });
  }
}
