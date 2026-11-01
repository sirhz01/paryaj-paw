/** Formate des centimes de gourde en « 1 234,50 HTG ». */
export function htg(cents: number | undefined | null): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' HTG';
}

/** Convertit un montant saisi en gourdes (ex. « 50 ») en centimes (5000). */
export function toCents(gourdes: string | number): number {
  return Math.round(Number(gourdes) * 100);
}
