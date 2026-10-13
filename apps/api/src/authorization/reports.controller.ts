import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ReportsFilterDto } from './dto';
import { ReportsService } from './reports.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Permissions('financial:read')
  analytics(@Query() query: ReportsFilterDto, @Req() request: AuthenticatedRequest) {
    return this.reports.analytics(query, request.user);
  }

  @Get('analytics')
  @Permissions('financial:read')
  analyticsAlias(@Query() query: ReportsFilterDto, @Req() request: AuthenticatedRequest) {
    return this.reports.analytics(query, request.user);
  }
}
