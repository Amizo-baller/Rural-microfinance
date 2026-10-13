import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RepaymentDueScheduler } from './repayment-due.scheduler';

@Global()
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, RepaymentDueScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
