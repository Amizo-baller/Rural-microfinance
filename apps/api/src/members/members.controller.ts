import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateMemberDto, ListMembersDto, UpdateMemberDto, UpdateMemberStatusDto } from './dto';
import { MembersService } from './members.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('members')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Post() @Permissions('members:manage') create(@Body() dto: CreateMemberDto, @Req() request: AuthenticatedRequest) { return this.members.create(dto, request.user); }
  @Get() @Permissions('members:read') list(@Query() query: ListMembersDto, @Req() request: AuthenticatedRequest) { return this.members.list(query, request.user); }
  @Get(':id') @Permissions('members:read') get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.members.get(id, request.user); }
  @Patch(':id') @Permissions('members:manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto, @Req() request: AuthenticatedRequest) { return this.members.update(id, dto, request.user); }
  @Patch(':id/status') @Permissions('members:manage') updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberStatusDto, @Req() request: AuthenticatedRequest) { return this.members.updateStatus(id, dto.status, request.user); }
}
