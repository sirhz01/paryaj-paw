import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { SeedsService } from './seeds.service';

@Module({
  imports: [WalletModule],
  providers: [SeedsService],
  exports: [SeedsService],
})
export class FairnessModule {}
