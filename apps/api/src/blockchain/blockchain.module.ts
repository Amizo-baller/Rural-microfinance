import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';

// BlockchainService reads the signing wallet and contract address at startup.
// Restart the API after running a chain:configure command to load the new settings.
@Module({
  imports: [AuthModule],
  controllers: [BlockchainController],
  providers: [BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
