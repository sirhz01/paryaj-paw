import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { WalletService } from './wallet.service';

class TransactionsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

@Controller('wallet')
@UseGuards(PlayerGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  async get(@CurrentPlayer() player: PlayerPrincipal) {
    return { currency: 'HTG', balanceCents: await this.wallet.balance(player.id) };
  }

  @Get('transactions')
  transactions(@CurrentPlayer() player: PlayerPrincipal, @Query() q: TransactionsQuery) {
    return this.wallet.transactions(player.id, { ...q, limit: q.limit ?? 50 });
  }
}
