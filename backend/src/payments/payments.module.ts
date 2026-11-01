import { Module } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FakePaymentProvider } from './providers/fake.provider';
import { PAYMENT_PROVIDERS, PaymentProvider, ProviderName } from './providers/provider';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      // MonCash et NatCash s'ajoutent ici dès que les accès marchands sont disponibles.
      provide: PAYMENT_PROVIDERS,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => {
        const providers = new Map<ProviderName, PaymentProvider>();
        if (config.fakePayments) providers.set('fake', new FakePaymentProvider());
        return providers;
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
