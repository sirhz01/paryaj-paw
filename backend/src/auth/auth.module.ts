import { Module } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsoleEmailSender, EMAIL_SENDER, ResendEmailSender } from './email';
import { OtpService } from './otp.service';
import { ConsoleSmsSender, SMS_SENDER } from './sms';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    // Conservé pour compatibilité (certaines suites de tests le remplacent) ; l'OTP passe par l'e-mail.
    { provide: SMS_SENDER, useClass: ConsoleSmsSender },
    {
      provide: EMAIL_SENDER,
      useFactory: (config: AppConfig) => (config.resendApiKey ? new ResendEmailSender(config) : new ConsoleEmailSender(config)),
      inject: [CONFIG],
    },
  ],
})
export class AuthModule {}
