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
  if (config.env !== 'production') {
    // Le serveur écoute sur toutes les interfaces : rappel avant de l'ouvrir au-delà de cette machine.
    Logger.warn(
      `Mode ${config.env} : secrets de signature aléatoires (sessions perdues au redémarrage)` +
        (config.fakePayments ? ', paiements factices' : '') +
        (config.staffTotpRequired ? '' : ', code à 6 chiffres désactivé') +
        '. Pour une mise en service, lancer avec NODE_ENV=production et de vrais secrets.',
      'Bootstrap',
    );
  }
  Logger.log(`API prête sur http://localhost:${config.port}/api/v1 (${config.env})`, 'Bootstrap');
}

void bootstrap();
