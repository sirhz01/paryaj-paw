import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsObject, IsString, MaxLength } from 'class-validator';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { parseGame } from '../draws/draws.controller';
import { DrawConfig } from '../draws/games';
import { DrawScheduler } from '../draws/scheduler.service';
import { SettlementService } from '../draws/settlement.service';
import { DrawSettingsService } from '../draws/settings.service';

class DrawSettingsDto {
  @IsObject()
  config!: DrawConfig;
}

class ReasonDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/** Lucky Six et Lucky 10 : paramètres, gros gains à valider, annulation d'un tirage. */
@Controller('admin/draws')
@UseGuards(StaffGuard)
export class AdminDrawsController {
  constructor(
    private readonly settings: DrawSettingsService,
    private readonly settlement: SettlementService,
    private readonly scheduler: DrawScheduler,
  ) {}

  @Get('reviews')
  @Roles('super_admin', 'finance', 'auditor')
  reviews() {
    return this.settlement.pendingReviews(200);
  }

  @Post('reviews/:entryId/approve')
  @HttpCode(200)
  @Roles('super_admin', 'finance')
  approve(@CurrentStaff() staff: StaffPrincipal, @Param('entryId', ParseIntPipe) entryId: number) {
    return this.settlement.approve(staff.id, entryId);
  }

  @Post('reviews/:entryId/reject')
  @HttpCode(200)
  @Roles('super_admin', 'finance')
  reject(@CurrentStaff() staff: StaffPrincipal, @Param('entryId', ParseIntPipe) entryId: number, @Body() dto: ReasonDto) {
    return this.settlement.reject(staff.id, entryId, dto.reason);
  }

  @Post(':drawId/cancel')
  @HttpCode(204)
  @Roles('super_admin')
  cancel(@CurrentStaff() staff: StaffPrincipal, @Param('drawId', ParseIntPipe) drawId: number, @Body() dto: ReasonDto) {
    return this.scheduler.cancel(staff.id, drawId, dto.reason);
  }

  @Get(':game/settings')
  async getSettings(@Param('game') game: string) {
    const g = parseGame(game);
    return { current: await this.settings.current(g), history: await this.settings.history(g) };
  }

  @Put(':game/settings')
  @Roles('super_admin')
  updateSettings(@CurrentStaff() staff: StaffPrincipal, @Param('game') game: string, @Body() dto: DrawSettingsDto) {
    return this.settings.update(staff.id, parseGame(game), dto.config);
  }
}
