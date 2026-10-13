import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateGroupDto, ListGroupsDto, UpdateGroupDto, UpdateGroupStatusDto } from './dto';
import { GroupsService } from './groups.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}
  @Post() @Permissions('groups:manage') create(@Body() dto: CreateGroupDto, @Req() request: AuthenticatedRequest) { return this.groups.create(dto, request.user); }
  @Get() @Permissions('groups:read') list(@Query() query: ListGroupsDto) { return this.groups.list(query); }
  @Get(':id') @Permissions('groups:read') get(@Param('id', ParseUUIDPipe) id: string) { return this.groups.get(id); }
  @Patch(':id') @Permissions('groups:manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @Req() request: AuthenticatedRequest) { return this.groups.update(id, dto, request.user); }
  @Patch(':id/status') @Permissions('groups:manage') updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupStatusDto, @Req() request: AuthenticatedRequest) { return this.groups.updateStatus(id, dto.status, request.user); }
}
