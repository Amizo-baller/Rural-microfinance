import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateMeetingDto, ListMeetingsDto, RecordAttendanceDto, UpdateMeetingStatusDto } from './dto';
import { MeetingsService } from './meetings.service';

type RequestWithUser = { user: { sub: string; role: string } };

@Controller('meetings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}
  @Post() @Permissions('meetings:manage') create(@Body() dto: CreateMeetingDto, @Req() req: RequestWithUser) { return this.meetings.create(dto, req.user); }
  @Get() @Permissions('meetings:read') list(@Query() query: ListMeetingsDto, @Req() req: RequestWithUser) { return this.meetings.list(query, req.user); }
  @Get(':id') @Permissions('meetings:read') get(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) { return this.meetings.get(id, req.user); }
  @Patch(':id/status') @Permissions('meetings:manage') updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeetingStatusDto, @Req() req: RequestWithUser) { return this.meetings.updateStatus(id, dto.status, req.user); }
  @Post(':id/attendance') @Permissions('meetings:read') recordAttendance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordAttendanceDto, @Req() req: RequestWithUser) { return this.meetings.recordAttendance(id, dto, req.user); }
  @Get(':id/attendance') @Permissions('meetings:read') attendance(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) { return this.meetings.attendance(id, req.user); }
}
