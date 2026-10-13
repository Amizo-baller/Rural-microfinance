import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const passwordRule = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
const phoneRule = /^\+?[0-9]{7,30}$/;
const assignableRoles = ['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER', 'ADMIN'] as const;

export class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(2) @MaxLength(100) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(phoneRule) phone?: string;
  @IsString() @MinLength(8) @Matches(passwordRule) password!: string;
  @IsIn(assignableRoles) role!: (typeof assignableRoles)[number];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(phoneRule) phone?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(500) profileImageUrl?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;
}

export class ListUsersDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsIn(assignableRoles) role?: (typeof assignableRoles)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
