/**
 * Static checks for service worker image-cache safety.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '../../public/sw.js');

describe('service worker image cache handling', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(swPath, 'utf8');
  });

  it('bumps the cache version to evict old image cache entries', () => {
    expect(content).toContain("const CACHE_VERSION = 'eventflow-v18.8.1'");
    expect(content).not.toContain("const CACHE_VERSION = 'eventflow-v18.8.0'");
    expect(content).not.toContain("const CACHE_VERSION = 'eventflow-v18.7.3'");
  });

  it('routes /api/photos image requests before the generic API handler', () => {
    const photoBlockStart = content.indexOf("url.pathname.startsWith('/api/photos/')");
    const apiBlockStart = content.indexOf("if (url.pathname.startsWith('/api/'))");
    const genericImageStart = content.indexOf('// Cache-first strategy for images');

    expect(photoBlockStart).toBeGreaterThan(-1);
    expect(apiBlockStart).toBeGreaterThan(photoBlockStart);
    expect(genericImageStart).toBeGreaterThan(apiBlockStart);
  });

  it('only writes successful image responses to the cache', () => {
    expect(content).toContain('if (fetchResponse.ok)');
  });
});
