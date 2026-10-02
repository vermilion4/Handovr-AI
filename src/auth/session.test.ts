import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from './session';

const SECRET = 'test-secret-0123456789';
const USER = '3f0e8a52-5b1c-4c6e-9d57-0d6f7c1a2b34';

describe('session tokens', () => {
  it('round-trips a user id', () => {
    expect(verifySession(signSession(USER, SECRET), SECRET)).toBe(USER);
  });

  it('rejects a token signed with another secret', () => {
    expect(verifySession(signSession(USER, 'other-secret'), SECRET)).toBeNull();
  });

  it('rejects a token whose user id was swapped', () => {
    const [, signature] = signSession(USER, SECRET).split('.');
    expect(verifySession(`00000000-0000-4000-8000-000000000000.${signature}`, SECRET)).toBeNull();
  });

  it.each([undefined, '', 'no-dot', '.', `${USER}.`, `.abc`, `${USER}.not-hex!`, 'a.b.c'])(
    'treats %j as signed out without throwing',
    (token) => {
      expect(verifySession(token, SECRET)).toBeNull();
    },
  );
});
