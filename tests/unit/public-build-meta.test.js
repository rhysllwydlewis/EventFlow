'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');
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

function readPublic(file) {
  return fs.readFileSync(path.join(PUBLIC, file), 'utf8');
}

describe('public build marker and launch-state guardrails', () => {
  test('public/build-meta.json exists and matches package version', () => {
    const meta = JSON.parse(readPublic('build-meta.json'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(meta.app).toBe('EventFlow');
    expect(meta.version).toBe(pkg.version);
    expect(meta.marker).toBe('pr-1228-final-public-render-cache-mopup');
    expect(meta.createdFor).toBe('final-public-render-cache-mopup-after-pr-1228');
  });

  test('key public pages do not contain stale visible version loading text', () => {
    KEY_PUBLIC_PAGES.forEach(page => {
      const html = readPublic(page);
      expect(html).not.toMatch(/Version:\s*loading/i);
      expect(html).not.toMatch(/Version:\s*<span[^>]*>loading/i);
    });
  });

  test('homepage keeps the controlled launch section and no fabricated names', () => {
    const html = readPublic('index.html');
    expect(html).toMatch(/EventFlow is opening|Early access/i);
    expect(html).not.toMatch(/What Our Customers Say/i);
    expect(html).not.toMatch(/Sarah\s*&(?:amp;)?\s*Tom/i);
    expect(html).not.toMatch(/James Wilson|Emma Davies/i);
  });

  test('/start keeps the public planner preload card', () => {
    const html = readPublic('start.html');
    expect(html).toContain('wizard-preload');
    expect(html).toContain('Plan your event in minutes');
    expect(html).toContain('Supplier categories to consider');
  });
});
