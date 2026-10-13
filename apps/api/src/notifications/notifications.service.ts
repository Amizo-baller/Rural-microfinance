import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateAnnouncementDto, ListNotificationsDto } from './dto';

type Actor = { sub: string; role: string };

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title: string, message: string, type: NotificationType, dedupeKey?: string) {
    return this.prisma.notification.create({ data: { userId, title, message, type, status: 'SENT', sentAt: new Date(), ...(dedupeKey ? { dedupeKey } : {}) } });
  }

  async createMany(userIds: string[], title: string, message: string, type: NotificationType) {
    if (!userIds.length) return { count: 0 };
    return this.prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, title, message, type, status: 'SENT' as const, sentAt: new Date() })) });
  }

  async list(query: ListNotificationsDto, actor: Actor) {
    const where: Prisma.NotificationWhereInput = { userId: actor.sub, ...(query.type ? { type: query.type } : {}) };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: actor.sub, status: { not: 'READ' } } }),
    ]);
    return { items, total, unread, page: query.page, limit: query.limit };
  }

  async markRead(id: string, actor: Actor) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId: actor.sub } });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id }, data: { status: 'READ', readAt: new Date() } });
  }

  async markAllRead(actor: Actor) {
    return this.prisma.notification.updateMany({ where: { userId: actor.sub, status: { not: 'READ' } }, data: { status: 'READ', readAt: new Date() } });
  }

  async announce(dto: CreateAnnouncementDto, actor: Actor) {
    const group = await this.prisma.communityGroup.findUnique({ where: { id: dto.groupId }, select: { managerId: true, members: { where: { status: 'ACTIVE' }, select: { userId: true } } } });
    if (!group) throw new NotFoundException('Group not found');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role) && group.managerId !== actor.sub) throw new ForbiddenException('Only the group manager or an administrator can announce');
    return this.createMany(group.members.map((member) => member.userId), dto.title.trim(), dto.message.trim(), NotificationType.GENERAL);
  }
}
