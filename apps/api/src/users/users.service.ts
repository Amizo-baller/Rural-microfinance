import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { hasPermission } from '../auth/authorization';
import { PrismaService } from '../prisma.service';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto';

const safeUser = {
  id: true, firstName: true, lastName: true, email: true, phone: true, profileImageUrl: true, blockchainAddress: true,
  status: true, lastLoginAt: true, createdAt: true, updatedAt: true, role: { select: { name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(value?: string) { return value?.trim().toLowerCase(); }
  private normalizePhone(value?: string) { return value?.trim(); }
  private async findUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto, actor?: { sub: string; role: string }) {
    const email = this.normalizeEmail(dto.email);
    const phone = this.normalizePhone(dto.phone);
    if (!email && !phone) throw new ConflictException('Email or phone is required');
    const [role, existing] = await Promise.all([
      this.prisma.role.findUnique({ where: { name: dto.role } }),
      this.prisma.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } }),
    ]);
    if (!role) throw new NotFoundException('Role not found');
    if (existing) throw new ConflictException('An account with this email or phone already exists');
    try {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), email, phone, passwordHash, roleId: role.id, status: UserStatus.ACTIVE }, select: safeUser });
        await tx.auditLog.create({ data: { userId: actor?.sub, action: 'USER_CREATED', entityType: 'User', entityId: user.id, newValues: { role: dto.role, status: user.status } } });
        return user;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new ConflictException('An account with this email or phone already exists');
      throw error;
    }
  }

  async list(query: ListUsersDto) {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(search ? { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: safeUser, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: { sub: string; role: string }) {
    if (actor.sub !== id && !hasPermission(actor.role, 'users:read')) throw new ForbiddenException('You cannot view this user');
    const user = await this.prisma.user.findUnique({ where: { id }, select: safeUser });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: { sub: string; role: string }) {
    if (actor.sub !== id && !hasPermission(actor.role, 'users:manage')) throw new ForbiddenException('You cannot edit this user');
    const target = await this.findUserOrThrow(id);
    if (target.role.name === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only a super administrator can edit this user');
    const email = dto.email === undefined ? undefined : this.normalizeEmail(dto.email);
    const phone = dto.phone === undefined ? undefined : this.normalizePhone(dto.phone);
    if (email || phone) {
      const duplicate = await this.prisma.user.findFirst({ where: { id: { not: id }, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
      if (duplicate) throw new ConflictException('An account with this email or phone already exists');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: { ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}), ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}), ...(email !== undefined ? { email } : {}), ...(phone !== undefined ? { phone } : {}), ...(dto.profileImageUrl !== undefined ? { profileImageUrl: dto.profileImageUrl } : {}) }, select: safeUser });
      await tx.auditLog.create({ data: { userId: actor.sub, action: 'USER_PROFILE_UPDATED', entityType: 'User', entityId: id, newValues: { fields: Object.keys(dto) } } });
      return user;
    });
  }

  async updateStatus(id: string, status: UserStatus, actor: { sub: string; role: string }) {
    if (!hasPermission(actor.role, 'users:manage')) throw new ForbiddenException('You cannot change user status');
    const target = await this.findUserOrThrow(id);
    if (target.role.name === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only a super administrator can change this status');
    if (actor.sub === id && status !== UserStatus.ACTIVE) throw new ForbiddenException('You cannot deactivate your own account');
    return this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status }, select: safeUser }),
      ...(status === UserStatus.ACTIVE ? [] : [this.prisma.authToken.updateMany({ where: { userId: id, type: 'REFRESH', revokedAt: null }, data: { revokedAt: new Date() } })]),
      this.prisma.auditLog.create({ data: { userId: actor.sub, action: 'USER_STATUS_CHANGED', entityType: 'User', entityId: id, oldValues: { status: target.status }, newValues: { status } } }),
    ]).then(([user]) => user);
  }

  async remove(id: string, actor: { sub: string; role: string }) {
    if (!hasPermission(actor.role, 'users:delete')) throw new ForbiddenException('You cannot delete users');
    if (actor.sub === id) throw new ForbiddenException('You cannot delete your own account');
    await this.findUserOrThrow(id);
    // Financial and audit relations require a retained user record, so deletion is a secure deactivation.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: UserStatus.INACTIVE } }),
      this.prisma.authToken.updateMany({ where: { userId: id, type: 'REFRESH', revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }
}
