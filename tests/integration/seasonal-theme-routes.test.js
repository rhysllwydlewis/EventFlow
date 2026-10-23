'use strict';

/**
 * The seasonal navbar theme through the real server: the routes are mounted,
 * the public answer is safe to cache and carries nothing but a theme key, the
 * admin routes refuse anonymous callers, the new assets are served, the CSP
 * allows the data-URI artwork the theme relies on, and the page renderer still
 * hands out the navbar.js version that loads the loader.
 */

const request = require('supertest');
const app = require('../../server');
const { THEME_KEYS } = require('../../services/seasonalTheme.service');

describe('seasonal navbar theme (real server)', () => {
  it.each(['/api/public/seasonal-theme', '/api/v1/public/seasonal-theme'])(
    'GET %s answers with a theme key or null, and nothing else',
    async url => {
      const res = await request(app).get(url).expect(200);

      expect(Object.keys(res.body)).toEqual(['theme']);
      expect(res.body.theme === null || THEME_KEYS.includes(res.body.theme)).toBe(true);
      expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/);
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers['cache-control'])[1]);
      expect(maxAge).toBeGreaterThanOrEqual(1);
      expect(maxAge).toBeLessThanOrEqual(300);
    }
  );

  it.each([
    ['get', '/api/admin/settings/seasonal-theme'],
    ['put', '/api/admin/settings/seasonal-theme'],
    ['get', '/api/v1/admin/settings/seasonal-theme'],
    ['put', '/api/v1/admin/settings/seasonal-theme'],
  ])('%s %s refuses an anonymous caller', async (method, url) => {
    const req = request(app)[method](url);
    const res = await (method === 'put' ? req.send({ auto: true }) : req);

    expect([401, 403]).toContain(res.status);
  });

  it('serves the loader, the artwork and the stylesheet as static assets', async () => {
    const loader = await request(app).get('/assets/js/seasonal-theme.js').expect(200);
    expect(loader.headers['content-type']).toMatch(/javascript/);
    expect(loader.text).toContain('/api/public/seasonal-theme');

    const art = await request(app).get('/assets/js/seasonal-theme-art.js').expect(200);
    expect(art.text).toContain('window.EFSeasonalArt');

    const css = await request(app).get('/assets/css/seasonal-theme.css').expect(200);
    expect(css.headers['content-type']).toMatch(/css/);
    expect(css.text).toContain('pointer-events: none');
  });

  it('has a CSP that allows the data-URI artwork and a same-origin lookup', async () => {
    const res = await request(app).get('/api/public/seasonal-theme');
    const csp = res.headers['content-security-policy'] || '';

    expect(csp).toMatch(/img-src[^;]*\bdata:/);
    expect(csp).toMatch(/connect-src[^;]*'self'/);
  });

  it('still serves pages that load the version of navbar.js that brings in the loader', async () => {
    const res = await request(app).get('/about').expect(200);

    expect(res.text).toContain('/assets/js/navbar.js?v=1.2.0');
  });
});
