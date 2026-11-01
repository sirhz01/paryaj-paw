import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { StrongPassword } from '../common/password';
import { CashiersService } from './cashiers.service';

const TERMINAL = /^[\p{L}\p{N} #._-]{1,32}$/u;

class CreateCashierDto {
  @IsEmail()
  email!: string;

  @IsString()
  @StrongPassword()
  password!: string;

  /** Caisse attribuée par défaut (facultative) ; même format que les caisses des réglages. */
  @IsOptional()
  @IsString()
  @Matches(TERMINAL)
  terminal?: string;
}

class AccessDto {
  @IsBoolean()
  active!: boolean;
}

class PasswordDto {
  @IsString()
  @StrongPassword()
  password!: string;
}

/** Gestion des comptes caissiers, réservée au propriétaire (super_admin). */
@Controller('admin/cashiers')
@UseGuards(StaffGuard)
@Roles('super_admin')
export class AdminCashiersController {
  constructor(private readonly cashiers: CashiersService) {}

  @Get()
  list() {
    return this.cashiers.list();
  }

  @Post()
  create(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CreateCashierDto) {
    return this.cashiers.create(staff.id, dto);
  }

  @Patch(':id/access')
  setAccess(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: AccessDto) {
    return this.cashiers.setAccess(staff.id, id, dto.active);
  }

  @Patch(':id/password')
  resetPassword(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: PasswordDto) {
    return this.cashiers.resetPassword(staff.id, id, dto.password);
  }
}
