import { Body, Controller, Get, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';
import { AssignAdministratorRoleDto, UpdateSystemSettingDto } from './dto';

@Controller('system')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPER_ADMIN')
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('administrators')
  @Permissions('administrators:manage')
  administrators() {
    return this.prisma.user.findMany({ where: { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, role: { select: { name: true } } } });
  }

  @Patch('users/:id/role')
  @Permissions('administrators:manage')
  async assignAdministratorRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignAdministratorRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { name: dto.role } });
    if (!role) throw new NotFoundException('Administrator role not found');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({ where: { id }, data: { roleId: role.id }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, role: { select: { name: true } } } });
  }

  @Get('settings')
  @Permissions('settings:manage')
  settings() { return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }); }

  @Patch('settings/:key')
  @Permissions('settings:manage')
  updateSetting(@Param('key') key: string, @Body() dto: UpdateSystemSettingDto) {
    const value = dto.value as Prisma.InputJsonValue;
    return this.prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
