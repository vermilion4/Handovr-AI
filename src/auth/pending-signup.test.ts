import { describe, expect, it } from 'vitest';
import { decodePendingSignup, encodePendingSignup } from './pending-signup';
import { signSession } from './session';

const identity = { name: 'John Freelancer', email: 'john@example.com', payerId: 'ZWYNW2PJJN4W2' };

describe('pending signup', () => {
  it('carries the PayPal identity until a role is chosen', () => {
    expect(decodePendingSignup(encodePendingSignup(identity, 'secret'), 'secret')).toEqual(identity);
  });

  it('keeps names with accents and punctuation intact', () => {
    const accented = { ...identity, name: "Tomás O'Rivera.Jr" };
    expect(decodePendingSignup(encodePendingSignup(accented, 'secret'), 'secret')).toEqual(accented);
  });

  it('refuses a value that was changed, signed with another secret, or missing', () => {
    const token = encodePendingSignup(identity, 'secret');
    expect(decodePendingSignup(token.replace(/^./, 'x'), 'secret')).toBeNull();
    expect(decodePendingSignup(token, 'other-secret')).toBeNull();
    expect(decodePendingSignup(undefined, 'secret')).toBeNull();
    expect(decodePendingSignup('', 'secret')).toBeNull();
  });

  it('refuses a session cookie presented as a pending signup', () => {
    expect(decodePendingSignup(signSession('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b', 'secret'), 'secret')).toBeNull();
  });
});
