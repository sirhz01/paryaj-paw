import { Module } from '@nestjs/common';
import { SHOP_CLOCK, systemClock } from './clock';
import { CashierPresence } from './presence.service';
import { RoundsService } from './rounds.service';
import { ShopScheduler } from './scheduler';
import { ShopSettingsService } from './settings.service';
import { ShopAdminController, ShopController } from './shop.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [ShopController, ShopAdminController],
  providers: [
    { provide: SHOP_CLOCK, useValue: systemClock },
    ShopSettingsService,
    CashierPresence,
    RoundsService,
    TicketsService,
    ShopScheduler,
  ],
  exports: [RoundsService, TicketsService, ShopSettingsService, CashierPresence],
})
export class ShopModule {}
