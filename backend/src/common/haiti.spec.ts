import { isAdult, normalizeHaitiPhone } from './haiti';

describe('normalizeHaitiPhone', () => {
  it.each([
    ['3712 3456', '+50937123456'],
    ['+509 37 12 34 56', '+50937123456'],
    ['50948123456', '+50948123456'],
    ['(509) 2812-3456', '+50928123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHaitiPhone(input)).toBe(expected);
  });

  it.each(['1234567', '+33612345678', '37123456789', '6712 3456'])('refuse %s', (input) => {
    expect(normalizeHaitiPhone(input)).toBeNull();
  });
});

describe('isAdult', () => {
  const now = new Date('2026-10-31T12:00:00Z');

  it('accepte le jour des 18 ans et refuse la veille', () => {
    expect(isAdult('2008-10-31', now)).toBe(true);
    expect(isAdult('2008-11-01', now)).toBe(false);
  });
});
