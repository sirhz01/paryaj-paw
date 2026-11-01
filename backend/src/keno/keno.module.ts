import { Module } from '@nestjs/common';
import { FairnessModule } from '../fairness/fairness.module';
import { WalletModule } from '../wallet/wallet.module';
import { KenoController } from './keno.controller';
import { KenoService } from './keno.service';
import { KenoSettingsService } from './settings.service';

@Module({
  imports: [WalletModule, FairnessModule],
  controllers: [KenoController],
  providers: [KenoService, KenoSettingsService],
  exports: [KenoSettingsService],
})
export class KenoModule {}
