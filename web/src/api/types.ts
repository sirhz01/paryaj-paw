// Formes de données échangées avec le back-end NestJS (/api/v1).

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type Language = 'ht' | 'fr' | 'en';

export interface RegisterInput {
  email: string;
  otp: string;
  password: string;
  birthDate: string; // AAAA-MM-JJ
  fullName?: string;
  phone?: string;
  language?: Language;
}

export interface Profile {
  id: number;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  language?: Language;
  status?: string;
  kycStatus?: string;
  [key: string]: unknown;
}

export interface Wallet {
  currency: string;
  balanceCents: number;
}

export interface Transaction {
  id: number;
  type: string;
  amountCents: number;
  balanceAfterCents?: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface LobbyGame {
  game: string;
  [key: string]: unknown;
}
