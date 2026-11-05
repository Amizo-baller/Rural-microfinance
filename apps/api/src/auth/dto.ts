import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const strongPassword = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

export class RegisterDto {
  @IsString() @MinLength(3) @MaxLength(50) @Matches(/^[A-Za-z0-9-]+$/) memberId!: string;
  @IsString() @MinLength(2) firstName!: string;
  @IsString() @MinLength(2) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(/^\+?[0-9]{7,30}$/) phone?: string;
  @IsString() @MinLength(8) @Matches(strongPassword) password!: string;
  @IsString() passwordConfirmation!: string;
  @IsOptional() @IsIn(['MEMBER', 'GROUP_MANAGER', 'ADMIN', 'TREASURER']) role?: 'MEMBER' | 'GROUP_MANAGER' | 'ADMIN' | 'TREASURER';
  @IsOptional() @IsUUID() groupId?: string;
}
export class LoginDto { @IsString() identifier!: string; @IsString() password!: string; }
export class GoogleLoginDto { @IsString() @MinLength(1) @MaxLength(10000) idToken!: string; }
export class WalletChallengeDto {
  @IsString() @Matches(/^0x[a-fA-F0-9]{40}$/) address!: string;
  @IsString() @Matches(/^[1-9][0-9]{0,19}$/) chainId!: string;
}
export class WalletProofDto {
  @IsString() @Matches(/^0x[a-fA-F0-9]{40}$/) address!: string;
  @IsString() @MinLength(100) @MaxLength(2000) message!: string;
  @IsString() @Matches(/^0x[a-fA-F0-9]{130}$/) signature!: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
export class ForgotPasswordDto { @IsString() identifier!: string; }
export class ResetPasswordDto { @IsString() token!: string; @IsString() @MinLength(8) @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/) password!: string; }
