import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';
import { AssignAdministratorRoleDto, SettingKeyDto, UpdateSystemSettingDto } from './dto';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('administrators')
  @Roles('SUPER_ADMIN')
  @Permissions('administrators:manage')
  administrators() {
    return this.prisma.user.findMany({ where: { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, role: { select: { name: true } } } });
  }

  @Patch('users/:id/role')
  @Permissions('users:manage')
  async assignAdministratorRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignAdministratorRoleDto, @Req() req: { user: { sub: string; role: string } }) {
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw new NotFoundException('Administrator role not found');
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === req.user.sub || user.role.name === 'SUPER_ADMIN') throw new ForbiddenException('You cannot change your own role or a super administrator role');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { roleId: role.id }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, role: { select: { name: true } } } });
      await tx.authToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: req.user.sub, action: 'USER_ROLE_CHANGED', entityType: 'User', entityId: id, oldValues: { role: user.role.name }, newValues: { role: dto.role } } });
      return updated;
    });
  }

  @Get('settings')
  @Permissions('settings:manage')
  settings() { return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }); }

  @Patch('settings/:key')
  @Permissions('settings:manage')
  updateSetting(@Param() params: SettingKeyDto, @Body() dto: UpdateSystemSettingDto, @Req() req: { user: { sub: string } }) {
    const key = params.key;
    const value = dto.value as Prisma.InputJsonValue;
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.systemSetting.findUnique({ where: { key } });
      const setting = await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await tx.auditLog.create({ data: { userId: req.user.sub, action: 'SYSTEM_SETTING_UPDATED', entityType: 'SystemSetting', entityId: setting.id, oldValues: old?.value ?? Prisma.JsonNull, newValues: { key, value } } });
      return setting;
    });
  }
}
