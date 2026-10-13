import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MemberStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateMemberDto, ListMembersDto, UpdateMemberDto } from './dto';

type Actor = { sub: string; role: string };

const memberSelect = {
  id: true, memberNumber: true, status: true, joinedAt: true, exitedAt: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
  group: { select: { id: true, name: true, registrationNo: true, location: true, status: true } },
} satisfies Prisma.GroupMemberSelect;

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(actor: Actor) { return actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN'; }

  private async memberOrThrow(id: string) {
    const member = await this.prisma.groupMember.findUnique({ where: { id }, select: { id: true, userId: true, groupId: true } });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  private async assertGroupManager(groupId: string, actor: Actor) {
    if (this.isAdmin(actor)) return;
    const group = await this.prisma.communityGroup.findUnique({ where: { id: groupId }, select: { managerId: true } });
    if (!group || group.managerId !== actor.sub) throw new ForbiddenException('You can manage members only in your assigned group');
  }

  private async assertCanRead(member: { userId: string; groupId: string }, actor: Actor) {
    if (this.isAdmin(actor) || member.userId === actor.sub) return;
    await this.assertGroupManager(member.groupId, actor);
  }

  async create(dto: CreateMemberDto, actor: Actor) {
    await this.assertGroupManager(dto.groupId, actor);
    const [user, group, existing] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: dto.userId }, include: { role: true } }),
      this.prisma.communityGroup.findUnique({ where: { id: dto.groupId } }),
      this.prisma.groupMember.findUnique({ where: { userId: dto.userId } }),
    ]);
    if (!user || user.status !== 'ACTIVE' || user.role.name !== 'MEMBER') throw new NotFoundException('An active user with the MEMBER role is required');
    if (!group || group.status !== 'ACTIVE') throw new NotFoundException('An active community group is required');
    if (existing) throw new ConflictException('This user already belongs to a community group');

    // The database-level unique userId constraint is the final protection against
    // concurrent requests assigning the same person to different groups.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const count = await tx.groupMember.count({ where: { groupId: dto.groupId } });
          return tx.groupMember.create({ data: { userId: dto.userId, groupId: dto.groupId, memberNumber: `MBR-${String(count + 1).padStart(6, '0')}` }, select: memberSelect });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(typeof error === 'object' && error && 'code' in error && error.code === 'P2002')) throw error;
        const assigned = await this.prisma.groupMember.findUnique({ where: { userId: dto.userId } });
        if (assigned) throw new ConflictException('This user already belongs to a community group');
      }
    }
    throw new ConflictException('Could not generate a member number; please try again');
  }

  async list(query: ListMembersDto, actor: Actor) {
    const search = query.search?.trim();
    const scope: Prisma.GroupMemberWhereInput = this.isAdmin(actor) ? {} : actor.role === 'GROUP_MANAGER'
      ? { group: { managerId: actor.sub } } : { userId: actor.sub };
    const where: Prisma.GroupMemberWhereInput = {
      ...scope, ...(query.groupId ? { groupId: query.groupId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(search ? { OR: [{ memberNumber: { contains: search, mode: 'insensitive' } }, { user: { firstName: { contains: search, mode: 'insensitive' } } }, { user: { lastName: { contains: search, mode: 'insensitive' } } }, { user: { email: { contains: search, mode: 'insensitive' } } }, { user: { phone: { contains: search } } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.groupMember.findMany({ where, select: memberSelect, orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.groupMember.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor) {
    const member = await this.memberOrThrow(id);
    await this.assertCanRead(member, actor);
    const profile = await this.prisma.groupMember.findUnique({ where: { id }, select: memberSelect });
    if (!profile) throw new NotFoundException('Member not found');
    const [savings, loans] = await Promise.all([
      this.prisma.savingsAccount.aggregate({ where: { groupMemberId: id, status: 'ACTIVE' }, _sum: { balance: true } }),
      this.prisma.loan.aggregate({ where: { groupMemberId: id, status: 'ACTIVE' }, _sum: { outstandingBalance: true } }),
    ]);
    return { ...profile, savingsBalance: savings._sum.balance ?? 0, loanBalance: loans._sum.outstandingBalance ?? 0 };
  }

  async update(id: string, dto: UpdateMemberDto, actor: Actor) {
    const member = await this.memberOrThrow(id);
    await this.assertGroupManager(member.groupId, actor);
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    if (email || phone) {
      const duplicate = await this.prisma.user.findFirst({ where: { id: { not: member.userId }, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
      if (duplicate) throw new ConflictException('An account with this email or phone already exists');
    }
    return this.prisma.groupMember.update({ where: { id }, data: { user: { update: { ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}), ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}), ...(email !== undefined ? { email } : {}), ...(phone !== undefined ? { phone } : {}) } } }, select: memberSelect });
  }

  async updateStatus(id: string, status: MemberStatus, actor: Actor) {
    const member = await this.memberOrThrow(id);
    await this.assertGroupManager(member.groupId, actor);
    return this.prisma.groupMember.update({ where: { id }, data: { status, ...(status === 'EXITED' ? { exitedAt: new Date() } : { exitedAt: null }) }, select: memberSelect });
  }
}
