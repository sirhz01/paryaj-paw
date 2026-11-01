import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { KenoController } from './keno.controller';
import { KenoService } from './keno.service';
import { SeedsService } from './seeds.service';
import { KenoSettingsService } from './settings.service';

@Module({
  imports: [WalletModule],
  controllers: [KenoController],
  providers: [KenoService, SeedsService, KenoSettingsService],
  exports: [KenoSettingsService],
})
export class KenoModule {}
