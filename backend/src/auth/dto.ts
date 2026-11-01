import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { OtpPurpose } from './otp.service';

export type Language = 'ht' | 'fr' | 'en';
export const LANGUAGES: Language[] = ['ht', 'fr', 'en'];

export class RequestOtpDto {
  @IsString()
  phone!: string;

  @IsIn(['register', 'reset_password'])
  purpose!: OtpPurpose;
}

export class RegisterDto {
  @IsString()
  phone!: string;

  @Matches(/^\d{6}$/)
  otp!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: Language;
}

export class LoginDto {
  @IsString()
  phone!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class ResetPasswordDto {
  @IsString()
  phone!: string;

  @Matches(/^\d{6}$/)
  otp!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
