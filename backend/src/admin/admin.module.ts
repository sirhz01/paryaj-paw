import { Module } from '@nestjs/common';
import { DrawsModule } from '../draws/draws.module';
import { KenoModule } from '../keno/keno.module';
import { PaymentsModule } from '../payments/payments.module';
import { RouletteModule } from '../roulette/roulette.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminDrawsController } from './admin-draws.controller';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [KenoModule, RouletteModule, DrawsModule, PaymentsModule],
  controllers: [AdminAuthController, AdminController, AdminDrawsController],
  providers: [AdminService, AdminAuthService],
})
export class AdminModule {}
