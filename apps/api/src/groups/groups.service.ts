import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommunityGroupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateGroupDto, ListGroupsDto, UpdateGroupDto } from './dto';

type Actor = { sub: string; role: string };

const groupSelect = {
  id: true, name: true, registrationNo: true, description: true, location: true, contactInfo: true,
  status: true, createdAt: true, updatedAt: true,
  manager: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
} satisfies Prisma.CommunityGroupSelect;

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private isPlatformAdmin(actor: Actor) { return actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN'; }

  private async managerOrThrow(managerId: string) {
    const manager = await this.prisma.user.findUnique({ where: { id: managerId }, include: { role: true } });
    if (!manager || manager.status !== 'ACTIVE') throw new NotFoundException('An active group administrator is required');
    if (!['GROUP_MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(manager.role.name)) throw new ForbiddenException('The selected user cannot administer a group');
    return manager;
  }

  private async groupOrThrow(id: string) {
    const group = await this.prisma.communityGroup.findUnique({ where: { id }, select: { id: true, managerId: true } });
    if (!group) throw new NotFoundException('Community group not found');
    return group;
  }

  private async assertCanManage(id: string, actor: Actor) {
    const group = await this.groupOrThrow(id);
    if (this.isPlatformAdmin(actor)) return;
    if (group.managerId !== actor.sub) throw new ForbiddenException('You can manage only your assigned group');
  }

  async create(dto: CreateGroupDto, actor: Actor) {
    if (!this.isPlatformAdmin(actor) && actor.sub !== dto.managerId) throw new ForbiddenException('Group managers can create only groups assigned to themselves');
    await this.managerOrThrow(dto.managerId);
    try {
      return await this.prisma.communityGroup.create({
        data: { name: dto.name.trim(), registrationNo: dto.registrationNo.trim(), location: dto.location.trim(), contactInfo: dto.contactInfo.trim(), description: dto.description?.trim(), managerId: dto.managerId },
        select: groupSelect,
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('A group with this name or registration number already exists');
      throw error;
    }
  }

  async list(query: ListGroupsDto) {
    const search = query.search?.trim();
    const where: Prisma.CommunityGroupWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.location ? { location: { contains: query.location.trim(), mode: 'insensitive' } } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { registrationNo: { contains: search, mode: 'insensitive' } }, { location: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.communityGroup.findMany({ where, select: groupSelect, orderBy: { name: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.communityGroup.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const group = await this.prisma.communityGroup.findUnique({ where: { id }, select: groupSelect });
    if (!group) throw new NotFoundException('Community group not found');
    const [activeMembers, totalMembers, savings, activeLoans, outstandingLoans, pendingApplications, meetings] = await Promise.all([
      this.prisma.groupMember.count({ where: { groupId: id, status: 'ACTIVE' } }),
      this.prisma.groupMember.count({ where: { groupId: id } }),
      this.prisma.savingsAccount.aggregate({ where: { groupMember: { groupId: id }, status: 'ACTIVE' }, _sum: { balance: true } }),
      this.prisma.loan.count({ where: { groupId: id, status: 'ACTIVE' } }),
      this.prisma.loan.aggregate({ where: { groupId: id, status: 'ACTIVE' }, _sum: { outstandingBalance: true } }),
      this.prisma.loanApplication.count({ where: { groupId: id, status: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
      this.prisma.meeting.count({ where: { groupId: id, status: 'SCHEDULED' } }),
    ]);
    return { ...group, statistics: { totalMembers, activeMembers, totalSavings: savings._sum.balance ?? 0, activeLoans, outstandingLoanBalance: outstandingLoans._sum.outstandingBalance ?? 0, pendingLoanApplications: pendingApplications, scheduledMeetings: meetings } };
  }

  async update(id: string, dto: UpdateGroupDto, actor: Actor) {
    await this.assertCanManage(id, actor);
    if (dto.managerId) {
      if (!this.isPlatformAdmin(actor)) throw new ForbiddenException('Only a platform administrator can change the group administrator');
      await this.managerOrThrow(dto.managerId);
    }
    try {
      return await this.prisma.communityGroup.update({ where: { id }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.registrationNo !== undefined ? { registrationNo: dto.registrationNo.trim() } : {}),
        ...(dto.location !== undefined ? { location: dto.location.trim() } : {}), ...(dto.contactInfo !== undefined ? { contactInfo: dto.contactInfo.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}), ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
      }, select: groupSelect });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('A group with this name or registration number already exists');
      throw error;
    }
  }

  async updateStatus(id: string, status: CommunityGroupStatus, actor: Actor) {
    await this.assertCanManage(id, actor);
    return this.prisma.communityGroup.update({ where: { id }, data: { status }, select: groupSelect });
  }
}
