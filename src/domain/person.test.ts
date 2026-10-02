import { describe, expect, it } from 'vitest';
import { initials } from './person';

describe('initials', () => {
  it('takes the first letters of the first and last name', () => {
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('Tomás Rivera')).toBe('TR');
  });

  it('uses the first and last of several names', () => {
    expect(initials('Ana María de la Cruz')).toBe('AC');
  });

  it('handles a single name and stray spaces', () => {
    expect(initials('  Prince ')).toBe('P');
  });

  it('returns a question mark for an empty name', () => {
    expect(initials('   ')).toBe('?');
  });
});
