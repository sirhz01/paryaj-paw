import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { StrongPassword } from '../common/password';
import { OtpPurpose } from './otp.service';

export type Language = 'ht' | 'fr' | 'en';
export const LANGUAGES: Language[] = ['ht', 'fr', 'en'];

export class RequestOtpDto {
  @IsEmail()
  email!: string;

  @IsIn(['register', 'reset_password'])
  purpose!: OtpPurpose;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/)
  otp!: string;

  @IsString()
  @StrongPassword()
  password!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  /** Téléphone facultatif (utile pour les retraits MonCash / NatCash). */
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/)
  otp!: string;

  @IsString()
  @StrongPassword()
  newPassword!: string;
}
