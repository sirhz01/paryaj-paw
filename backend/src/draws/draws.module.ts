import { Module } from '@nestjs/common';
import { AgentWalletModule } from '../agents/agent-wallet.module';
import { WalletModule } from '../wallet/wallet.module';
import { DrawsController, PublicTicketsController, TicketsController } from './draws.controller';
import { DrawEventsService } from './events.service';
import { DrawScheduler } from './scheduler.service';
import { SettlementService } from './settlement.service';
import { DrawSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [WalletModule, AgentWalletModule],
  controllers: [DrawsController, TicketsController, PublicTicketsController],
  providers: [DrawSettingsService, DrawEventsService, SettlementService, DrawScheduler, TicketsService],
  exports: [DrawSettingsService, DrawScheduler, SettlementService, TicketsService],
})
export class DrawsModule {}
