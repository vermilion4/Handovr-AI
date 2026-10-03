import { describe, expect, it } from 'vitest';
import { detached } from './notice';

describe('detached', () => {
  it('returns at once and lets a slow notice finish on its own', async () => {
    let finished = false;
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finished = true;
    };
    const started = Date.now();
    await detached(slow)('paid', 'm1');
    expect(Date.now() - started).toBeLessThan(20);
    expect(finished).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(finished).toBe(true);
  });

  it('swallows a failing notice', async () => {
    await expect(detached(async () => Promise.reject(new Error('Zapier is down')))('paid', 'm1')).resolves.toBeUndefined();
  });
});
