/** Throws in production unless ALLOW_DEMO_SEED is "yes". */
export function assertSafeToSeed(env: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string }): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== 'yes') {
    throw new Error(
      'Refusing to seed: this would delete all data in a production database. ' +
        'Set ALLOW_DEMO_SEED=yes to confirm.',
    );
  }
}
