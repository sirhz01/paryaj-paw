import { ValidationOptions, registerDecorator } from 'class-validator';

/** Les mots de passe les plus courants et les suites triviales : refusés même s'ils font 8 caractères. */
const BLOCKLIST = new Set([
  'password', 'motdepasse', 'paryajpaw', 'paryaj-paw', 'qwerty', 'azerty', 'iloveyou',
  'welcome', 'admin123', 'passw0rd', 'motdepas', 'haiti509', 'bonjou12',
]);

/** true si le mot de passe est assez solide : au moins 8 caractères et pas trivial. */
export function isStrongPassword(value: unknown): boolean {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) return false;
  const lower = value.toLowerCase();
  if (BLOCKLIST.has(lower)) return false;
  // Un seul caractère répété (« aaaaaaaa », « 00000000 »).
  if (/^(.)\1+$/.test(value)) return false;
  // Suite croissante ou décroissante de chiffres (« 12345678 », « 87654321 »).
  if (/^\d+$/.test(value)) {
    const asc = '01234567890';
    const desc = '09876543210';
    if (asc.includes(value) || desc.includes(value)) return false;
  }
  // Au moins deux familles de caractères (lettres, chiffres, autres) : empêche « aaaabbbb » et « 11112222 ».
  const families = [/[a-z]/i, /\d/, /[^a-z0-9]/i].filter((re) => re.test(value)).length;
  if (families < 2 && new Set(value).size < 5) return false;
  return true;
}

/** Validateur class-validator : mot de passe solide (voir isStrongPassword). */
export function StrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'strongPassword',
      target: object.constructor,
      propertyName,
      options: { message: 'Mot de passe trop faible (au moins 8 caractères, éviter les suites et mots courants).', ...options },
      validator: { validate: (value: unknown) => isStrongPassword(value) },
    });
}
