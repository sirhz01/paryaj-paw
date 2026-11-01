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
import { IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Response } from 'express';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { AppError } from '../common/errors';
import { Paytable, MAX_PICKS_LIMIT } from '../keno/paytable';
import { KenoSettingsService } from '../keno/settings.service';
import { PaymentStatus, PaymentsService } from '../payments/payments.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminService, EXPORT_KINDS, ExportKind } from './admin.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class StaffLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @Matches(/^\d{6}$/)
  totp!: string;
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
    private readonly settings: KenoSettingsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('dashboard')
  dashboard(@Query() q: RangeQuery) {
    return this.admin.dashboard(q.from, q.to);
  }

  @Get('settings')
  async getSettings() {
    return { current: await this.settings.current(), history: await this.settings.history() };
  }

  @Put('settings')
  @Roles('super_admin')
  updateSettings(@CurrentStaff() staff: StaffPrincipal, @Body() dto: SettingsDto) {
    return this.settings.update(staff.id, dto);
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
