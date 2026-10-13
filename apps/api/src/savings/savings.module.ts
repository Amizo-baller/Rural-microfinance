import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';

@Module({ imports: [AuthModule], controllers: [SavingsController], providers: [SavingsService] })
export class SavingsModule {}
