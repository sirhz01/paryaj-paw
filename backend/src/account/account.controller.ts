import { Body, Controller, Get, HttpCode, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { LANGUAGES, Language } from '../auth/dto';
import { CurrentPlayer, PlayerGuard, PlayerPrincipal } from '../common/auth';
import { AccountService } from './account.service';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

class LimitsDto {
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(100)
  dailyLossLimitCents!: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(100)
  dailyDepositLimitCents!: number | null;
}

class SelfExclusionDto {
  @IsInt()
  @Min(7)
  @Max(365)
  days!: number;
}

@Controller('me')
@UseGuards(PlayerGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  profile(@CurrentPlayer() player: PlayerPrincipal) {
    return this.account.profile(player.id);
  }

  @Patch()
  update(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: UpdateProfileDto) {
    return this.account.update(player.id, dto);
  }

  @Put('limits')
  setLimits(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: LimitsDto) {
    return this.account.setLimits(player.id, dto);
  }

  @Post('self-exclusion')
  @HttpCode(200)
  selfExclude(@CurrentPlayer() player: PlayerPrincipal, @Body() dto: SelfExclusionDto) {
    return this.account.selfExclude(player.id, dto.days);
  }
}
