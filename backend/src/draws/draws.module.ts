import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DrawsController, TicketsController } from './draws.controller';
import { DrawEventsService } from './events.service';
import { DrawScheduler } from './scheduler.service';
import { SettlementService } from './settlement.service';
import { DrawSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [WalletModule],
  controllers: [DrawsController, TicketsController],
  providers: [DrawSettingsService, DrawEventsService, SettlementService, DrawScheduler, TicketsService],
  exports: [DrawSettingsService, DrawScheduler, SettlementService],
})
export class DrawsModule {}
