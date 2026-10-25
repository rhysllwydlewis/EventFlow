'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/homepage-manager', () => ({
  getActiveHomepageVersion: jest.fn().mockResolvedValue('v1'),
  getHomepageToggles: jest.fn().mockResolvedValue({}),
  normaliseHomepageVersion: value => value,
}));

const { templateMiddleware, clearCache } = require('../../utils/template-renderer');
const { getActiveHomepageVersion, getHomepageToggles } = require('../../utils/homepage-manager');
const app = express();
app.use(templateMiddleware());

beforeEach(() => {
  clearCache();
  getActiveHomepageVersion.mockResolvedValue('v1');
  getHomepageToggles.mockResolvedValue({});
});

describe('V3 concept routing', () => {
  test.each(['/home-v3', '/home-v3.html', '/home-v3-preview', '/home-v3-preview.html'])(
    '%s serves the new page with preview indexing protection',
    async route => {
      const res = await request(app).get(route).expect(200);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.text).toContain('<meta name="robots" content="noindex,nofollow" />');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.text).toContain('Everything you need.');
      for (const id of [
        'categories',
        'locations',
        'packages',
        'spotlight',
        'wedding',
        'how-it-works',
        'guides',
        'marketplace',
        'for-suppliers',
      ]) {
        expect(res.text).toContain(`id="${id}"`);
      }
      expect(res.text).toContain('/assets/js/components/eventflow-footer.js?v=4');
      expect(res.text).not.toContain('This concept shows a captured selection');
      expect(res.text).not.toContain('Self-drive supercar hire');
      expect(res.text).not.toContain('/assets/css/home-v2.css');
      expect(res.text).not.toContain('/assets/js/pages/home-v3-video.js');
    }
  );

  test('regular root and V2 continue to serve their existing templates', async () => {
    const v1 = await request(app).get('/').expect(200);
    const v2 = await request(app).get('/home-v2-preview').expect(200);
    expect(v1.text).toContain('hero hero-modern');
    expect(v2.text).toContain('home-v2-white-fade-page');
    expect(v1.text).not.toContain('home-v3-concept');
    expect(v2.text).not.toContain('home-v3-concept');
    expect(v1.headers['x-robots-tag']).toBeUndefined();
  });

  test('selecting V3 through the existing manager serves it at root without preview robots', async () => {
    getActiveHomepageVersion.mockResolvedValue('v3');
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('Everything you need.');
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(res.text).not.toMatch(/name="robots"[^>]*noindex/);
  });
  test.each(['/home-v3', '/home-v3-preview', '/home-v3.html', '/home-v3-preview.html'])(
    'V3 display switches remain live on %s',
    async route => {
      getHomepageToggles.mockResolvedValue({ guidance: false, quickLinks: false });
      const off = await request(app).get(route).expect(200);
      const body = off.text.match(/<body[^>]*>/)[0];
      expect(body).not.toContain('ef-home-guidance');
      expect(body).not.toContain('ef-home-quicklinks');
      getHomepageToggles.mockResolvedValue({ guidance: true, quickLinks: true });
      const on = await request(app).get(route).expect(200);
      expect(on.text.match(/<body[^>]*>/)[0]).toContain('ef-home-guidance ef-home-quicklinks');
    }
  );
});
