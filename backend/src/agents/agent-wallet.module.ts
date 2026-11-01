import { Module } from '@nestjs/common';
import { AgentWalletService } from './agent-wallet.service';

/** Séparé du module des agents : les tirages en ont besoin pour les ventes et les commissions. */
@Module({
  providers: [AgentWalletService],
  exports: [AgentWalletService],
})
export class AgentWalletModule {}
