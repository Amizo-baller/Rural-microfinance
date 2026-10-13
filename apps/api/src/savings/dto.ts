import { ContributionStatus, PaymentMethod, SavingsAccountStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const money = /^\d+(\.\d{1,2})?$/;

export class CreateSavingsAccountDto { @IsUUID() groupMemberId!: string; }

export class RecordContributionDto {
  @IsUUID() savingsAccountId!: string;
  @Matches(money) amount!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{4,100}$/) reference!: string;
  @IsOptional() @IsDateString() contributionDate?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod: PaymentMethod = PaymentMethod.CASH;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class ListContributionsDto {
  @IsOptional() @IsUUID() savingsAccountId?: string;
  @IsOptional() @IsUUID() groupMemberId?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(ContributionStatus) status?: ContributionStatus;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class StatementDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class UpdateSavingsAccountStatusDto { @IsEnum(SavingsAccountStatus) status!: SavingsAccountStatus; }
