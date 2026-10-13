import { MemberStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const phoneRule = /^\+?[0-9]{7,30}$/;

export class CreateMemberDto {
  @IsUUID() userId!: string;
  @IsUUID() groupId!: string;
}

export class UpdateMemberDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(phoneRule) phone?: string;
}

export class UpdateMemberStatusDto { @IsEnum(MemberStatus) status!: MemberStatus; }

export class ListMembersDto {
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(MemberStatus) status?: MemberStatus;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
