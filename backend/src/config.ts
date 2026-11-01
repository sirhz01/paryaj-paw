export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  staffJwtSecret: string;
  otpPepper: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  trustProxy: boolean;
  /** Dossier du front-end de la boutique à servir avec l'API ; vide = non servi. */
  frontDir: string;
  withdrawalApprovalThresholdCents: number;
  fakePayments: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error(`NODE_ENV inconnu : ${nodeEnv}`);
  }
  const production = nodeEnv === 'production';

  const secret = (name: string): string => {
    const value = env[name];
    if (value && value.length >= 32) return value;
    if (production) throw new Error(`${name} doit faire au moins 32 caractères en production`);
    return `dev-only-${name}-not-for-production`;
  };

  const integer = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} doit être un entier positif`);
    return value;
  };

  const fakePayments = env.PAYMENTS_FAKE === 'true';
  if (production && fakePayments) throw new Error('PAYMENTS_FAKE est interdit en production');

  return {
    env: nodeEnv,
    port: integer('PORT', 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://keno:keno@localhost:5432/keno',
    jwtSecret: secret('JWT_SECRET'),
    staffJwtSecret: secret('STAFF_JWT_SECRET'),
    otpPepper: secret('OTP_PEPPER'),
    accessTokenTtlSeconds: integer('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', 30),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    frontDir: env.FRONT_DIR ?? '',
    withdrawalApprovalThresholdCents: integer('WITHDRAWAL_APPROVAL_THRESHOLD_CENTS', 1_000_000),
    fakePayments,
  };
}
