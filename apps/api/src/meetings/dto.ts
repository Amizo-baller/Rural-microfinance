import { AttendanceStatus, MeetingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateMeetingDto {
  @IsUUID() groupId!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsDateString() scheduledAt!: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsString() @MaxLength(5000) agenda?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
}

export class ListMeetingsDto {
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(MeetingStatus) status?: MeetingStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class UpdateMeetingStatusDto { @IsEnum(MeetingStatus) status!: MeetingStatus; }

export class RecordAttendanceDto {
  @IsUUID() memberUserId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsDateString() checkedInAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
