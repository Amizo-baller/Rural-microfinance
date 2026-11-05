import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CreateApprovedLoanDto, CreateLoanApplicationDto, DisburseLoanDto, ListLoanApplicationsDto, RecordLoanRepaymentDto, UpdateLoanApplicationDto } from './dto';
import { LoansService } from './loans.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('loans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Post('applications')
  @Permissions('financial:write')
  createApplication(@Body() dto: CreateLoanApplicationDto, @Req() request: AuthenticatedRequest) { return this.loans.create(dto, request.user); }

  @Get('applications')
  @Permissions('loans:read')
  listApplications(@Query() query: ListLoanApplicationsDto, @Req() request: AuthenticatedRequest) { return this.loans.list(query, request.user); }

  @Get('applications/:id')
  @Permissions('loans:read')
  getApplication(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.loans.get(id, request.user); }

  @Get('applications/:id/audit')
  @Permissions('loans:read')
  getApplicationAudit(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.loans.audit(id, request.user); }

  @Post('applications/:id/loan')
  @Permissions('loans:execute')
  createApprovedLoan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateApprovedLoanDto, @Req() request: AuthenticatedRequest) { return this.loans.createApprovedLoan(id, dto, request.user); }

  @Post(':id/disburse')
  @Permissions('loans:execute')
  disburseLoan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisburseLoanDto, @Req() request: AuthenticatedRequest) { return this.loans.disburse(id, dto, request.user); }

  @Get()
  @Permissions('loans:read')
  listLoans(@Query() query: ListLoanApplicationsDto, @Req() request: AuthenticatedRequest) { return this.loans.loans(query, request.user); }

  @Get(':id')
  @Permissions('loans:read')
  getLoan(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.loans.getLoan(id, request.user); }

  @Post(':id/repayments')
  @Permissions('financial:write')
  recordRepayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordLoanRepaymentDto, @Req() request: AuthenticatedRequest) { return this.loans.recordRepayment(id, dto, request.user); }

  @Get(':id/repayments')
  @Permissions('loans:read')
  repaymentHistory(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { return this.loans.repayments(id, request.user); }

  @Patch('applications/:id/status')
  @Permissions('loans:manage')
  async updateApplicationStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLoanApplicationDto, @Req() request: AuthenticatedRequest) {
    return this.loans.updateStatus(id, dto, request.user);
  }
}
