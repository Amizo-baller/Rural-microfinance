import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CorrectFinancialRecordDto, ListFinancialRecordsDto } from './dto';
import { FinancialRecordsService } from './financial-records.service';

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('financial-records')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinancialRecordsController {
  constructor(private readonly financialRecords: FinancialRecordsService) {}

  @Get()
  @Permissions('financial:read')
  list(@Query() query: ListFinancialRecordsDto, @Req() request: AuthenticatedRequest) {
    return this.financialRecords.list(query, request.user);
  }

  @Get(':id')
  @Permissions('financial:read')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
    return this.financialRecords.get(id, request.user);
  }

  @Post(':id/corrections')
  @Permissions('financial:write')
  correct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectFinancialRecordDto, @Req() request: AuthenticatedRequest) {
    return this.financialRecords.correct(id, dto, request.user);
  }
}
