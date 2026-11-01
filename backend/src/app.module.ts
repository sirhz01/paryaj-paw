import {
  Controller,
  DynamicModule,
  Get,
  Global,
  HttpStatus,
  INestApplication,
  Inject,
  Module,
  OnApplicationShutdown,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AuditService } from './common/audit.service';
import { CLOCK, systemClock } from './common/clock';
import { PlayRulesService } from './common/play-rules.service';
import { AppError } from './common/errors';
import { AppConfig, CONFIG } from './config';
import { DATABASE, Database, PgDatabase } from './database/db';
import { DrawsModule } from './draws/draws.module';
import { KenoModule } from './keno/keno.module';
import { PaymentsModule } from './payments/payments.module';
import { RouletteModule } from './roulette/roulette.module';
import { ShopModule } from './shop/shop.module';
import { WalletModule } from './wallet/wallet.module';

@Global()
@Module({})
class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DATABASE, useFactory: () => new PgDatabase(config.databaseUrl) },
        { provide: CLOCK, useValue: systemClock },
        AuditService,
        PlayRulesService,
      ],
      exports: [CONFIG, DATABASE, CLOCK, AuditService, PlayRulesService],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

@Controller('health')
class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        JwtModule.register({ global: true }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 120 }],
          skipIf: () => config.env === 'test',
        }),
        AuthModule,
        AccountModule,
        WalletModule,
        PaymentsModule,
        KenoModule,
        RouletteModule,
        DrawsModule,
        ShopModule,
        AdminModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}

/** Réglages HTTP communs au serveur et aux tests. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  if (config.trustProxy) express.set('trust proxy', 1);
  express.use(helmet());
  express.enableCors({ origin: config.corsOrigins, credentials: false });
  express.setGlobalPrefix('api/v1');
  express.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AppError('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, {
          errors: errors.map((e) => ({ field: e.property, rules: Object.keys(e.constraints ?? {}) })),
        }),
    }),
  );
  express.enableShutdownHooks();
}
