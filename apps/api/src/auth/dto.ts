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
  @IsOptional() @IsIn(['MEMBER', 'GROUP_MANAGER']) role?: 'MEMBER' | 'GROUP_MANAGER';
  @IsOptional() @IsUUID() groupId?: string;
}
export class LoginDto { @IsString() identifier!: string; @IsString() password!: string; }
export class RefreshDto { @IsString() refreshToken!: string; }
export class ForgotPasswordDto { @IsString() identifier!: string; }
export class ResetPasswordDto { @IsString() token!: string; @IsString() @MinLength(8) @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/) password!: string; }
