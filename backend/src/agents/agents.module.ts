import { Module } from '@nestjs/common';
import { DrawsModule } from '../draws/draws.module';
import { WalletModule } from '../wallet/wallet.module';
import { AgentWalletModule } from './agent-wallet.module';
import { AgentAuthController, AgentController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [AgentWalletModule, WalletModule, DrawsModule],
  controllers: [AgentAuthController, AgentController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
