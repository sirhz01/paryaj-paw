import { ApiError } from './client';

const MESSAGES: Record<string, string> = {
  NETWORK: 'Serveur injoignable. Vérifiez votre connexion.',
  INVALID_CREDENTIALS: 'Téléphone ou mot de passe incorrect.',
  ACCOUNT_NOT_AUTHORIZED: 'Accès non autorisé.',
  ACCOUNT_LOCKED: 'Trop d’essais : compte bloqué quelques minutes.',
  INVALID_OTP: 'Code à 6 chiffres incorrect ou expiré.',
  OTP_REQUIRED: 'Un code à 6 chiffres est requis.',
  PHONE_TAKEN: 'Ce numéro a déjà un compte.',
  PHONE_INVALID: 'Numéro de téléphone invalide.',
  WEAK_PASSWORD: 'Mot de passe trop faible (8 caractères minimum, évitez les suites).',
  UNDERAGE: 'Vous devez avoir 18 ans ou plus.',
  INSUFFICIENT_FUNDS: 'Solde insuffisant.',
  AMOUNT_TOO_LOW: 'Montant trop bas.',
  AMOUNT_TOO_HIGH: 'Montant trop élevé.',
  SELF_EXCLUDED: 'Compte en auto-exclusion.',
  UNAUTHORIZED: 'Session expirée, reconnectez-vous.',
};

/** Message lisible pour une erreur d'API (ou une erreur quelconque). */
export function message(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] || `Erreur (${err.code}).`;
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue.';
}
