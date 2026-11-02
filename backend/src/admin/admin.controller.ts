import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Response } from 'express';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { AppError } from '../common/errors';
import { StrongPassword } from '../common/password';
import { Paytable, MAX_PICKS_LIMIT } from '../keno/paytable';
import { KenoSettingsService } from '../keno/settings.service';
import { PaymentStatus, PaymentsService } from '../payments/payments.service';
import { BetType } from '../roulette/rules';
import { BetLimit, RouletteSettingsService } from '../roulette/settings.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminService, EXPORT_KINDS, ExportKind } from './admin.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class StaffLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  /** Facultatif seulement si STAFF_TOTP=off (développement). */
  @IsOptional()
  @Matches(/^\d{6}$/)
  totp?: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @StrongPassword()
  newPassword!: string;
}

class RangeQuery {
  @Matches(DAY)
  from!: string;

  @Matches(DAY)
  to!: string;
}

class SettingsDto {
  @IsInt()
  @Min(1)
  minStakeCents!: number;

  @IsInt()
  @Min(1)
  maxStakeCents!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_PICKS_LIMIT)
  maxPicks!: number;

  @IsInt()
  @Min(1)
  maxPayoutCents!: number;

  @IsObject()
  paytable!: Paytable;
}

class RouletteSettingsDto {
  @IsArray()
  @IsInt({ each: true })
  chipValuesCents!: number[];

  @IsObject()
  betLimits!: Record<BetType, BetLimit>;

  @IsInt()
  @Min(1)
  maxTotalStakeCents!: number;

  @IsInt()
  @Min(1)
  maxPayoutCents!: number;

  @IsBoolean()
  topLineEnabled!: boolean;
}

class PlayersQuery {
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

class PlayerUpdateDto {
  @IsOptional()
  @IsIn(['active', 'blocked'])
  status?: 'active' | 'blocked';

  @IsOptional()
  @IsIn(['none', 'pending', 'verified', 'rejected'])
  kycStatus?: 'none' | 'pending' | 'verified' | 'rejected';

  @IsOptional()
  @IsInt()
  @Min(100)
  dailyLossLimitCents?: number;
}

class WithdrawalsQuery {
  @IsOptional()
  @IsIn(['awaiting_approval', 'processing', 'completed', 'failed', 'rejected'])
  status?: PaymentStatus;
}

class RejectDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: StaffLoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totp);
  }
}

@Controller('admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly kenoSettings: KenoSettingsService,
    private readonly rouletteSettings: RouletteSettingsService,
    private readonly payments: PaymentsService,
    private readonly auth: AdminAuthService,
  ) {}

  /** Le compte connecté change son propre mot de passe (l'actuel est exigé). Déconnecte les autres sessions. */
  @Patch('auth/password')
  @HttpCode(204)
  changePassword(@CurrentStaff() staff: StaffPrincipal, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(staff.id, dto.currentPassword, dto.newPassword);
  }

  @Get('dashboard')
  dashboard(@Query() q: RangeQuery) {
    return this.admin.dashboard(q.from, q.to);
  }

  @Get('keno/settings')
  async getKenoSettings() {
    return { current: await this.kenoSettings.current(), history: await this.kenoSettings.history() };
  }

  @Put('keno/settings')
  @Roles('super_admin')
  updateKenoSettings(@CurrentStaff() staff: StaffPrincipal, @Body() dto: SettingsDto) {
    return this.kenoSettings.update(staff.id, dto);
  }

  @Get('roulette/settings')
  async getRouletteSettings() {
    return { current: await this.rouletteSettings.current(), history: await this.rouletteSettings.history() };
  }

  @Put('roulette/settings')
  @Roles('super_admin')
  updateRouletteSettings(@CurrentStaff() staff: StaffPrincipal, @Body() dto: RouletteSettingsDto) {
    return this.rouletteSettings.update(staff.id, dto);
  }

  @Get('roulette/alerts')
  @Roles('super_admin', 'finance', 'auditor')
  rouletteAlerts(@Query() q: RangeQuery) {
    return this.admin.rouletteAlerts(q.from, q.to);
  }

  @Get('players')
  @Roles('super_admin', 'support', 'auditor')
  players(@Query() q: PlayersQuery) {
    return this.admin.players(q.search, q.limit ?? 50);
  }

  @Patch('players/:id')
  @Roles('super_admin', 'support')
  updatePlayer(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PlayerUpdateDto,
  ) {
    return this.admin.updatePlayer(staff.id, id, dto);
  }

  @Get('withdrawals')
  @Roles('super_admin', 'finance', 'auditor')
  withdrawals(@Query() q: WithdrawalsQuery) {
    return this.payments.withdrawalsByStatus(q.status ?? 'awaiting_approval', 200);
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  @Roles('super_admin', 'finance')
  approve(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number) {
    return this.payments.approveWithdrawal(staff.id, id);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  @Roles('super_admin', 'finance')
  reject(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto) {
    return this.payments.rejectWithdrawal(staff.id, id, dto.reason);
  }

  @Get('exports/:kind')
  @Roles('super_admin', 'finance', 'auditor')
  async export(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('kind') kind: string,
    @Query() q: RangeQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new AppError('NOT_FOUND', 404);
    const csv = await this.admin.exportCsv(staff.id, kind as ExportKind, q.from, q.to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}_${q.from}_${q.to}.csv"`);
    return csv;
  }
}
