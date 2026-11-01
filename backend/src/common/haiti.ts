export const HAITI_TIME_ZONE = 'America/Port-au-Prince';

/** Début de la journée en cours, heure d'Haïti (fragment SQL). */
export const SQL_HAITI_DAY_START = `(date_trunc('day', now() AT TIME ZONE '${HAITI_TIME_ZONE}') AT TIME ZONE '${HAITI_TIME_ZONE}')`;

/** Normalise un numéro haïtien en +509XXXXXXXX ; null s'il est invalide. */
export function normalizeHaitiPhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, '');
  const match = /^(?:\+?509)?([2-5]\d{7})$/.exec(compact);
  return match ? `+509${match[1]}` : null;
}

/** Vrai si la personne née le `birthDate` (AAAA-MM-JJ) a 18 ans à la date `now`. */
export function isAdult(birthDate: string, now = new Date()): boolean {
  const [year, month, day] = birthDate.split('-').map(Number);
  return Date.UTC(year + 18, month - 1, day) <= now.getTime();
}
