import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
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
import { AgentGuard, AgentPrincipal, CurrentAgent } from '../common/auth';
import { AppError } from '../common/errors';
import { IDEMPOTENCY_KEY } from '../fairness/dto';
import { BALL_COLORS, BallColor, DRAW_GAMES, DrawGame } from '../draws/games';
import { TicketsService } from '../draws/tickets.service';
import { AgentWalletService } from './agent-wallet.service';
import { AgentsService } from './agents.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class AgentLoginDto {
  @IsString()
  phone!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

class SaleBetDto {
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

class SaleDto {
  @IsIn(DRAW_GAMES)
  game!: DrawGame;

  @ValidateNested()
  @Type(() => SaleBetDto)
  bet!: SaleBetDto;

  @IsInt()
  @Min(1)
  stakeCents!: number;

  @IsInt()
  @Min(1)
  @Max(50)
  draws!: number;

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;

  /** L'agent atteste avoir vérifié que le client a 18 ans ou plus. */
  @Equals(true)
  customerIsAdult!: boolean;
}

class PlayerDepositDto {
  @IsString()
  phone!: string;

  /** 1 HTG minimum. */
  @IsInt()
  @Min(100)
  amountCents!: number;

  @Matches(IDEMPOTENCY_KEY)
  idempotencyKey!: string;
}

class PickupDto {
  @IsString()
  phone!: string;

  @Matches(/^\d{8}$/)
  code!: string;
}

class RangeQuery {
  @Matches(DAY)
  from!: string;

  @Matches(DAY)
  to!: string;
}

class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;
}

@Controller('agent')
export class AgentAuthController {
  constructor(private readonly agents: AgentsService) {}

  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: AgentLoginDto) {
    return this.agents.login(dto.phone, dto.password);
  }
}

/** Application du point de vente : ventes, paiements au guichet, dépôts et retraits des joueurs, rapports. */
@Controller('agent')
@UseGuards(AgentGuard)
export class AgentController {
  constructor(
    private readonly agents: AgentsService,
    private readonly agentWallet: AgentWalletService,
    private readonly tickets: TicketsService,
  ) {}

  @Get('me')
  me(@CurrentAgent() agent: AgentPrincipal) {
    return this.agents.get(agent.id);
  }

  @Get('summary')
  summary(@CurrentAgent() agent: AgentPrincipal, @Query() q: RangeQuery) {
    if (Date.parse(q.to) < Date.parse(q.from)) throw new AppError('INVALID_DATE_RANGE');
    return this.agents.summary(agent.id, q.from, q.to);
  }

  @Get('ledger')
  ledger(@CurrentAgent() agent: AgentPrincipal, @Query() q: PageQuery) {
    return this.agentWallet.ledger(agent.id, q.limit ?? 50, q.beforeId);
  }

  /** Vente d'un ticket Lucky Six ou Lucky 10 ; la réponse contient le code et le contenu du QR à imprimer. */
  @Post('tickets')
  sell(@CurrentAgent() agent: AgentPrincipal, @Body() dto: SaleDto) {
    const { customerIsAdult: _, ...request } = dto;
    return this.tickets.sell(agent.id, request);
  }

  @Get('tickets')
  sales(@CurrentAgent() agent: AgentPrincipal, @Query() q: PageQuery) {
    return this.tickets.agentSales(agent.id, q.limit ?? 50);
  }

  /** Ticket présenté au guichet (code saisi ou QR scanné) : résultat et montant à payer. */
  @Get('tickets/:code')
  ticket(@Param('code') code: string) {
    return this.tickets.agentTicket(code);
  }

  @Post('tickets/:code/redeem')
  @HttpCode(200)
  redeem(@CurrentAgent() agent: AgentPrincipal, @Param('code') code: string) {
    return this.tickets.redeem(agent.id, code);
  }

  @Post('deposits')
  deposit(@CurrentAgent() agent: AgentPrincipal, @Body() dto: PlayerDepositDto) {
    return this.agents.depositForPlayer(agent.id, dto);
  }

  @Post('withdrawals/pickup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pickup(@CurrentAgent() agent: AgentPrincipal, @Body() dto: PickupDto) {
    return this.agents.payWithdrawal(agent.id, dto);
  }
}
