import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { PaymentsService } from './payments.service';
import { PROVIDER_NAMES, ProviderName } from './providers/provider';

class PaymentDto {
  @IsIn(PROVIDER_NAMES)
  provider!: ProviderName;

  /** 1 HTG minimum. */
  @IsInt()
  @Min(100)
  amountCents!: number;

  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  idempotencyKey!: string;
}

class ListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller('payments')
@UseGuards(PlayerGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentPlayer() player: PlayerPrincipal, @Query() q: ListQuery) {
    return this.payments.list(player.id, q.limit ?? 50);
  }

  @Post('deposits')
  deposit(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: PaymentDto) {
    return this.payments.deposit(player.id, dto);
  }

  /** À appeler au retour de la page du fournisseur : le serveur vérifie lui-même auprès de lui. */
  @Post('deposits/:id/check')
  @HttpCode(200)
  check(@CurrentPlayer() player: PlayerPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.payments.checkDeposit(player.id, id);
  }

  @Post('withdrawals')
  withdraw(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: PaymentDto) {
    return this.payments.withdraw(player.id, dto);
  }
}
