import { describe, expect, it } from 'vitest';
import { truncate, uniqueLinks } from './browser';

describe('truncate', () => {
  it('leaves short text alone and marks where long text was cut', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toBe(`${'a'.repeat(10)}\n[cut: 10 more characters]`);
  });
});

describe('uniqueLinks', () => {
  it('keeps web links once each, resolved against the page, without fragments', () => {
    expect(
      uniqueLinks(
        ['/menu', 'https://site.example/menu#top', 'mailto:hi@site.example', 'tel:123', 'javascript:void(0)', 'https://other.example/', '#contact'],
        'https://site.example/contact',
      ),
    ).toEqual(['https://site.example/menu', 'https://other.example/', 'https://site.example/contact']);
  });

  it('stops at the limit', () => {
    const hrefs = Array.from({ length: 50 }, (_, index) => `/page-${index}`);
    expect(uniqueLinks(hrefs, 'https://site.example/', 30)).toHaveLength(30);
  });
});
