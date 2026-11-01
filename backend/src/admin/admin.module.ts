import { Module } from '@nestjs/common';
import { KenoModule } from '../keno/keno.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [KenoModule, PaymentsModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminService, AdminAuthService],
})
export class AdminModule {}
