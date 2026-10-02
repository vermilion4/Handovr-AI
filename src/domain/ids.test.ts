import { describe, expect, it } from 'vitest';
import { isUuid } from './ids';

describe('isUuid', () => {
  it('accepts a uuid and refuses anything else', () => {
    expect(isUuid('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b')).toBe(true);
    for (const value of ['', 'new', '3f2b8c1e-9a4d-4e6f-8b7a', "1' OR '1'='1", '3f2b8c1e9a4d4e6f8b7a1c2d3e4f5a6b']) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
