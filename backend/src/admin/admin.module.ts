import { Module } from '@nestjs/common';
import { AgentWalletModule } from '../agents/agent-wallet.module';
import { AgentsModule } from '../agents/agents.module';
import { DrawsModule } from '../draws/draws.module';
import { KenoModule } from '../keno/keno.module';
import { PaymentsModule } from '../payments/payments.module';
import { RouletteModule } from '../roulette/roulette.module';
import { AdminAgentsController } from './admin-agents.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAdminsController } from './admin-admins.controller';
import { AdminCashiersController } from './admin-cashiers.controller';
import { AdminDrawsController } from './admin-draws.controller';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminsService } from './admins.service';
import { CashiersService } from './cashiers.service';

@Module({
  imports: [KenoModule, RouletteModule, DrawsModule, PaymentsModule, AgentsModule, AgentWalletModule],
  controllers: [AdminAuthController, AdminController, AdminDrawsController, AdminAgentsController, AdminCashiersController, AdminAdminsController],
  providers: [AdminService, AdminAuthService, CashiersService, AdminsService],
})
export class AdminModule {}
