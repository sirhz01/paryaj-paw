import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_MONEY_CENTS } from '../common/money';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { IDEMPOTENCY_KEY } from '../fairness/dto';
import { CLOSE_MARGIN_SECONDS, NUMBER_GAMES, SHOP_GAMES, ShopGame, ShopPaytables, Timings, WHEEL_ORDER } from './games';
import { DAY_FORMAT, RoundsService } from './rounds.service';
import { ShopSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';

class LineDto {
  @IsOptional()
  @IsString()
  @MaxLength(12)
  key?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  picks?: number[];

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY_CENTS)
  stakeCents!: number;
}

class SellDto {
  @IsIn(SHOP_GAMES)
  game!: ShopGame;

  @IsString()
  @MaxLength(32)
  terminal!: string;

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}

/** Argent déclaré par le caissier (centimes) à l'ouverture et à la fermeture de sa caisse. */
class CashDto {
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_CENTS)
  cents!: number;
}

class LogoutDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY_CENTS)
  closingCents?: number;
}

class PayDto {
  @IsString()
  @MaxLength(32)
  terminal!: string;
}

class VerifyRoundDto {
  @IsIn(SHOP_GAMES)
  game!: ShopGame;

  @IsString()
  @MaxLength(128)
  serverSeed!: string;

  @Matches(DAY_FORMAT)
  day!: string;

  @IsInt()
  @Min(1)
  round!: number;
}

class ListQuery {
  @IsOptional()
  @Matches(DAY_FORMAT)
  day?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  terminal?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

class LatestQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class DayQuery {
  @IsOptional()
  @Matches(DAY_FORMAT)
  day?: string;
}

class RangeQuery {
  @Matches(DAY_FORMAT)
  from!: string;

  @Matches(DAY_FORMAT)
  to!: string;
}

class ShopSettingsDto {
  @IsString()
  @MaxLength(120)
  pointOfSale!: string;

  @IsString()
  @MaxLength(120)
  issuer!: string;

  @IsArray()
  @IsString({ each: true })
  terminals!: string[];

  @IsArray()
  @IsInt({ each: true })
  stakesCents!: number[];

  @IsInt()
  @Min(1)
  minStakeCents!: number;

  @IsInt()
  maxStakeCents!: number;

  @IsInt()
  maxTicketCents!: number;

  @IsInt()
  @Min(1)
  maxPayoutCents!: number;

  @IsInt()
  @Min(1)
  approvalThresholdCents!: number;

  @IsBoolean()
  topLineEnabled!: boolean;

  @IsObject()
  paytables!: ShopPaytables;

  /** Durées des tours par jeu ; absentes, les durées actuelles sont conservées. */
  @IsOptional()
  @IsObject()
  timings?: Timings;
}

function gameOf(value: string): ShopGame {
  if (!SHOP_GAMES.includes(value as ShopGame)) throw new AppError('NOT_FOUND', 404);
  return value as ShopGame;
}

/** Écrans TV (public) et caisse (jeton du back-office : caissier, super_admin). */
@Controller('shop')
export class ShopController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly tickets: TicketsService,
    private readonly settings: ShopSettingsService,
    @Inject(CONFIG) private readonly appConfig: AppConfig,
  ) {}

  /** Réglages d'affichage : durées, grilles, tables de gains, mises rapides, point de vente. */
  @Get('config')
  async config() {
    const s = await this.settings.current();
    return {
      serverTime: this.rounds.now(),
      pointOfSale: s.pointOfSale,
      issuer: s.issuer,
      terminals: s.terminals,
      stakesCents: s.stakesCents,
      minStakeCents: s.minStakeCents,
      maxStakeCents: s.maxStakeCents,
      maxTicketCents: s.maxTicketCents,
      topLineEnabled: s.topLineEnabled,
      closeMarginSeconds: CLOSE_MARGIN_SECONDS,
      // Durées du jour : un changement de réglage s'applique à partir du lendemain (les écrans se rechargent à minuit).
      timings: this.settings.timingsOn(this.rounds.today()),
      grids: NUMBER_GAMES,
      wheelOrder: WHEEL_ORDER,
      paytables: s.paytables,
      settingsVersion: s.version,
      // La caisse cache le champ du code à 6 chiffres quand il n'est pas exigé (STAFF_TOTP=off).
      staffTotpRequired: this.appConfig.staffTotpRequired,
    };
  }

  /** Horloge du serveur et tour en cours de chaque jeu, avec le hash scellé de sa graine. */
  @Get('state')
  state() {
    return this.rounds.states();
  }

  @Get('rounds/:game/latest')
  async latest(@Param('game') g: string, @Query() q: LatestQuery) {
    return { serverTime: this.rounds.now(), rounds: await this.rounds.latest(gameOf(g), q.limit ?? 10) };
  }

  @Get('rounds/:game/:day/:round')
  async round(@Param('game') g: string, @Param('day') day: string, @Param('round', ParseIntPipe) round: number) {
    return { serverTime: this.rounds.now(), ...(await this.rounds.get(gameOf(g), day, round)) };
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyRoundDto) {
    return this.rounds.verify(dto.game, dto.serverSeed, dto.day, dto.round);
  }

  @Post('tickets')
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin')
  sell(@CurrentStaff() staff: StaffPrincipal, @Body() dto: SellDto) {
    return this.tickets.sell(staff, dto);
  }

  @Get('tickets')
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin', 'finance', 'auditor')
  list(@Query() q: ListQuery) {
    return this.tickets.list(q.day, q.terminal, q.limit ?? 50);
  }

  @Get('tickets/:id')
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin', 'finance', 'auditor')
  async ticket(@Param('id') id: string) {
    return { serverTime: this.rounds.now(), ...(await this.tickets.get(id)) };
  }

  @Post('tickets/:id/pay')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin', 'finance')
  pay(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string, @Body() dto: PayDto) {
    return this.tickets.pay(staff, id, dto.terminal);
  }

  /** Annule un ticket (impression annulée, erreur) tant que le tirage du tour n'a pas commencé. */
  @Post('tickets/:id/void')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin')
  voidTicket(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.tickets.voidTicket(staff, id);
  }

  /** Déconnexion du caissier : enregistre son rapport de session et coupe son jeton. */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin', 'finance', 'auditor')
  logout(@CurrentStaff() staff: StaffPrincipal, @Body() dto: LogoutDto) {
    return this.tickets.closeShift(staff, dto.closingCents);
  }

  /** Début de service : le caissier déclare l'argent qu'il a en caisse. */
  @Post('shift/open')
  @HttpCode(200)
  @UseGuards(StaffGuard)
  @Roles('cashier')
  openShift(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CashDto) {
    return this.tickets.openShift(staff, dto.cents);
  }

  /** Argent attendu dans la caisse pour la session en cours (ouverture + ventes − décaissements), pour l'afficher. */
  @Get('shift/current')
  @UseGuards(StaffGuard)
  @Roles('cashier')
  currentShift(@CurrentStaff() staff: StaffPrincipal) {
    return this.tickets.currentShift(staff);
  }

  @Get('report')
  @UseGuards(StaffGuard)
  @Roles('cashier', 'super_admin', 'finance', 'auditor')
  report(@Query() q: DayQuery) {
    return this.tickets.report(q.day ?? this.rounds.today());
  }
}

@Controller('admin/shop')
@UseGuards(StaffGuard)
export class ShopAdminController {
  constructor(
    private readonly settings: ShopSettingsService,
    private readonly tickets: TicketsService,
    private readonly rounds: RoundsService,
  ) {}

  /** Paramètres actifs et RTP de chaque ligne de gains. */
  @Get('settings')
  @Roles('super_admin', 'finance', 'auditor')
  async current() {
    const s = await this.settings.current();
    return { settings: s, rtp: this.settings.rtp(s), timings: this.settings.timingsPlan(this.rounds.today()) };
  }

  @Put('settings')
  @Roles('super_admin')
  async update(@CurrentStaff() staff: StaffPrincipal, @Body() dto: ShopSettingsDto) {
    const s = await this.settings.update(staff.id, dto);
    return { settings: s, rtp: this.settings.rtp(s), timings: this.settings.timingsPlan(this.rounds.today()) };
  }

  @Get('dashboard')
  @Roles('super_admin', 'finance', 'auditor')
  dashboard(@Query() q: RangeQuery) {
    return this.tickets.dashboard(q.from, q.to);
  }

  /** Rapports de session des caissiers (un par déconnexion). */
  @Get('cashier-reports')
  @Roles('super_admin', 'finance', 'auditor')
  cashierReports() {
    return this.tickets.cashierReports(200);
  }
}
