import { Module } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsoleEmailSender, EMAIL_SENDER, ResendEmailSender, SmtpEmailSender } from './email';
import { OtpService } from './otp.service';
import { ConsoleSmsSender, SMS_SENDER } from './sms';

/** SMTP (ex. Gmail) en priorité, sinon Resend, sinon journalisation (dev/test). */
function emailSender(config: AppConfig) {
  if (config.smtpUser && config.smtpPass) return new SmtpEmailSender(config);
  if (config.resendApiKey) return new ResendEmailSender(config);
  return new ConsoleEmailSender(config);
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    // Conservé pour compatibilité (certaines suites de tests le remplacent) ; l'OTP passe par l'e-mail.
    { provide: SMS_SENDER, useClass: ConsoleSmsSender },
    { provide: EMAIL_SENDER, useFactory: emailSender, inject: [CONFIG] },
  ],
})
export class AuthModule {}
