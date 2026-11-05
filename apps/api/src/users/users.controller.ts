import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateUserDto, ListUsersDto, UpdateUserDto, UpdateUserStatusDto } from './dto';
import { UsersService } from './users.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('users:manage')
  create(@Body() dto: CreateUserDto, @Req() request: AuthenticatedRequest) { return this.users.create(dto, request.user); }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions('users:read')
  list(@Query() query: ListUsersDto) { return this.users.list(query); }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.users.get(id, request.user); }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Req() request: AuthenticatedRequest) { return this.users.update(id, dto, request.user); }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @Permissions('users:manage')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto, @Req() request: AuthenticatedRequest) { return this.users.updateStatus(id, dto.status, request.user); }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(PermissionsGuard)
  @Permissions('users:delete')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { await this.users.remove(id, request.user); }
}
