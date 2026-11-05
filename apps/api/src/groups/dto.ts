import { CommunityGroupStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateGroupDto {
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^\d{1,12}(\.\d{1,2})?$/) weeklyContributionAmount?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() withdrawalsAllowed?: boolean;
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsString() @MinLength(2) @MaxLength(100) registrationNo!: string;
  @IsString() @MinLength(2) @MaxLength(255) location!: string;
  @IsString() @MinLength(2) @MaxLength(255) contactInfo!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsUUID() managerId!: string;
}

export class UpdateGroupDto {
  @ValidateIf((_object, value) => value !== undefined) @Matches(/^\d{1,12}(\.\d{1,2})?$/) weeklyContributionAmount?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() withdrawalsAllowed?: boolean;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) registrationNo?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) location?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(255) contactInfo?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsUUID() managerId?: string;
}

export class UpdateGroupStatusDto { @IsEnum(CommunityGroupStatus) status!: CommunityGroupStatus; }

export class ListGroupsDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsEnum(CommunityGroupStatus) status?: CommunityGroupStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
