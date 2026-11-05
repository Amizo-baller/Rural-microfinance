import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class CreateWithdrawalDto {
  @IsUUID() savingsAccountId!: string;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,64}$/) providerId!: string;
  @IsString() @Matches(/^\+?[0-9]{7,15}$/) payoutPhone!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{10,100}$/) reference!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class ReviewWithdrawalDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MinLength(5) @MaxLength(1000) notes?: string;
}

export class FinanceReviewWithdrawalDto {
  @IsIn(['RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION']) decision!:
    'RECOMMEND_APPROVAL' | 'RECOMMEND_REJECTION';
  @IsString() @MinLength(5) @MaxLength(1000) notes!: string;
}

export class CreateCycleDto {
  @IsUUID() groupId!: string;
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) targetAmount!: string;
}

export class CycleStatusDto {
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED']) status!: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
