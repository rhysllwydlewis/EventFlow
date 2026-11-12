/**
 * validatePackageImageUrl – what may be stored as a package image.
 */
'use strict';

const {
  validatePackageImageUrl,
  MAX_PACKAGE_IMAGE_URL_LENGTH,
} = require('../../utils/packageImageUrl');

describe('validatePackageImageUrl', () => {
  test.each([
    '/api/photos/abc123?w=640',
    '/api/photos/abc123?w=640&h=480',
    '/uploads/packages/pkg_1.webp',
    '/assets/images/placeholders/package-event.svg',
    'https://example.com/a.jpg',
    'http://example.com/a.jpg?x=1&y=2',
    'https://cdn.example.com/a%22b.jpg',
  ])('accepts %s unchanged', url => {
    expect(validatePackageImageUrl(url)).toEqual({ ok: true, value: url });
  });

  test('trims surrounding whitespace', () => {
    expect(validatePackageImageUrl('  /api/photos/abc  ')).toEqual({
      ok: true,
      value: '/api/photos/abc',
    });
  });

  test('treats an empty string as "no image"', () => {
    expect(validatePackageImageUrl('')).toEqual({ ok: true, value: '' });
    expect(validatePackageImageUrl('   ')).toEqual({ ok: true, value: '' });
  });

  test.each([
    ['attribute breakout (double quote)', 'https://example.com/a.jpg" onerror="alert(1)'],
    ['attribute breakout (single quote)', "https://example.com/a.jpg' onerror='alert(1)"],
    ['angle brackets', 'https://example.com/<script>alert(1)</script>'],
    ['backtick', 'https://example.com/a`b.jpg'],
    ['whitespace inside', 'https://example.com/a b.jpg'],
    ['newline inside', 'https://example.com/a\n.jpg'],
    ['null byte', 'https://example.com/a\u0000.jpg'],
    ['backslash', '/\\evil.example/a.jpg'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['mixed-case javascript: URL', 'JaVaScRiPt:alert(1)'],
    ['data: URL', 'data:text/html,<b>x</b>'],
    ['vbscript: URL', 'vbscript:msgbox(1)'],
    ['file: URL', 'file:///etc/passwd'],
    ['ftp: URL', 'ftp://example.com/a.jpg'],
    ['protocol-relative URL', '//evil.example/a.jpg'],
    ['credentials in URL', 'https://user:pass@example.com/a.jpg'],
    ['bare word', 'not a url'],
    ['relative path without slash', 'images/a.jpg'],
  ])('rejects %s', (_label, url) => {
    const result = validatePackageImageUrl(url);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  test.each([
    ['an object', { url: 'https://example.com/a.jpg' }],
    ['an array', ['https://example.com/a.jpg']],
    ['a number', 42],
    ['true', true],
  ])('rejects %s', (_label, value) => {
    expect(validatePackageImageUrl(value).ok).toBe(false);
  });

  test('rejects URLs over the length limit', () => {
    const long = `/${'a'.repeat(MAX_PACKAGE_IMAGE_URL_LENGTH)}`;
    expect(validatePackageImageUrl(long).ok).toBe(false);
    expect(validatePackageImageUrl(long.slice(0, MAX_PACKAGE_IMAGE_URL_LENGTH)).ok).toBe(true);
  });
});
