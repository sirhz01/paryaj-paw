import { existsSync } from 'node:fs';

/** Charge `.env` s'il existe ; les variables déjà définies dans l'environnement restent prioritaires. */
export function loadEnvFile(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
