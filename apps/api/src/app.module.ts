import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminDashboardController } from './authorization/admin-dashboard.controller';
import { AdminDashboardService } from './authorization/admin-dashboard.service';
import { FinancialRecordsController } from './authorization/financial-records.controller';
import { FinancialRecordsService } from './authorization/financial-records.service';
import { LoansController } from './authorization/loans.controller';
import { LoansService } from './authorization/loans.service';
import { ReportsController } from './authorization/reports.controller';
import { ReportsService } from './authorization/reports.service';
import { SystemController } from './authorization/system.controller';
import { AdminOperationsController } from './authorization/admin-operations.controller';
import { AdminOperationsService } from './authorization/admin-operations.service';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { MembersModule } from './members/members.module';
import { MemberSpaceController } from './members/member-space.controller';
import { MemberSpaceService } from './members/member-space.service';
import { SavingsModule } from './savings/savings.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { MeetingsModule } from './meetings/meetings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkflowModule } from './workflow/workflow.module';
import { MonimePayoutService } from './authorization/monime-payout.service';
import { MonimeWebhookController } from './authorization/monime-webhook.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    PrismaModule,
    WorkflowModule,
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    GroupsModule,
    MembersModule,
    SavingsModule,
    BlockchainModule,
    MeetingsModule,
    NotificationsModule,
  ],
  controllers: [
    HealthController,
    MemberSpaceController,
    FinancialRecordsController,
    LoansController,
    AdminDashboardController,
    ReportsController,
    SystemController,
    AdminOperationsController,
    MonimeWebhookController,
  ],
  providers: [LoansService, FinancialRecordsService, AdminDashboardService, ReportsService, AdminOperationsService, MemberSpaceService, MonimePayoutService],
})
export class AppModule {}
