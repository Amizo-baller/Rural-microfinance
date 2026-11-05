import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminOperationsService } from '../authorization/admin-operations.service';
import { AdminPageDto, CreateWithdrawalDto } from '../authorization/admin-operations.dto';
import { MembersService } from './members.service';
import { MemberSpaceService } from './member-space.service';
import { MonimePayoutService } from '../authorization/monime-payout.service';

type RequestWithUser = { user: { sub: string; role: string } };
@Controller('member-space')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MEMBER')
export class MemberSpaceController {
  constructor(
    private readonly space: MemberSpaceService,
    private readonly members: MembersService,
    private readonly operations: AdminOperationsService,
    private readonly payouts: MonimePayoutService,
  ) {}
  @Get() overview(@Req() req: RequestWithUser) {
    return this.space.overview(req.user);
  }
  @Get('payout-providers') payoutProviders() { return this.payouts.providers(); }
  @Post('groups/:id/join') join(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.members.join(id, req.user);
  }
  @Get('withdrawals') withdrawals(@Query() query: AdminPageDto, @Req() req: RequestWithUser) {
    return this.operations.withdrawals(query, req.user);
  }
  @Post('withdrawals') withdraw(@Body() dto: CreateWithdrawalDto, @Req() req: RequestWithUser) {
    return this.operations.requestWithdrawal(dto, req.user);
  }
}
