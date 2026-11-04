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

  it('autorise STAFF_TOTP=off en production (choix assumé, voir b261f67) mais refuse toute autre valeur', () => {
    expect(loadConfig({ NODE_ENV: 'production', STAFF_TOTP: 'off', ...SECRETS }).staffTotpRequired).toBe(false);
    expect(() => loadConfig({ NODE_ENV: 'development', STAFF_TOTP: 'non' })).toThrow(/on ou off/);
  });
});

describe('loadConfig : secrets de signature', () => {
  it('utilise les secrets fournis quand ils sont assez longs', () => {
    const c = loadConfig({ NODE_ENV: 'development', ...SECRETS });
    expect(c.jwtSecret).toBe(SECRETS.JWT_SECRET);
    expect(c.staffJwtSecret).toBe(SECRETS.STAFF_JWT_SECRET);
  });

  it("ne tombe jamais sur un secret en dur (un dépôt public n'en divulgue aucun)", () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    for (const s of [c.jwtSecret, c.staffJwtSecret, c.agentJwtSecret, c.otpPepper]) {
      expect(s).toMatch(/^[0-9a-f]{64}$/);
      expect(s).not.toContain('dev-only');
    }
    // Trois secrets distincts, pas un seul réutilisé partout.
    expect(new Set([c.jwtSecret, c.staffJwtSecret, c.agentJwtSecret]).size).toBe(3);
  });

  it('exige de vrais secrets en production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/32 caractères en production/);
    expect(() => loadConfig({ NODE_ENV: 'production', ...SECRETS })).not.toThrow();
  });
});
