import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, MeetingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateMeetingDto, ListMeetingsDto, RecordAttendanceDto } from './dto';

type Actor = { sub: string; role: string };
const adminRoles = ['ADMIN', 'SUPER_ADMIN'];

const meetingSelect = {
  id: true, groupId: true, organizerId: true, title: true, scheduledAt: true, location: true, agenda: true, description: true, status: true, minutes: true,
  group: { select: { id: true, name: true } }, organizer: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.MeetingSelect;

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}
  private isAdmin(actor: Actor) { return adminRoles.includes(actor.role); }

  private async memberInGroup(groupId: string, userId: string) {
    return this.prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { id: true, status: true } });
  }

  private async canManage(groupId: string, actor: Actor) {
    if (this.isAdmin(actor)) return true;
    const group = await this.prisma.communityGroup.findUnique({ where: { id: groupId }, select: { managerId: true } });
    return group?.managerId === actor.sub;
  }

  async create(dto: CreateMeetingDto, actor: Actor) {
    if (!(await this.canManage(dto.groupId, actor))) throw new ForbiddenException('Only the group manager or an administrator can create meetings');
    const group = await this.prisma.communityGroup.findUnique({ where: { id: dto.groupId }, select: { id: true, status: true } });
    if (!group || group.status !== 'ACTIVE') throw new ConflictException('An active group is required');
    const scheduledAt = new Date(dto.scheduledAt);
    if (Number.isNaN(scheduledAt.valueOf())) throw new ConflictException('Invalid meeting date and time');
    return this.prisma.meeting.create({ data: { groupId: dto.groupId, organizerId: actor.sub, title: dto.title.trim(), scheduledAt, location: dto.location?.trim(), agenda: dto.agenda?.trim(), description: dto.description?.trim() }, select: meetingSelect });
  }

  async list(query: ListMeetingsDto, actor: Actor) {
    const where: Prisma.MeetingWhereInput = { ...(query.groupId ? { groupId: query.groupId } : {}), ...(query.status ? { status: query.status } : {}), ...(this.isAdmin(actor) ? {} : { group: { members: { some: { userId: actor.sub, status: 'ACTIVE' } } } }) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({ where, select: meetingSelect, orderBy: { scheduledAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.meeting.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id }, select: meetingSelect });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const member = await this.memberInGroup(meeting.groupId, actor.sub);
    if (!this.isAdmin(actor) && !member) throw new ForbiddenException('You do not belong to this meeting group');
    return meeting;
  }

  async updateStatus(id: string, status: MeetingStatus, actor: Actor) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id }, select: { groupId: true } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (!(await this.canManage(meeting.groupId, actor))) throw new ForbiddenException('Only the group manager or an administrator can update meetings');
    return this.prisma.meeting.update({ where: { id }, data: { status }, select: meetingSelect });
  }

  async recordAttendance(meetingId: string, dto: RecordAttendanceDto, actor: Actor) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true, groupId: true } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const target = await this.memberInGroup(meeting.groupId, dto.memberUserId);
    if (!target || target.status !== 'ACTIVE') throw new ConflictException('Attendance member must be active in the meeting group');
    if (!this.isAdmin(actor) && actor.sub !== dto.memberUserId && !(await this.canManage(meeting.groupId, actor))) throw new ForbiddenException('You can record attendance only for yourself or your managed group');
    const checkedInAt = dto.checkedInAt ? new Date(dto.checkedInAt) : dto.status === AttendanceStatus.PRESENT ? new Date() : null;
    if (checkedInAt && Number.isNaN(checkedInAt.valueOf())) throw new ConflictException('Invalid attendance date and time');
    return this.prisma.attendance.upsert({ where: { meetingId_userId: { meetingId, userId: dto.memberUserId } }, create: { meetingId, userId: dto.memberUserId, status: dto.status, checkedInAt, notes: dto.notes?.trim() }, update: { status: dto.status, checkedInAt, notes: dto.notes?.trim() }, include: { user: { select: { id: true, firstName: true, lastName: true } }, meeting: { select: { id: true, title: true, scheduledAt: true } } } });
  }

  async attendance(meetingId: string, actor: Actor) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId }, select: { groupId: true } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (!this.isAdmin(actor) && !(await this.memberInGroup(meeting.groupId, actor.sub))) throw new ForbiddenException('You do not belong to this meeting group');
    return this.prisma.attendance.findMany({ where: { meetingId }, orderBy: { user: { lastName: 'asc' } }, include: { user: { select: { id: true, firstName: true, lastName: true } } } });
  }
}
