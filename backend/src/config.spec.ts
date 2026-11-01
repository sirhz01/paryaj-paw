import { loadConfig } from './config';

const SECRETS = {
  JWT_SECRET: 'x'.repeat(32),
  STAFF_JWT_SECRET: 'y'.repeat(32),
  AGENT_JWT_SECRET: 'z'.repeat(32),
  OTP_PEPPER: 'p'.repeat(32),
};

describe('loadConfig : code TOTP du back-office', () => {
  it('est exigé par défaut', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).staffTotpRequired).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', ...SECRETS }).staffTotpRequired).toBe(true);
  });

  it('se désactive avec STAFF_TOTP=off hors production', () => {
    expect(loadConfig({ NODE_ENV: 'development', STAFF_TOTP: 'off' }).staffTotpRequired).toBe(false);
  });

  it('refuse STAFF_TOTP=off en production et toute autre valeur', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', STAFF_TOTP: 'off', ...SECRETS })).toThrow(/interdit en production/);
    expect(() => loadConfig({ NODE_ENV: 'development', STAFF_TOTP: 'non' })).toThrow(/on ou off/);
  });
});
