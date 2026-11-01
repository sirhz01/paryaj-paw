export type ProviderName = 'moncash' | 'natcash' | 'fake';
export const PROVIDER_NAMES: ProviderName[] = ['moncash', 'natcash', 'fake'];

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

export interface PaymentProvider {
  readonly name: ProviderName;

  /** Ouvre un dépôt ; le joueur le valide ensuite chez le fournisseur (page ou code USSD). */
  startDeposit(paymentId: number, amountCents: number, phone: string): Promise<{ providerRef: string; redirectUrl?: string }>;

  /** Seule source de vérité pour créditer un dépôt : jamais sur la seule parole du client. */
  checkDeposit(providerRef: string): Promise<{ status: 'pending' | 'completed' | 'failed'; amountCents: number }>;

  /**
   * Envoie un retrait sur le compte mobile du joueur. Une exception signifie « issue inconnue » :
   * le retrait reste en traitement pour rapprochement, il n'est ni remboursé ni renvoyé.
   */
  payout(paymentId: number, amountCents: number, phone: string): Promise<{ status: 'completed' | 'failed'; providerRef: string; reason?: string }>;
}
