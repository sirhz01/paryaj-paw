import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, configureApp } from './app.module';
import { loadConfig } from './config';
import { PgDatabase } from './database/db';
import { migrate } from './database/migrate';
import { serveFront } from './front';
import { loadEnvFile } from './scripts/env';

/**
 * En production (déploiement : Vercel, conteneur…), applique les migrations SQL en attente au démarrage,
 * puis démarre. La base reste ainsi en phase avec le code sans étape manuelle. Idempotent (table
 * schema_migrations). Hors production, `npm run migrate` reste l'étape explicite.
 */
async function migrateOnBoot(databaseUrl: string): Promise<void> {
  const db = new PgDatabase(databaseUrl);
  try {
    const applied = await migrate(db);
    Logger.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour', 'Bootstrap');
  } finally {
    await db.close();
  }
}

async function bootstrap() {
  loadEnvFile();
  const config = loadConfig();
  if (config.env === 'production') await migrateOnBoot(config.databaseUrl);
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
