import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { randomBytes } from 'node:crypto';
import { createStaff } from '../admin/staff';
import { otpauthUrl, totpAt, totpCounter } from '../admin/totp';
import { AppModule, configureApp } from '../app.module';
import { StaffRole } from '../common/auth';
import { loadConfig } from '../config';
import { Database } from '../database/db';
import { migrate } from '../database/migrate';
import { createPgliteDatabase } from '../database/pglite';
import { serveFront } from '../front';
import { loadEnvFile } from './env';

/**
 * Démo complète sans PostgreSQL : API + front-end de la boutique sur http://localhost:3000,
 * base PGlite gardée dans DEMO_DATA_DIR (par défaut backend/.demo-db), fournisseur de paiement factice.
 * Crée un caissier et un super-admin de démonstration et affiche leurs codes TOTP toutes les 30 s.
 * npm run build && npm run demo
 */
const DEMO_PASSWORD = 'paryajpaw-demo';
const DEMO_STAFF: { email: string; role: StaffRole }[] = [
  { email: 'caisse@demo.local', role: 'cashier' },
  { email: 'admin@demo.local', role: 'super_admin' },
];

async function demoStaff(db: Database) {
  const accounts: { email: string; role: StaffRole; secret: string }[] = [];
  for (const { email, role } of DEMO_STAFF) {
    const { rows } = await db.query<{ totp_secret: string }>('SELECT totp_secret FROM staff WHERE email = $1', [email]);
    const secret = rows[0]?.totp_secret ?? (await createStaff(db, { email, role, password: DEMO_PASSWORD })).totpSecret;
    accounts.push({ email, role, secret });
  }
  return accounts;
}

/**
 * Secrets de signature de la démo, propres à cette machine : tirés au hasard à la première exécution et
 * gardés dans le dossier de données (hors dépôt). Les jetons restent valides d'un redémarrage à l'autre,
 * sans jamais exposer un secret connu publiquement.
 */
function demoSecrets(dataDir: string): Record<string, string> {
  const names = ['JWT_SECRET', 'STAFF_JWT_SECRET', 'AGENT_JWT_SECRET', 'OTP_PEPPER'];
  // À côté du dossier PGlite, pas dedans (PGlite gère son dossier et refuse un fichier étranger).
  const file = `${dataDir}-secrets.json`;
  const saved: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  for (const name of names) {
    if (!saved[name] || saved[name].length < 32) {
      saved[name] = randomBytes(32).toString('hex');
      changed = true;
    }
  }
  if (changed) writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  return saved;
}

async function main() {
  loadEnvFile();
  const dataDir = process.env.DEMO_DATA_DIR ?? '.demo-db';
  const config = loadConfig({
    ...demoSecrets(dataDir),
    ...process.env,
    NODE_ENV: 'development',
    PAYMENTS_FAKE: 'true',
    FRONT_DIR: process.env.FRONT_DIR ?? '..',
    // Pages ouvertes en double-cliquant (file://) : le navigateur envoie « Origin: null ». Démo seulement.
    CORS_ORIGINS: [process.env.CORS_ORIGINS, 'null'].filter(Boolean).join(','),
  });
  const db = createPgliteDatabase(dataDir);
  const applied = await migrate(db);
  const accounts = await demoStaff(db);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, db));
  configureApp(app, config);
  serveFront(app, config.frontDir);
  await app.listen(config.port);

  const logger = new Logger('Démo');
  if (applied.length) logger.log(`Migrations appliquées : ${applied.join(', ')}`);
  logger.log(`Boutique : http://localhost:${config.port}/  (caisse : /caisse.html, API : /api/v1)`);
  logger.log('Sur le réseau local, ouvrir les écrans avec l’adresse IP de cette machine.');
  for (const a of accounts) {
    logger.log(`${a.role} : ${a.email} / ${DEMO_PASSWORD} — application d'authentification : ${otpauthUrl(a.secret, a.email)}`);
  }
  if (!config.staffTotpRequired) {
    logger.warn('Code à 6 chiffres désactivé (STAFF_TOTP=off) : connexion avec e-mail et mot de passe seulement.');
    return;
  }
  // Chaque code ne sert qu'une fois : en démo, les codes du moment s'affichent à chaque nouvelle période de 30 s.
  let shown = -1;
  const showCodes = () => {
    const counter = totpCounter();
    if (counter === shown) return;
    shown = counter;
    logger.log(`Codes TOTP (30 s) : ${accounts.map((a) => `${a.email} ${totpAt(a.secret, counter)}`).join(' · ')}`);
  };
  showCodes();
  setInterval(showCodes, 1000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
