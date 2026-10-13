import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CorrectFinancialRecordDto, ListFinancialRecordsDto } from './dto';

type Actor = { sub: string; role: string };

@Injectable()
export class FinancialRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  private hasFullAccess(actor: Actor) { return ['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'AUDITOR'].includes(actor.role); }

  private whereScope(actor: Actor): Prisma.TransactionWhereInput {
    return this.hasFullAccess(actor) ? {} : { groupMember: { userId: actor.sub } };
  }

  async list(query: ListFinancialRecordsDto, actor: Actor) {
    const search = query.search?.trim();
    const where: Prisma.TransactionWhereInput = {
      ...this.whereScope(actor), ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}) } } : {}),
      ...(search ? { OR: [{ reference: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const select = {
      id: true, groupId: true, groupMemberId: true, type: true, amount: true, currency: true, reference: true,
      status: true, occurredAt: true, description: true, blockchainStatus: true, blockchainHash: true, metadata: true,
      group: { select: { id: true, name: true } },
      groupMember: { select: { memberNumber: true, user: { select: { firstName: true, lastName: true } } } },
      blockchainTransaction: { select: { transactionHash: true, status: true, network: true } },
    } satisfies Prisma.TransactionSelect;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({ where, select, orderBy: { occurredAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.transaction.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor) {
    const transaction = await this.prisma.transaction.findFirst({ where: { id, ...this.whereScope(actor) }, include: { group: true, groupMember: { include: { user: true } }, blockchainTransaction: true } });
    if (!transaction) throw new NotFoundException('Financial transaction not found');
    return transaction;
  }

  async correct(id: string, dto: CorrectFinancialRecordDto, actor: Actor) {
    if (!this.hasFullAccess(actor)) throw new ForbiddenException('Only authorized financial administrators can correct transactions');
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) throw new ConflictException('Correction amount must be positive');
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.transaction.findUnique({ where: { id }, select: { id: true, groupId: true, groupMemberId: true, status: true, type: true, reference: true } });
      if (!original) throw new NotFoundException('Financial transaction not found');
      if (original.status !== TransactionStatus.COMPLETED) throw new ConflictException('Only completed transactions can receive audited corrections');
      const correction = await tx.transaction.create({ data: { groupId: original.groupId, groupMemberId: original.groupMemberId, type: TransactionType.ADJUSTMENT, amount, reference: dto.reference.trim(), status: TransactionStatus.COMPLETED, occurredAt: new Date(), description: dto.reason.trim(), metadata: { correctionOf: original.id, originalReference: original.reference, originalType: original.type } } });
      await tx.auditLog.create({ data: { userId: actor.sub, action: 'FINANCIAL_TRANSACTION_CORRECTED', entityType: 'Transaction', entityId: original.id, oldValues: { status: original.status, reference: original.reference }, newValues: { correctionId: correction.id, correctionReference: correction.reference, reason: dto.reason.trim(), amount: dto.amount } } });
      return { originalId: original.id, correction };
    });
  }
}