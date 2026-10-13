import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { PaymentGatewayService } from './payment-gateway.service';
import { ProofDeliveryService } from './proof-delivery.service';

@Module({ imports: [AuthModule, BlockchainModule], providers: [WorkflowService, PaymentGatewayService, ProofDeliveryService], controllers: [WorkflowController], exports: [ProofDeliveryService] })
export class WorkflowModule {}
