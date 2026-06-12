'use strict';

const { sanitizeWeddingImageUrl } = require('../../utils/weddingImageUrl');

describe('wedding image URL sanitiser', () => {
  test('allows http, https and valid base64 data image URLs', () => {
    expect(sanitizeWeddingImageUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
    expect(sanitizeWeddingImageUrl('http://example.com/photo.jpg')).toBe('http://example.com/photo.jpg');
    expect(sanitizeWeddingImageUrl('data:image/png;base64,aaaa')).toBe('data:image/png;base64,aaaa');
  });

  test('blocks unsafe, malformed and unsupported image URLs', () => {
    expect(sanitizeWeddingImageUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeWeddingImageUrl('data:text/html;base64,aaaa')).toBe('');
    expect(sanitizeWeddingImageUrl("data:image/png;base64,abc');background:url(javascript:alert(1))")).toBe('');
    expect(sanitizeWeddingImageUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe('');
  });
});
