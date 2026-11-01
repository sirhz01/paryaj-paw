import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { ConsoleSmsSender, SMS_SENDER } from './sms';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, { provide: SMS_SENDER, useClass: ConsoleSmsSender }],
})
export class AuthModule {}
