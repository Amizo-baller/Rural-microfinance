import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AdminDashboardService } from './admin-dashboard.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('dashboard')
  @Permissions('users:read', 'financial:read')
  getDashboard(@Req() request: AuthenticatedRequest) {
    return this.dashboard.dashboard(request.user);
  }
}
