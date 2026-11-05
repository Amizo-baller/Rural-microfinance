import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { WorkflowService, WorkflowActor } from './workflow.service';
import { ReceiptDto, ReviewPaymentDto, StartPaymentDto } from './dto';
import { ProofDeliveryService } from './proof-delivery.service';

@Controller('workflow')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService, private readonly delivery: ProofDeliveryService) {}
  @Get('summary') summary(@Req() req: { user: WorkflowActor }) { return this.workflow.summary(req.user); }
  @Get('payments') list(@Req() req: { user: WorkflowActor }, @Query('page') page?: string) { const number = Number(page ?? 1); return this.workflow.list(req.user, Number.isInteger(number) && number > 0 ? number : 1); }
  @Post('payments') @Permissions('financial:write') start(@Body() dto: StartPaymentDto, @Req() req: { user: WorkflowActor }) { return this.workflow.start(dto, req.user); }
  @Post('payments/:id/verify') @Permissions('financial:write') verify(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: WorkflowActor }) { return this.workflow.verifyPayment(id, req.user); }
  @Post('payments/:id/receipt') @Permissions('financial:write') submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiptDto, @Req() req: { user: WorkflowActor }) { return this.workflow.submitReceipt(id, dto.receipt, req.user); }
  @Get('payments/:id/receipt') receipt(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: WorkflowActor }) { return this.workflow.receipt(id, req.user); }
  @Post('payments/:id/review') async review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPaymentDto, @Req() req: { user: WorkflowActor }) { const result = await this.workflow.review(id, dto, req.user); void this.delivery.deliver(); return result; }
}
