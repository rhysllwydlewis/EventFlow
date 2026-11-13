/**
 * Reviews, Photos and Reports became tabs of one Moderation page, and Payments became a tab of
 * Analytics. These checks keep the pages well formed (no clashing ids, every tab has a panel,
 * the old pages are gone) and the buttons free of emoji.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = file => fs.existsSync(path.join(ROOT, file));

const ids = html => [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B07}]/u;

describe.each([
  ['public/admin-moderation.html', ['reviews', 'photos', 'reports']],
  ['public/admin-analytics.html', ['overview', 'payments']],
])('%s', (file, tabs) => {
  const html = read(file);

  test.each(tabs)('has a tab button and a panel for %s', name => {
    expect(html).toContain(`id="tab-${name}"`);
    expect(html).toContain(`id="panel-${name}"`);
  });

  test('no id is used twice', () => {
    const all = ids(html);
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  test('buttons and headings carry no emoji', () => {
    const labels = [...html.matchAll(/<(?:button|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:button|h[1-6])>/g)];
    for (const [, text] of labels) {
      expect(text).not.toMatch(EMOJI);
    }
  });
});

describe('the merged pages are gone', () => {
  test.each([
    'public/admin-reviews.html',
    'public/admin-photos.html',
    'public/admin-reports.html',
    'public/admin-payments.html',
  ])('%s no longer exists', file => {
    expect(exists(file)).toBe(false);
  });
});

describe('tab scripts start lazily', () => {
  test.each([
    ['admin-reviews-init.js', 'AdminReviews'],
    ['admin-photos-init.js', 'AdminPhotos'],
    ['admin-reports-init.js', 'AdminReports'],
    ['admin-payments-init.js', 'AdminPayments'],
  ])('%s exposes %s.start', (file, name) => {
    expect(read(`public/assets/js/pages/${file}`)).toMatch(
      new RegExp(`window\\.${name} = \\{\\s*start`)
    );
  });

  test('Moderation starts each tab only when it is shown', () => {
    const source = read('public/assets/js/pages/admin-moderation-init.js');
    for (const name of ['AdminReviews', 'AdminPhotos', 'AdminReports']) {
      expect(source).toContain(name);
    }
  });
});

describe('the behaviour-analytics section is live and sits in the Overview tab', () => {
  test('the server still injects it into the Analytics page', () => {
    expect(read('utils/template-renderer.js')).toContain('admin-behaviour-analytics.js');
  });

  test('it is placed inside the Overview panel when tabs are present', () => {
    expect(read('public/assets/js/pages/admin-behaviour-analytics.js')).toContain('panel-overview');
  });
});

describe('admin screens use line icons and plain text, not colour emoji', () => {
  const COLOUR_EMOJI = /[\p{Emoji_Presentation}\uFE0F]/u;
  // Category icons on the homepage editor are chosen by the admin, so they are data, not styling.
  const ALLOWED = new Set([
    'admin-homepage-init.js',
    'admin-homepage-rebuild.js',
    'admin-homepage-manager.js',
  ]);

  const codeLines = file =>
    read(file)
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line));

  test('admin pages and their scripts carry no colour emoji in markup or strings', () => {
    const files = [
      ...fs
        .readdirSync(path.join(ROOT, 'public'))
        .filter(f => /^admin-.*\.html$/.test(f))
        .map(f => `public/${f}`),
      ...fs
        .readdirSync(path.join(ROOT, 'public/assets/js/pages'))
        .filter(f => /^admin-.*\.js$/.test(f) && !ALLOWED.has(f))
        .map(f => `public/assets/js/pages/${f}`),
      'public/assets/js/admin-shared.js',
      'public/assets/js/admin-navbar.js',
    ];
    const offenders = [];
    for (const file of files) {
      codeLines(file).forEach(line => {
        if (COLOUR_EMOJI.test(line)) {
          offenders.push(`${file}: ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every Quick Nav tile and group has a line icon that exists', () => {
    const source = read('public/assets/js/admin-navbar.js');
    const defined = new Set([...source.matchAll(/^\s{4}(\w+): '<[^\n]*',$/gm)].map(m => m[1]));
    const used = [...source.matchAll(/icon: '(\w+)'/g)].map(m => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(30);
    expect(used.filter(name => !defined.has(name))).toEqual([]);
  });

  test('page content fills the same width as the page header', () => {
    const css = read('public/assets/css/admin-workspace.css');
    expect(css).toMatch(
      /main\.section > \.container,[\s\S]*?\[role="tabpanel"\] > \.container \{[^}]*max-width: none/
    );
  });
});
