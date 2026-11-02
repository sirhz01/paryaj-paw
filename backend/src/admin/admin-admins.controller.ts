import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsString } from 'class-validator';
import { CurrentStaff, Roles, StaffGuard, StaffPrincipal } from '../common/auth';
import { StrongPassword } from '../common/password';
import { ADMIN_ROLES, AdminRole, AdminsService } from './admins.service';

class CreateAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @StrongPassword()
  password!: string;

  /** super_admin = accès complet ; auditor = consultation seulement. */
  @IsIn(ADMIN_ROLES as unknown as string[])
  role!: AdminRole;
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

/** Gestion des comptes d'administration, réservée au propriétaire (super_admin). */
@Controller('admin/admins')
@UseGuards(StaffGuard)
@Roles('super_admin')
export class AdminAdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  list() {
    return this.admins.list();
  }

  @Post()
  create(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CreateAdminDto) {
    return this.admins.create(staff.id, dto);
  }

  @Patch(':id/access')
  setAccess(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: AccessDto) {
    return this.admins.setAccess(staff.id, id, dto.active);
  }

  @Patch(':id/password')
  resetPassword(@CurrentStaff() staff: StaffPrincipal, @Param('id', ParseIntPipe) id: number, @Body() dto: PasswordDto) {
    return this.admins.resetPassword(staff.id, id, dto.password);
  }
}
