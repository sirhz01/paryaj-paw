// Petit bus d'événements : une page de jeu signale un changement de solde,
// la barre du haut (Layout) le réécoute et rafraîchit le montant affiché.
export const WALLET_EVENT = 'pp:wallet';

export function walletChanged() {
  window.dispatchEvent(new Event(WALLET_EVENT));
}

/** Clé d'idempotence pour un pari (évite les doublons en cas de double clic / renvoi réseau). */
export function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
}
