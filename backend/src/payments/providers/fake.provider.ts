import { PaymentProvider } from './provider';

/** Fournisseur factice pour le développement : tout dépôt et tout retrait réussit aussitôt. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  private readonly deposits = new Map<string, number>();

  async startDeposit(paymentId: number, amountCents: number) {
    const providerRef = `fake-dep-${paymentId}`;
    this.deposits.set(providerRef, amountCents);
    return { providerRef };
  }

  async checkDeposit(providerRef: string) {
    const amountCents = this.deposits.get(providerRef);
    return amountCents === undefined
      ? { status: 'failed' as const, amountCents: 0 }
      : { status: 'completed' as const, amountCents };
  }

  async payout(paymentId: number) {
    return { status: 'completed' as const, providerRef: `fake-pay-${paymentId}` };
  }
}
