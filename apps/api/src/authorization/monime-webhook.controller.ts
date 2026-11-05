import { Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { MonimePayoutService } from './monime-payout.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/monime')
export class MonimeWebhookController {
  constructor(private readonly payouts: MonimePayoutService) {}

  @Post()
  @HttpCode(200)
  handle(@Req() request: RawBodyRequest) {
    if (!request.rawBody) throw new UnauthorizedException('Raw Monime webhook body is unavailable.');
    return this.payouts.handleWebhook(request.rawBody, request.get('monime-signature'));
  }
}
