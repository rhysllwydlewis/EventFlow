/**
 * The Photos page (/gallery), as source. The behaviour is covered in jsdom by
 * gallery-page-behaviour.test.js and in a real browser by e2e/gallery-page.spec.js; these pin the
 * structural choices that behaviour and the look depend on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const html = read('public/gallery.html');
const js = read('public/assets/js/pages/gallery-init.js');
// The code without its comments, for rules about what the script does rather than what it says.
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = read('public/assets/css/gallery.css');

describe('the page looks like the dashboards', () => {
  const customerCss = read('public/assets/css/customer-dashboard-home.css');
  const supplierCss = read('public/assets/css/supplier-dashboard-home.css');
  const token = (source, name) => source.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

  // The gallery tokens are copies of the dashboards' own, so a change to the dashboards' palette
  // shows up here as a failing test instead of a page that quietly drifts.
  test.each([
    'bg',
    'surface',
    'ink',
    'ink-2',
    'muted',
    'line',
    'line-soft',
    'line-strong',
    'accent',
    'accent-hover',
    'accent-deep',
    'accent-soft',
    'accent-line',
    'danger',
    'warn',
    'radius',
    'radius-sm',
  ])('--gl-%s matches the dashboards', name => {
    const value = token(css, `gl-${name}`);
    expect(value).toBeTruthy();
    expect(value).toBe(token(customerCss, `cdh-${name}`));
    expect(value).toBe(token(supplierCss, `sdh-${name}`));
  });

  test('the body carries the page class that sets the warm background', () => {
    expect(html).toMatch(/<body class="gallery-body">/);
    expect(css).toMatch(/\.gallery-body\s*\{[^}]*background:\s*var\(--gl-bg\)/);
  });

  test("cards, buttons and fields use the dashboards' shapes, not the old site classes", () => {
    expect(html).not.toMatch(
      /class="(?:[^"]*\s)?(?:cta|btn|card|modal|radio-card|upload-area)[\s"]/
    );
    expect(html).toContain('class="gallery-card');
    expect(html).toContain('gallery-btn--primary');
    expect(css).toMatch(/\.gallery-card\s*\{[^}]*border-radius:\s*var\(--gl-radius\)/);
  });

  test('no emoji or gradient decoration is left in the page', () => {
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2B06}\u{23F3}]/u);
    expect(js).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2B06}\u{23F3}]/u);
    expect(css).not.toMatch(/linear-gradient\((?!90deg, #efede8)/);
  });

  test('the hero links back to the dashboard that matches the account', () => {
    expect(html).toContain('id="gallery-dashboard-link"');
    expect(js).toContain("customer: '/dashboard/customer'");
    expect(js).toContain("supplier: '/dashboard/supplier'");
  });

  test('the stylesheet is only for this page: it keeps none of the old page’s rules', () => {
    for (const old of [
      '.lightbox-nav',
      '.radio-card',
      '.upload-dropzone',
      '.modal-overlay',
      '.gallery-item',
    ]) {
      expect(css).not.toContain(old);
    }
    expect(html).not.toContain('supplier-dashboard-improvements.css');
    expect(html).not.toContain('liquid-glass.css');
  });

  test('every red used for text is the AA shade', () => {
    expect(css).not.toMatch(/color:\s*#(?:ef4444|dc2626)/i);
  });

  test('no inline <style> block: the styles live in gallery.css', () => {
    expect(html).not.toMatch(/<style[\s>]/);
  });
});

describe('the markup', () => {
  test('the dialogs are native <dialog> elements with names', () => {
    expect(html).toMatch(
      /<dialog[^>]*id="gallery-delete-dialog"[^>]*aria-labelledby="gallery-delete-title"/
    );
    expect(html).toMatch(/<dialog[^>]*id="gallery-lightbox"[^>]*aria-label="Photo viewer"/);
  });

  test('choosing photos is a real button, and the file input stays reachable by script only', () => {
    expect(html).toMatch(/<button[^>]*id="gallery-browse"/);
    expect(html).toMatch(/<input[^>]*id="gallery-file-input"[^>]*tabindex="-1"/);
    expect(html).toMatch(/<input[^>]*id="gallery-file-input"[^>]*aria-label=/);
  });

  test('status lines are live regions, and the upload progress is a progressbar', () => {
    expect(html).toMatch(/id="gallery-upload-status"[^>]*role="status"/);
    expect(html).toMatch(/id="gallery-photos-status"[^>]*role="status"/);
    expect(html).toMatch(/id="gallery-progress"[^>]*role="progressbar"/);
    expect(html).toMatch(/id="gallery-error"[^>]*role="alert"/);
  });

  test('the page keeps the scripts that every signed-in page loads for error tracking', () => {
    expect(html).toContain('global-error-handler.js');
    expect(html).toContain('sentry-browser-init.js');
  });

  test('the script and stylesheet are versioned, so cached copies cannot run against new markup', () => {
    expect(html).toMatch(/gallery\.css\?v=\d+\.\d+\.\d+/);
    expect(html).toMatch(/gallery-init\.js\?v=\d+\.\d+\.\d+/);
  });
});

describe('the script', () => {
  test('reports everything on the page: no alert(), confirm() or prompt()', () => {
    expect(code).not.toMatch(/\b(?:alert|confirm|prompt)\(/);
  });

  test('every write carries the CSRF token, from the endpoint that exists', () => {
    expect(js).toContain("'X-CSRF-Token'");
    expect(js).toContain("api('/api/csrf-token')");
    // The old page asked an endpoint that does not exist, and sent the upload with no token at all.
    expect(js).not.toContain('/api/auth/csrf');
    expect(js).toMatch(/request\.setRequestHeader\('X-CSRF-Token', token\)/);
  });

  test('a refused CSRF token is replaced once, for writes (deletes) and for uploads', () => {
    expect(code.match(/isCsrfRefusal\(/g)).toHaveLength(2);
    expect(code).toMatch(/await write\(\s*`\/api\/me\/suppliers/);
    expect(code).toMatch(/await write\(\s*`\/api\/me\/packages/);
  });

  test('status colours come from the stylesheet (data-state), never inline', () => {
    expect(js).not.toMatch(/style\.color|style\.background/);
  });

  test('page content is built with text nodes, not by pasting data into HTML', () => {
    // The one innerHTML is a fixed icon with no data in it.
    expect(js.match(/innerHTML/g)).toHaveLength(1);
    expect(js).toContain("remove.innerHTML =\n        '<svg");
  });

  test('both address forms are understood: id, and the older supplierId', () => {
    expect(js).toContain("params.get('id') || params.get('supplierId')");
  });
});

describe('links from other pages land on this page’s contract', () => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(__dirname, '../..', dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['vendor', 'node_modules'].includes(entry.name)) {
          walk(rel);
        }
      } else if (/\.(html|js)$/.test(entry.name)) {
        files.push(rel);
      }
    }
  };
  walk('public');

  test('every /gallery?... link on the site names a type this page knows and an id', () => {
    const found = [];
    for (const rel of files) {
      for (const match of read(rel).matchAll(/\/gallery\?[^"'`\s)]*/g)) {
        found.push({ rel, link: match[0] });
      }
    }
    expect(found.length).toBeGreaterThan(0);
    for (const { link } of found) {
      expect(link).toMatch(/^\/gallery\?type=(supplier|package)&id=/);
    }
  });
});
