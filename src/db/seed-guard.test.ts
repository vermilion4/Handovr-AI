import { describe, expect, it } from 'vitest';
import { assertSafeToSeed } from './seed-guard';

describe('assertSafeToSeed', () => {
  it('allows seeding in development and when NODE_ENV is unset', () => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSafeToSeed({})).not.toThrow();
  });

  it('refuses to wipe a production database', () => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('allows production only when explicitly confirmed', () => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'yes' })).not.toThrow();
    expect(() => assertSafeToSeed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' })).toThrow();
  });
});
