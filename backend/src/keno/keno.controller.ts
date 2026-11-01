import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { KenoService } from './keno.service';
import { MAX_PICKS_LIMIT, rtpByPicks } from './paytable';
import { drawNumbers, hashServerSeed } from './provably-fair';
import { SeedsService } from './seeds.service';
import { KenoSettingsService } from './settings.service';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

class BetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PICKS_LIMIT)
  @IsInt({ each: true })
  picks!: number[];

  @IsInt()
  @Min(1)
  stakeCents!: number;

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

class AutoplayDto extends BetDto {
  @IsInt()
  @Min(5)
  @Max(100)
  rounds!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  stopOnProfitCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  stopOnLossCents?: number;
}

class LimitQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class RotateSeedDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  clientSeed?: string;
}

class VerifyDto {
  @IsString()
  @MaxLength(128)
  serverSeed!: string;

  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  clientSeed!: string;

  @IsInt()
  @Min(0)
  nonce!: number;
}

@Controller('keno')
export class KenoController {
  constructor(
    private readonly keno: KenoService,
    private readonly seeds: SeedsService,
    private readonly settings: KenoSettingsService,
  ) {}

  /** Public : règles, table de gains et RTP affichés sur la page du jeu. */
  @Get('config')
  async config() {
    const s = await this.settings.current();
    return {
      version: s.version,
      minStakeCents: s.minStakeCents,
      maxStakeCents: s.maxStakeCents,
      maxPicks: s.maxPicks,
      maxPayoutCents: s.maxPayoutCents,
      paytable: s.paytable,
      rtpPercent: rtpByPicks(s.paytable),
    };
  }

  /** Public : recalcule un tirage à partir des graines révélées. */
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    return {
      serverSeedHash: hashServerSeed(dto.serverSeed),
      drawn: drawNumbers(dto.serverSeed, dto.clientSeed, dto.nonce),
    };
  }

  @Post('bets')
  @UseGuards(PlayerGuard)
  bet(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: BetDto) {
    return this.keno.placeBet(player.id, dto);
  }

  @Post('autoplay')
  @UseGuards(PlayerGuard)
  autoplay(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: AutoplayDto) {
    return this.keno.autoplay(player.id, dto);
  }

  @Get('bets')
  @UseGuards(PlayerGuard)
  bets(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
    return this.keno.recentBets(player.id, q.limit ?? 50);
  }

  @Get('stats')
  @UseGuards(PlayerGuard)
  stats(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
    return this.keno.stats(player.id, q.limit ?? 50);
  }

  @Get('seeds')
  @UseGuards(PlayerGuard)
  activeSeed(@CurrentPlayer() player: PlayerPrincipal) {
    return this.seeds.active(player.id);
  }

  @Get('seeds/revealed')
  @UseGuards(PlayerGuard)
  revealedSeeds(@CurrentPlayer() player: PlayerPrincipal) {
    return this.seeds.revealed(player.id);
  }

  @Post('seeds/rotate')
  @HttpCode(200)
  @UseGuards(PlayerGuard)
  rotateSeed(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: RotateSeedDto) {
    return this.seeds.rotate(player.id, dto.clientSeed);
  }
}
