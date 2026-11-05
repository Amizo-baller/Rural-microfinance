import { TransactionStatus, TransactionType, LoanApplicationStatus, LoanStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateFinancialRecordDto {
  @IsEnum(TransactionStatus) status!: TransactionStatus;
}

export class ListFinancialRecordsDto {
  @IsOptional() @IsEnum(TransactionType) type?: TransactionType;
  @IsOptional() @IsEnum(TransactionStatus) status?: TransactionStatus;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class CorrectFinancialRecordDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{4,100}$/) reference!: string;
  @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
}

export class UpdateLoanApplicationDto {
  @IsEnum(LoanApplicationStatus) status!: LoanApplicationStatus;
  @IsOptional() @IsString() @MaxLength(2000) reviewerNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) rejectionReason?: string;
}

export class CreateLoanApplicationDto {
  @IsString() @MinLength(3) @MaxLength(50) memberId!: string;
  @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
  @IsString() @MinLength(10) @MaxLength(2000) purpose!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(120) durationMonths!: number;
  @IsOptional() @IsDateString() applicationDate?: string;
  @IsOptional() @IsString() @MaxLength(5000) supportingInformation?: string;
}

export class ListLoanApplicationsDto {
  @IsOptional() @IsEnum(LoanApplicationStatus) status?: LoanApplicationStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class CreateApprovedLoanDto {
  @Matches(/^\d{1,3}(\.\d{1,4})?$/) interestRate!: string;
  @IsDateString() startDate!: string;
  @IsDateString() dueDate!: string;
}

export class DisburseLoanDto {
  @IsOptional() @IsString() @Matches(/^0x[0-9a-fA-F]{64}$/) blockchainTransactionHash?: string;
  @IsOptional() @IsString() @MaxLength(50) blockchainNetwork?: string;
  @IsOptional() @IsString() @MaxLength(42) contractAddress?: string;
  @IsOptional() @IsString() @MaxLength(100) blockchainMethod?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) blockNumber?: string;
}

export class RecordLoanRepaymentDto {
  @Matches(/^\d+(\.\d{1,2})?$/) amount!: string;
  @IsOptional() @IsDateString() repaymentDate?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @Matches(/^[A-Za-z0-9_-]{4,100}$/) reference!: string;
}

export class AssignAdministratorRoleDto {
  @IsIn(['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER', 'ADMIN'])
  role!: 'MEMBER' | 'GROUP_MANAGER' | 'TREASURER' | 'AUDITOR' | 'LOAN_OFFICER' | 'ADMIN';
}

export class UpdateSystemSettingDto {
  @IsObject() value!: Record<string, unknown>;
}

export class ReportsFilterDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) group?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) groupId?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) member?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) memberId?: string;
  @IsOptional() @IsEnum(TransactionType) transactionType?: TransactionType;
  @IsOptional() @IsIn([...Object.values(LoanStatus), LoanApplicationStatus.REJECTED]) loanStatus?: LoanStatus | 'REJECTED';
}

export class SettingKeyDto {
  @IsString() @MinLength(2) @MaxLength(100) @Matches(/^[A-Za-z0-9_.-]+$/) key!: string;
}
