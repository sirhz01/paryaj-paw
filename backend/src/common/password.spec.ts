import { isStrongPassword } from './password';

describe('isStrongPassword', () => {
  it('accepte un mot de passe correct', () => {
    for (const p of ['bonjou-2026', 'KenoHaiti9', 'm1z3-paryaj', 'Soley!Leve']) {
      expect(isStrongPassword(p)).toBe(true);
    }
  });

  it('refuse les mots de passe trop faibles', () => {
    for (const p of ['12345678', '87654321', 'aaaaaaaa', '00000000', 'password', 'motdepasse', 'paryajpaw', 'qwerty', 'court', '11112222']) {
      expect(isStrongPassword(p)).toBe(false);
    }
  });

  it('refuse ce qui est trop court, trop long ou pas une chaîne', () => {
    expect(isStrongPassword('a1b2c3d')).toBe(false);
    expect(isStrongPassword('a1'.repeat(70))).toBe(false);
    expect(isStrongPassword(12345678 as never)).toBe(false);
    expect(isStrongPassword(undefined as never)).toBe(false);
  });
});
