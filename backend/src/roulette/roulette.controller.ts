import { Body, Controller, Get, HttpCode, Post, Query, Type as NestType, UseGuards } from '@nestjs/common';
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
import { Game, hashServerSeed } from '../fairness/provably-fair';
import { SeedsService } from '../fairness/seeds.service';
import { RouletteService } from './roulette.service';
import {
  BET_TYPES,
  BetType,
  PAYOUTS,
  RACETRACK_BET_TYPES,
  RED_NUMBERS,
  RacetrackBetType,
  Variant,
  WHEEL_ORDERS,
  betTypesOf,
  colorOf,
  expandRacetrack,
  pocketLabel,
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

const SEED_GAME: Record<Variant, Game> = { european: 'roulette', american: 'american_roulette' };

/** Mêmes routes pour les deux variantes, sous `/roulette` (européenne) et `/american-roulette`. */
function rouletteController(variant: Variant, path: string): NestType<unknown> {
  @Controller(path)
  class RouletteController {
    constructor(
      readonly roulette: RouletteService,
      readonly seeds: SeedsService,
      readonly settings: RouletteSettingsService,
    ) {}

    /** Public : jetons, limites, table de paiement, RTP, roue (et annonces de la piste en européenne). */
    @Get('config')
    async config() {
      const s = await this.settings.current(variant);
      const types = betTypesOf(variant).filter((t) => t !== 'top_line' || s.topLineEnabled);
      return {
        variant,
        version: s.version,
        chipValuesCents: s.chipValuesCents,
        betLimits: s.betLimits,
        maxTotalStakeCents: s.maxTotalStakeCents,
        maxPayoutCents: s.maxPayoutCents,
        laPartage: s.laPartage,
        topLineEnabled: s.topLineEnabled,
        payouts: Object.fromEntries(types.map((t) => [t, PAYOUTS[t]])),
        rtpPercent: Object.fromEntries(types.map((t) => [t, rtpPercent(t, s.laPartage, variant)])),
        wheel: WHEEL_ORDERS[variant].map((n) => ({ number: n, label: pocketLabel(n), color: colorOf(n) })),
        redNumbers: RED_NUMBERS,
        // Composition de chaque annonce pour 1 jeton ; `neighbors` = le numéro et ses deux voisins de chaque côté.
        racetrack:
          variant === 'european'
            ? {
                voisins_du_zero: expandRacetrack('voisins_du_zero', 1),
                tiers: expandRacetrack('tiers', 1),
                orphelins: expandRacetrack('orphelins', 1),
              }
            : null,
      };
    }

    /** Public : recalcule le numéro d'un tour à partir des graines révélées. */
    @Post('verify')
    @HttpCode(200)
    verify(@Body() dto: VerifyDto) {
      const number = spinNumber(dto.serverSeed, dto.clientSeed, dto.nonce, variant);
      return { serverSeedHash: hashServerSeed(dto.serverSeed), number, label: pocketLabel(number), color: colorOf(number) };
    }

    @Post('spins')
    @UseGuards(PlayerGuard)
    spin(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: SpinDto) {
      return this.roulette.spin(player.id, variant, dto);
    }

    @Post('autoplay')
    @UseGuards(PlayerGuard)
    autoplay(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: AutoplayDto) {
      return this.roulette.autoplay(player.id, variant, dto);
    }

    @Get('spins')
    @UseGuards(PlayerGuard)
    spins(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
      return this.roulette.recentSpins(player.id, variant, q.limit ?? 50);
    }

    @Get('stats')
    @UseGuards(PlayerGuard)
    stats(@CurrentPlayer() player: PlayerPrincipal, @Query() q: LimitQuery) {
      return this.roulette.stats(player.id, variant, q.limit ?? 50);
    }

    @Get('seeds')
    @UseGuards(PlayerGuard)
    activeSeed(@CurrentPlayer() player: PlayerPrincipal) {
      return this.seeds.active(player.id, SEED_GAME[variant]);
    }

    @Get('seeds/revealed')
    @UseGuards(PlayerGuard)
    revealedSeeds(@CurrentPlayer() player: PlayerPrincipal) {
      return this.seeds.revealed(player.id, SEED_GAME[variant]);
    }

    @Post('seeds/rotate')
    @HttpCode(200)
    @UseGuards(PlayerGuard)
    rotateSeed(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: RotateSeedDto) {
      return this.seeds.rotate(player.id, SEED_GAME[variant], dto.clientSeed);
    }
  }
  return RouletteController;
}

export const EuropeanRouletteController = rouletteController('european', 'roulette');
export const AmericanRouletteController = rouletteController('american', 'american-roulette');
