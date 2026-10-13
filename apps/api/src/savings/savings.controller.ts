import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateSavingsAccountDto, ListContributionsDto, RecordContributionDto, StatementDto, UpdateSavingsAccountStatusDto } from './dto';
import { SavingsService } from './savings.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('savings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SavingsController {
  constructor(private readonly savings: SavingsService) {}

  @Get('dashboard') @Permissions('financial:read') dashboard(@Req() request: AuthenticatedRequest) { return this.savings.dashboard(request.user); }
  @Post('accounts') @Permissions('financial:write') createAccount(@Body() dto: CreateSavingsAccountDto, @Req() request: AuthenticatedRequest) { return this.savings.createAccount(dto, request.user); }
  @Get('accounts/:id') @Permissions('financial:read') account(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.savings.account(id, request.user); }
  @Patch('accounts/:id/status') @Permissions('financial:write') accountStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavingsAccountStatusDto, @Req() request: AuthenticatedRequest) { return this.savings.updateAccountStatus(id, dto.status, request.user); }
  @Post('contributions') @Permissions('financial:write') contribute(@Body() dto: RecordContributionDto, @Req() request: AuthenticatedRequest) { return this.savings.contribute(dto, request.user); }
  @Get('contributions') @Permissions('financial:read') contributions(@Query() query: ListContributionsDto, @Req() request: AuthenticatedRequest) { return this.savings.contributions(query, request.user); }
  @Get('accounts/:id/statement') @Permissions('financial:read') statement(@Param('id', ParseUUIDPipe) id: string, @Query() query: StatementDto, @Req() request: AuthenticatedRequest) { return this.savings.statement(id, query, request.user); }
}
