'use strict';

/**
 * Public render mop-up tests.
 *
 * These tests cover the static repo state that should remain true after the
 * public launch-readiness PRs. Live deployment/source mismatches are checked by
 * scripts/check-public-render.mjs so they can be run against Railway separately.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

const readPublic = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const readRoot = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const KEY_PUBLIC_PAGES = [
  'index.html',
  'start.html',
  'public-calendar.html',
  'guides.html',
  'pricing.html',
  'faq.html',
  'marketplace.html',
  'suppliers.html',
  'for-suppliers.html',
  'legal.html',
];

describe('public render mop-up — build/deployment marker', () => {
  test('public/build-meta.json exists and is safe JSON', () => {
    const raw = readPublic('build-meta.json');
    const meta = JSON.parse(raw);
    expect(meta.app).toBe('EventFlow');
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(raw).not.toMatch(/secret|mongodb|railway_token|jwt/i);
  });

  test('public render checker exists and supports strict mode', () => {
    const script = readRoot('scripts/check-public-render.mjs');
    expect(script).toContain('EVENTFLOW_PUBLIC_BASE_URL');
    expect(script).toContain('--strict');
    expect(script).toContain('build-meta.json');
  });
});

describe('public render mop-up — stale text guardrails', () => {
  test('key public pages do not expose Version: loading in static files', () => {
    KEY_PUBLIC_PAGES.forEach(page => {
      const filePath = path.join(PUBLIC, page);
      if (!fs.existsSync(filePath)) return;
      expect(readPublic(page)).not.toMatch(/Version:\s*loading/i);
    });
  });

  test('homepage fake testimonial remnants remain absent from repo static HTML', () => {
    const html = readPublic('index.html');
    expect(html).not.toMatch(/What Our Customers Say/i);
    expect(html).not.toMatch(/Real experiences from real event planners/i);
    expect(html).not.toMatch(/Sarah\s*&(?:amp;)?\s*Tom/i);
    expect(html).not.toMatch(/James Wilson/i);
    expect(html).not.toMatch(/Emma Davies/i);
  });

  test('/start planner preload remains present for public first impression', () => {
    const html = readPublic('start.html');
    expect(html).toContain('wizard-preload');
    expect(html).toContain('Plan your event in minutes');
    expect(html).toContain('Supplier categories to consider');
  });

  test('public render checker is configured to catch calendar admin/static leaks live', () => {
    const script = readRoot('scripts/check-public-render.mjs');
    expect(script).toContain('Calendar publishing requests');
    expect(script).toContain('Approve suitable suppliers');
    expect(script).toContain('pending_review');
    expect(script).toContain('rejected');
  });
});
