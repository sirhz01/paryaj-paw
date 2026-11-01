import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AgentWalletService } from '../agents/agent-wallet.service';
import { AgentsService } from '../agents/agents.service';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { AppError } from '../common/errors';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class CreateAgentDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  /** Points de base : 500 = 5 % des mises jouées. */
  @IsInt()
  @Min(0)
  @Max(2000)
  ticketCommissionBp!: number;

  /** Points de base : 100 = 1 % des dépôts. */
  @IsInt()
  @Min(0)
  @Max(1000)
  depositCommissionBp!: number;

  @IsInt()
  @Min(0)
  creditLimitCents!: number;
}

class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsIn(['active', 'blocked'])
  status?: 'active' | 'blocked';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  ticketCommissionBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  depositCommissionBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimitCents?: number;
}

class FloatDto {
  @IsIn(['topup', 'withdrawal'])
  direction!: 'topup' | 'withdrawal';

  @IsInt()
  @Min(1)
  amountCents!: number;

  /** Reçu, référence du versement… */
  @IsString()
  @MaxLength(200)
  reference!: string;
}

class SearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
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

/** Points de vente : création, blocage, commissions, limite de crédit, versements et rapports. */
@Controller('admin/agents')
@UseGuards(StaffGuard)
export class AdminAgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly agentWallet: AgentWalletService,
  ) {}

  @Post()
  @Roles('super_admin')
  create(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CreateAgentDto) {
    return this.agents.create(staff.id, dto);
  }

  @Get()
  list(@Query() q: SearchQuery) {
    return this.agents.list(q.search, q.limit ?? 50);
  }

  @Patch(':id')
  @Roles('super_admin')
  update(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAgentDto) {
    return this.agents.update(staff.id, id, dto);
  }

  @Post(':id/float')
  @HttpCode(200)
  @Roles('super_admin', 'finance')
  float(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: FloatDto) {
    return this.agents.adjustFloat(staff.id, id, dto.direction, dto.amountCents, dto.reference);
  }

  @Get(':id/summary')
  summary(@Param('id', ParseIntPipe) id: number, @Query() q: RangeQuery) {
    if (Date.parse(q.to) < Date.parse(q.from)) throw new AppError('INVALID_DATE_RANGE');
    return this.agents.summary(id, q.from, q.to);
  }

  @Get(':id/ledger')
  @Roles('super_admin', 'finance', 'auditor')
  ledger(@Param('id', ParseIntPipe) id: number, @Query() q: PageQuery) {
    return this.agentWallet.ledger(id, q.limit ?? 50, q.beforeId);
  }
}
