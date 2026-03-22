/**
 * Admin Allowlist Drift Tests
 *
 * Ensures that:
 * 1. Every admin HTML file in public/ has a matching entry in the ADMIN_PAGES allowlist.
 * 2. Every entry in the ADMIN_PAGES allowlist has a corresponding HTML file on disk.
 * 3. Admin page JS files contain no native browser dialogs (alert/confirm/prompt).
 * 4. scripts/serve-static.js adminPages array includes all admin HTML files (E2E compat).
 *
 * ADMIN_PAGES is now derived from config/adminRegistry.js — see admin-registry.test.js
 * for deeper registry integrity tests.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const ADMIN_JS_PAGES_DIR = path.resolve(PUBLIC_DIR, 'assets/js/pages');
const SERVE_STATIC_FILE = path.resolve(__dirname, '../../scripts/serve-static.js');

// Load the allowlist from the registry (the single source of truth).
const { getAdminPagesAllowlist } = require('../../config/adminRegistry');

// ─── Allowlist Drift Tests ─────────────────────────────────────────────────

describe('Admin Pages Allowlist Sync', () => {
  const ADMIN_PAGES = getAdminPagesAllowlist();
  // Discover all admin HTML files in public/
  const adminHtmlFiles = fs
    .readdirSync(PUBLIC_DIR)
    .filter(f => f.startsWith('admin') && f.endsWith('.html'))
    .map(f => `/${f}`);

  it('every admin HTML file on disk should have an entry in ADMIN_PAGES', () => {
    const missing = adminHtmlFiles.filter(f => !ADMIN_PAGES.includes(f));
    expect(missing).toEqual([]);
    if (missing.length > 0) {
      throw new Error(
        `Admin HTML files exist on disk but are NOT in ADMIN_PAGES allowlist:\n  ${missing.join('\n  ')}`
      );
    }
  });

  it('every ADMIN_PAGES entry should exist on disk', () => {
    const extra = ADMIN_PAGES.filter(p => {
      const stripLeading = p.slice(1); // strip leading /
      // Clean URL entries (no .html) map to the corresponding .html file on disk
      const filePath = stripLeading.endsWith('.html')
        ? path.join(PUBLIC_DIR, stripLeading)
        : path.join(PUBLIC_DIR, `${stripLeading}.html`);
      return !fs.existsSync(filePath);
    });
    expect(extra).toEqual([]);
    if (extra.length > 0) {
      throw new Error(
        `ADMIN_PAGES allowlist contains entries with no corresponding file:\n  ${extra.join('\n  ')}`
      );
    }
  });

  it('ADMIN_PAGES should be a non-empty array', () => {
    expect(Array.isArray(ADMIN_PAGES)).toBe(true);
    expect(ADMIN_PAGES.length).toBeGreaterThan(0);
  });

  it('all ADMIN_PAGES entries should start with a forward slash', () => {
    const invalid = ADMIN_PAGES.filter(p => !p.startsWith('/'));
    expect(invalid).toEqual([]);
  });
});

// ─── serve-static.js Admin Pages Sync ─────────────────────────────────────
// Ensures the E2E static server serves every admin HTML page, preventing
// broken navigation in static-mode tests when new admin pages are added.

describe('serve-static.js Admin Pages Sync', () => {
  /**
   * Parse the adminPages array from serve-static.js without executing it.
   * Matches: const adminPages = [ 'name', ... ];
   */
  function parseServeStaticAdminPages() {
    const source = fs.readFileSync(SERVE_STATIC_FILE, 'utf8');
    const match = source.match(/const adminPages\s*=\s*\[([\s\S]*?)\];/);
    if (!match) {
      throw new Error('Could not locate adminPages array in scripts/serve-static.js');
    }
    return match[1]
      .split('\n')
      .map(line =>
        line
          .trim()
          .replace(/^['"]|['"],?$/g, '')
          .trim()
      )
      .filter(line => line.length > 0 && !line.startsWith('/'));
  }

  it('every admin HTML file on disk should be in serve-static adminPages', () => {
    const serveStaticPages = parseServeStaticAdminPages();
    const adminHtmlFiles = fs
      .readdirSync(PUBLIC_DIR)
      .filter(f => f.startsWith('admin') && f.endsWith('.html'))
      .map(f => f.replace(/\.html$/, ''));

    const missing = adminHtmlFiles.filter(f => !serveStaticPages.includes(f));
    expect(missing).toEqual([]);
    if (missing.length > 0) {
      throw new Error(
        `Admin HTML files not in serve-static.js adminPages (E2E gap):\n  ${missing.join('\n  ')}`
      );
    }
  });
});

// ─── Native Dialog Ban Tests ───────────────────────────────────────────────

describe('Admin Page JS - No Native Dialogs', () => {
  // Match native dialog function calls, using a simple heuristic:
  // word boundary before alert/confirm/prompt followed by (
  // Lines are pre-filtered to skip comments before this pattern is applied.
  const NATIVE_DIALOG_PATTERN = /\b(window\.)?(alert|confirm|prompt)\s*\(/;

  let adminJsFiles = [];
  try {
    adminJsFiles = fs
      .readdirSync(ADMIN_JS_PAGES_DIR)
      .filter(f => f.startsWith('admin') && f.endsWith('.js'))
      .map(f => path.join(ADMIN_JS_PAGES_DIR, f));
  } catch {
    // If directory doesn't exist, skip
  }

  adminJsFiles.forEach(filePath => {
    it(`${path.basename(filePath)} should not contain native dialog calls`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      const violations = [];
      lines.forEach((line, idx) => {
        // Skip comment lines and blank lines
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
          return;
        }
        // Skip lines that are part of admin helper definitions/calls
        if (/_adminConfirm|_adminToast|AdminShared\.show|AdminShared\.confirm/.test(line)) {
          return;
        }
        // Check for native dialog patterns
        if (NATIVE_DIALOG_PATTERN.test(line)) {
          violations.push(`  Line ${idx + 1}: ${line.trim()}`);
        }
      });

      if (violations.length > 0) {
        throw new Error(
          `Native dialog calls found in ${path.basename(filePath)}:\n${violations.join('\n')}`
        );
      }
    });
  });

  it('admin JS pages directory should contain init files', () => {
    expect(adminJsFiles.length).toBeGreaterThan(0);
  });
});
