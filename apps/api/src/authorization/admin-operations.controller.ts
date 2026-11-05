import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import {
  AdminPageDto,
  CreateCycleDto,
  CreateWithdrawalDto,
  CycleStatusDto,
  ReviewWithdrawalDto,
  FinanceReviewWithdrawalDto,
} from './admin-operations.dto';
import { AdminOperationsService } from './admin-operations.service';

type RequestWithUser = { user: { sub: string; role: string } };

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminOperationsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get('audit-logs')
  @Permissions('audit:read')
  audit(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.audit(query, req.user);
  }

  @Get('blockchain')
  @Permissions('audit:read')
  blockchain(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.blockchain(query, req.user);
  }

  @Get('withdrawals')
  @Permissions('financial:read')
  withdrawals(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.withdrawals(query, req.user);
  }

  @Get('savings-accounts')
  @Permissions('withdrawals:manage')
  accounts(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.accounts(query, req.user);
  }

  @Post('withdrawals')
  @Permissions('financial:write')
  requestWithdrawal(@Body() dto: CreateWithdrawalDto, @Req() req: RequestWithUser) {
    return this.operations.requestWithdrawal(dto, req.user);
  }

  @Post('withdrawals/:id/review')
  @Permissions('withdrawals:manage')
  reviewWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWithdrawalDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operations.reviewWithdrawal(id, dto, req.user);
  }

  @Post('withdrawals/:id/finance-review')
  @Permissions('withdrawals:review')
  financeReviewWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinanceReviewWithdrawalDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operations.financeReviewWithdrawal(id, dto, req.user);
  }

  @Get('cycles')
  @Permissions('cycles:manage')
  cycles(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.cycles(query, req.user);
  }

  @Post('cycles')
  @Permissions('cycles:manage')
  createCycle(@Body() dto: CreateCycleDto, @Req() req: RequestWithUser) {
    return this.operations.createCycle(dto, req.user);
  }

  @Patch('cycles/:id')
  @Permissions('cycles:manage')
  updateCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCycleDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operations.updateCycle(id, dto, req.user);
  }

  @Patch('cycles/:id/status')
  @Permissions('cycles:manage')
  cycleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CycleStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operations.cycleStatus(id, dto, req.user);
  }
}
