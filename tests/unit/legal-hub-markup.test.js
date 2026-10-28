'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const DOCUMENT_PAGES = [
  'public/legal.html',
  'public/terms.html',
  'public/privacy.html',
  'public/data-rights.html',
  'public/community-guidelines.html',
  'public/community-help.html',
  'scripts/generate-community-pages.mjs',
];

describe('legal document date and version line', () => {
  it.each(DOCUMENT_PAGES)('%s shows only the updated date and the version', file => {
    const source = read(file);
    expect(source).not.toMatch(/Last materially updated/);
    expect(source).not.toMatch(/Last reviewed/);
    expect(source).not.toMatch(/Effective date/);
    expect(source).not.toMatch(/_LAST_REVIEWED\}\}/);
  });

  it.each(DOCUMENT_PAGES)('%s pairs every updated placeholder with a version', file => {
    const source = read(file);
    const updated = [...source.matchAll(/\{\{(POLICY_\w+)_LAST_UPDATED\}\}/g)].map(m => m[1]);
    expect(updated.length).toBeGreaterThan(0);
    updated.forEach(prefix => {
      expect(source).toContain(`{{${prefix}_VERSION}}`);
    });
  });
});

describe('Legal Hub contents list', () => {
  const html = read('public/legal.html');
  const navStart = html.indexOf('<nav class="legal-toc"');
  const nav = html.slice(navStart, html.indexOf('</nav>', navStart));

  it('links every entry to a section and every section from the list', () => {
    const linked = [...nav.matchAll(/<a href="#([a-z0-9-]+)"/g)].map(m => m[1]);
    const sections = [...html.matchAll(/<section id="([a-z0-9-]+)" class="legal-section"/g)].map(
      m => m[1]
    );
    expect(linked).toEqual(sections);
  });

  it('keeps group labels out of the accessibility tree and out of the links', () => {
    const groups = [...nav.matchAll(/<li class="lh-toc-group"([^>]*)>/g)];
    expect(groups.length).toBeGreaterThan(2);
    groups.forEach(group => expect(group[1]).toContain('aria-hidden="true"'));
  });

  it('has no decorative emoji left in headings or the contents list', () => {
    expect(html).not.toContain('legal-toc-icon');
    expect(html).not.toMatch(/<h2[^>]*><span aria-hidden="true">/);
  });

  it('loads the Legal Hub stylesheet and script with a version', () => {
    expect(html).toMatch(/legal-hub\.css\?v=\d+\.\d+\.\d+/);
    expect(html).toMatch(/legal-hub\.js\?v=\d+\.\d+\.\d+/);
  });
});

describe('Privacy Notice tables', () => {
  it('wraps each wide table in a named, focusable scroll region', () => {
    const html = read('public/privacy.html');
    const tables = html.match(/<table/g) || [];
    const wrappers =
      html.match(/<div class="legal-table-wrap" role="region" aria-label="[^"]+" tabindex="0">/g) ||
      [];
    expect(tables.length).toBeGreaterThan(0);
    expect(wrappers).toHaveLength(tables.length);
  });
});
