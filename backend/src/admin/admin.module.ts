import { Module } from '@nestjs/common';
import { AgentWalletModule } from '../agents/agent-wallet.module';
import { AgentsModule } from '../agents/agents.module';
import { DrawsModule } from '../draws/draws.module';
import { KenoModule } from '../keno/keno.module';
import { PaymentsModule } from '../payments/payments.module';
import { RouletteModule } from '../roulette/roulette.module';
import { AdminAgentsController } from './admin-agents.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminDrawsController } from './admin-draws.controller';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [KenoModule, RouletteModule, DrawsModule, PaymentsModule, AgentsModule, AgentWalletModule],
  controllers: [AdminAuthController, AdminController, AdminDrawsController, AdminAgentsController],
  providers: [AdminService, AdminAuthService],
})
export class AdminModule {}
