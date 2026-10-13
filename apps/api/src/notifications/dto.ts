import { NotificationType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListNotificationsDto {
  @IsOptional() @IsEnum(NotificationType) type?: NotificationType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}

export class CreateAnnouncementDto {
  @IsUUID() groupId!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(5000) message!: string;
}
