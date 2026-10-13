import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateAnnouncementDto, ListNotificationsDto } from './dto';
import { NotificationsService } from './notifications.service';

type RequestWithUser = { user: { sub: string; role: string } };

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() @Permissions('notifications:read') list(@Query() query: ListNotificationsDto, @Req() req: RequestWithUser) { return this.notifications.list(query, req.user); }
  @Patch(':id/read') @Permissions('notifications:read') read(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) { return this.notifications.markRead(id, req.user); }
  @Post('read-all') @Permissions('notifications:read') readAll(@Req() req: RequestWithUser) { return this.notifications.markAllRead(req.user); }
  @Post('announcements') @Permissions('groups:manage') announce(@Body() dto: CreateAnnouncementDto, @Req() req: RequestWithUser) { return this.notifications.announce(dto, req.user); }
}
