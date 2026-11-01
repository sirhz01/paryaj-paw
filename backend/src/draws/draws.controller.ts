import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Observable } from 'rxjs';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { HAITI_TIME_ZONE } from '../common/haiti';
import { DATABASE, Database } from '../database/db';
import { IDEMPOTENCY_KEY } from '../fairness/dto';
import { hashServerSeed } from '../fairness/provably-fair';
import { DrawEventsService } from './events.service';
import { BALL_COLORS, BallColor, DRAW_GAMES, DrawGame, GAME_RULES, ballColor, drawBalls, rtpTable } from './games';
import { DrawScheduler } from './scheduler.service';
import { DrawSettingsService } from './settings.service';
import { TicketsService } from './tickets.service';

export function parseGame(value: string): DrawGame {
  if (!(DRAW_GAMES as string[]).includes(value)) throw new AppError('NOT_FOUND', 404);
  return value as DrawGame;
}

const DRAW_COLUMNS = `id, game, scheduled_at AS "scheduledAt", closes_at AS "closesAt", status, balls,
  server_seed_hash AS "serverSeedHash",
  CASE WHEN status IN ('drawn', 'settled') THEN server_seed END AS "serverSeed",
  cancel_reason AS "cancelReason"`;

class ResultsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  drawId?: number;
}

class UpcomingQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class VerifyDrawDto {
  @IsIn(DRAW_GAMES)
  game!: DrawGame;

  @IsInt()
  @Min(1)
  drawId!: number;

  @IsString()
  @MaxLength(128)
  serverSeed!: string;
}

class TicketBetDto {
  @IsString()
  @MaxLength(32)
  type!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  numbers?: number[];

  @IsOptional()
  @IsIn(BALL_COLORS)
  color?: BallColor;
}

class TicketDto {
  @IsIn(DRAW_GAMES)
  game!: DrawGame;

  @ValidateNested()
  @Type(() => TicketBetDto)
  bet!: TicketBetDto;

  @IsInt()
  @Min(1)
  stakeCents!: number;

  @IsInt()
  @Min(1)
  @Max(50)
  draws!: number;

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

class TicketsQuery {
  @IsOptional()
  @IsIn(DRAW_GAMES)
  game?: DrawGame;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller()
export class DrawsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: DrawSettingsService,
    private readonly scheduler: DrawScheduler,
    private readonly events: DrawEventsService,
  ) {}

  /** Accueil : les jeux, et pour les tirages programmés le prochain tirage encore ouvert. */
  @Get('lobby')
  async lobby() {
    const scheduled = await Promise.all(
      DRAW_GAMES.map(async (game) => {
        await this.scheduler.ensureUpcoming(game);
        const { rows } = await this.db.query(
          `SELECT id, scheduled_at AS "scheduledAt", closes_at AS "closesAt", server_seed_hash AS "serverSeedHash"
             FROM draws WHERE game = $1 AND status = 'scheduled' AND closes_at > $2 ORDER BY scheduled_at LIMIT 1`,
          [game, this.clock.now()],
        );
        return { game, kind: 'scheduled', path: `/draws/${game}`, nextDraw: rows[0] ?? null };
      }),
    );
    return {
      serverTime: this.clock.now(),
      games: [
        { game: 'american_roulette', kind: 'instant', path: '/american-roulette' },
        { game: 'roulette', kind: 'instant', path: '/roulette' },
        { game: 'keno', kind: 'instant', path: '/keno' },
        ...scheduled,
      ],
    };
  }

  /** Direct : chaque résultat ou annulation, au moment du tirage (écran TV, lobby). */
  @Sse('draws/stream')
  stream(): Observable<MessageEvent> {
    return this.events.stream();
  }

  /** Recalcule les boules d'un tirage à partir de sa graine révélée. */
  @Post('draws/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyDrawDto) {
    return { serverSeedHash: hashServerSeed(dto.serverSeed), balls: drawBalls(dto.game, dto.serverSeed, dto.drawId) };
  }

  /** Règles chiffrées : mises, coefficients, paris annexes et RTP de chacun. */
  @Get('draws/:game/config')
  async config(@Param('game') game: string) {
    const g = parseGame(game);
    const { version, config } = await this.settings.current(g);
    const rules = GAME_RULES[g];
    return {
      game: g,
      version,
      balls: rules.balls,
      drawn: rules.drawn,
      ...config,
      colors: Object.fromEntries(BALL_COLORS.map((c) => [c, Array.from({ length: rules.balls }, (_, i) => i + 1).filter((n) => ballColor(n) === c)])),
      rtpPercent: rtpTable(g, config),
    };
  }

  @Get('draws/:game/upcoming')
  async upcoming(@Param('game') game: string, @Query() q: UpcomingQuery) {
    const g = parseGame(game);
    await this.scheduler.ensureUpcoming(g);
    const { rows } = await this.db.query(
      `SELECT ${DRAW_COLUMNS} FROM draws WHERE game = $1 AND status = 'scheduled' AND scheduled_at > $2
        ORDER BY scheduled_at LIMIT $3`,
      [g, this.clock.now(), q.limit ?? 10],
    );
    return rows;
  }

  /** Résultats publiés, par jour (heure d'Haïti, aujourd'hui par défaut) ou par numéro de tirage. */
  @Get('draws/:game/results')
  async results(@Param('game') game: string, @Query() q: ResultsQuery) {
    const g = parseGame(game);
    const date = q.drawId ? null : (q.date ?? this.clock.now().toLocaleDateString('en-CA', { timeZone: HAITI_TIME_ZONE }));
    const { rows } = await this.db.query(
      `SELECT ${DRAW_COLUMNS} FROM draws
        WHERE game = $1 AND status <> 'scheduled'
          AND ($2::bigint IS NULL OR id = $2)
          AND ($3::date IS NULL OR (scheduled_at >= ($3::date::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')
                                    AND scheduled_at < (($3::date + 1)::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')))
        ORDER BY scheduled_at DESC LIMIT 300`,
      [g, q.drawId ?? null, date],
    );
    return rows;
  }

  @Get('draws/:game/:id')
  async draw(@Param('game') game: string, @Param('id', ParseIntPipe) id: number) {
    const { rows } = await this.db.query(`SELECT ${DRAW_COLUMNS} FROM draws WHERE game = $1 AND id = $2`, [parseGame(game), id]);
    if (!rows[0]) throw new AppError('DRAW_NOT_FOUND', 404);
    return rows[0];
  }
}

@Controller('tickets')
@UseGuards(PlayerGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  buy(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: TicketDto) {
    return this.tickets.buy(player.id, dto);
  }

  @Get()
  list(@CurrentPlayer() player: PlayerPrincipal, @Query() q: TicketsQuery) {
    return this.tickets.list(player.id, q.game, q.limit ?? 50);
  }

  /** Détail d'un ticket par son code (celui imprimé avec le QR code). */
  @Get(':code')
  byCode(@CurrentPlayer() player: PlayerPrincipal, @Param('code') code: string) {
    return this.tickets.byCode(player.id, code);
  }
}
