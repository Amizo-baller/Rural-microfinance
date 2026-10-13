import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class StartPaymentDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{10,80}$/) requestId!: string;
  @IsString() @MinLength(3) @MaxLength(50) memberId!: string;
  @IsIn(['CONTRIBUTION', 'REPAYMENT']) kind!: 'CONTRIBUTION' | 'REPAYMENT';
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string;
  @IsOptional() @IsUUID() loanId?: string;
  @IsOptional() @IsEmail() receiptEmail?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) weekStart?: string;
}
export class ReceiptDto {
  @IsString() @MaxLength(2800000) receipt!: string;
}
export class ReviewPaymentDto {
  @IsIn(['CONFIRM', 'REJECT']) decision!: 'CONFIRM' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
