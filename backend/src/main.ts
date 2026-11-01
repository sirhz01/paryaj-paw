import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, configureApp } from './app.module';
import { loadConfig } from './config';
import { serveFront } from './front';
import { loadEnvFile } from './scripts/env';

async function bootstrap() {
  loadEnvFile();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  configureApp(app, config);
  if (config.frontDir) serveFront(app, config.frontDir);
  await app.listen(config.port);
  Logger.log(`API prête sur http://localhost:${config.port}/api/v1 (${config.env})`, 'Bootstrap');
}

void bootstrap();
