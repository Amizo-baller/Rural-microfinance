import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BlockchainService } from './blockchain.service';

class RecordProofDto {
  @IsString() @MaxLength(100) reference!: string;
  @IsString() @MaxLength(200) recordHash!: string;
  @IsString() @MaxLength(100) transactionType!: string;
  @IsOptional() @IsString() @MaxLength(200) verificationData?: string;
}

class VerifyProofDto {
  @IsString() @MaxLength(200) expectedRecordHash!: string;
}

type AuthenticatedRequest = { user: { sub: string; role: string } };

@Controller('blockchain')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BlockchainController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Get('status')
  @Permissions('loans:read')
  status() { return { configured: this.blockchain.configured() }; }

  @Get('verify/:transactionId')
  @Permissions('financial:read')
  verifyTransaction(@Param('transactionId', ParseUUIDPipe) transactionId: string, @Req() request: AuthenticatedRequest) { return this.blockchain.verifyTransaction(transactionId, request.user); }

  @Post('proofs')
  @UseGuards(RolesGuard)
  @Roles('TREASURER', 'ADMIN', 'SUPER_ADMIN')
  @Permissions('financial:write')
  recordProof(@Body() dto: RecordProofDto) { return this.blockchain.recordProof(dto); }

  @Post('proofs/:reference/verify')
  @Permissions('financial:read')
  verifyProof(@Param('reference') reference: string, @Body() dto: VerifyProofDto) { return this.blockchain.verifyProof(reference, dto.expectedRecordHash); }
}
