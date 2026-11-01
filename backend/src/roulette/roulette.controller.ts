import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { IDEMPOTENCY_KEY, RotateSeedDto, VerifyDto } from '../fairness/dto';
import { hashServerSeed } from '../fairness/provably-fair';
import { SeedsService } from '../fairness/seeds.service';
import { RouletteService } from './roulette.service';
import {
  BET_TYPES,
  BetType,
  PAYOUTS,
  RACETRACK_BET_TYPES,
  RED_NUMBERS,
  RacetrackBetType,
  WHEEL_ORDER,
  colorOf,
  expandRacetrack,
  rtpPercent,
  spinNumber,
} from './rules';
import { RouletteSettingsService } from './settings.service';

class BetRequestDto {
  @IsIn([...BET_TYPES, ...RACETRACK_BET_TYPES])
  type!: BetType | RacetrackBetType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  numbers?: number[];

  @IsOptional()
  @IsInt()
  index?: number;

  @IsInt()
  @Min(1)
  amountCents!: number;
}

class SpinDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BetRequestDto)
  bets!: BetRequestDto[];

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

class AutoplayDto extends SpinDto {
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

@Controller('roulette')
export class RouletteController {
  constructor(
    private readonly roulette: RouletteService,
    private readonly seeds: SeedsService,
    private readonly settings: RouletteSettingsService,
  ) {}

  /** Public : jetons, limites, table de paiement, RTP, roue et annonces de la piste. */
  @Get('config')
  async config() {
    const s = await this.settings.current();
    return {
      version: s.version,
      chipValuesCents: s.chipValuesCents,
      betLimits: s.betLimits,
      maxTotalStakeCents: s.maxTotalStakeCents,
      maxPayoutCents: s.maxPayoutCents,
      laPartage: s.laPartage,
      payouts: PAYOUTS,
      rtpPercent: Object.fromEntries(BET_TYPES.map((t) => [t, rtpPercent(t, s.laPartage)])),
      wheelOrder: WHEEL_ORDER,
      redNumbers: RED_NUMBERS,
      // Composition de chaque annonce pour 1 jeton ; `neighbors` = le numéro et ses deux voisins de chaque côté.
      racetrack: {
        voisins_du_zero: expandRacetrack('voisins_du_zero', 1),
        tiers: expandRacetrack('tiers', 1),
        orphelins: expandRacetrack('orphelins', 1),
      },
    };
  }

  /** Public : recalcule le numéro d'un tour à partir des graines révélées. */
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    const number = spinNumber(dto.serverSeed, dto.clientSeed, dto.nonce);
    return { serverSeedHash: hashServerSeed(dto.serverSeed), number, color: colorOf(number) };
  }

  @Post('spins')
  @UseGuards(PlayerGuard)
  spin(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: SpinDto) {
    return this.roulette.spin(player.id, dto);
  }

  @Post('autoplay')
  @UseGuards(PlayerGuard)
  autoplay(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: AutoplayDto) {
    return this.roulette.autoplay(player.id, dto);
  }

  @Get('spins')
  @UseGuards(PlayerGuard)
  spins(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
    return this.roulette.recentSpins(player.id, q.limit ?? 50);
  }

  @Get('stats')
  @UseGuards(PlayerGuard)
  stats(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
    return this.roulette.stats(player.id, q.limit ?? 50);
  }

  @Get('seeds')
  @UseGuards(PlayerGuard)
  activeSeed(@CurrentPlayer() player: PlayerPrincipal) {
    return this.seeds.active(player.id, 'roulette');
  }

  @Get('seeds/revealed')
  @UseGuards(PlayerGuard)
  revealedSeeds(@CurrentPlayer() player: PlayerPrincipal) {
    return this.seeds.revealed(player.id, 'roulette');
  }

  @Post('seeds/rotate')
  @HttpCode(200)
  @UseGuards(PlayerGuard)
  rotateSeed(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: RotateSeedDto) {
    return this.seeds.rotate(player.id, 'roulette', dto.clientSeed);
  }
}
