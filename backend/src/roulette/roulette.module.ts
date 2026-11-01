import { Module } from '@nestjs/common';
import { FairnessModule } from '../fairness/fairness.module';
import { WalletModule } from '../wallet/wallet.module';
import { AmericanRouletteController, EuropeanRouletteController } from './roulette.controller';
import { RouletteService } from './roulette.service';
import { RouletteSettingsService } from './settings.service';

@Module({
  imports: [WalletModule, FairnessModule],
  controllers: [EuropeanRouletteController, AmericanRouletteController],
  providers: [RouletteService, RouletteSettingsService],
  exports: [RouletteSettingsService],
})
export class RouletteModule {}
