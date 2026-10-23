'use strict';

/**
 * The signed-in header is drawn before the server has answered (utils/auth-hint.js, the
 * .ef-hint-in rules in navbar.css, and navbar.js keeping the hint up to date). The browser
 * behaviour is covered by e2e/navbar-auth-hint.spec.js; this guards the wiring that the browser
 * test cannot see page by page: a page that loads navbar.js but not the early script would go back
 * to flashing "Log in", and two pages on different versions of the same asset would behave
 * differently for as long as a cache holds the old one.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'vendor' ? [] : htmlFiles(full);
    }
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const pages = htmlFiles(PUBLIC)
  .map(file => ({ file: path.relative(ROOT, file), html: fs.readFileSync(file, 'utf8') }))
  .filter(page => /\/assets\/js\/navbar\.js/.test(page.html));

const versionOf = (html, asset) => {
  const match = html.match(new RegExp(`${asset.replace(/\./g, '\\.')}\\?v=([\\w.]+)`));
  return match ? match[1] : null;
};

describe('pages that load the public navbar', () => {
  test('there are pages to check', () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  test.each(pages.map(page => [page.file, page.html]))(
    '%s loads auth-hint.js from <head>, synchronously, before navbar.css',
    (_file, html) => {
      const head = html.slice(0, html.search(/<\/head>/i));
      const tag = head.match(/<script\b[^>]*\/assets\/js\/utils\/auth-hint\.js[^>]*>/);
      expect(tag).not.toBeNull();
      // A deferred or async script would run after the first paint, which is the point of it.
      expect(tag[0]).not.toMatch(/\b(defer|async|type="module")\b/);
      const cssAt = head.search(/<link\b[^>]*\/assets\/css\/navbar\.css/);
      expect(cssAt).toBeGreaterThan(-1);
      expect(head.indexOf(tag[0])).toBeLessThan(cssAt);
    }
  );

  test('every page uses the same version of navbar.js, navbar.css and auth-hint.js', () => {
    const versions = asset => new Set(pages.map(page => versionOf(page.html, asset)));
    expect(versions('/assets/js/navbar.js')).toEqual(new Set(['1.3.0']));
    expect(versions('/assets/css/navbar.css')).toEqual(new Set(['18.5.0']));
    expect(versions('/assets/js/utils/auth-hint.js')).toEqual(new Set(['1.0.0']));
  });
});

describe('the pieces agree with each other', () => {
  const hintScript = read('public/assets/js/utils/auth-hint.js');
  const navbar = read('public/assets/js/navbar.js');
  const css = read('public/assets/css/navbar.css');

  test('the script and navbar.js use the same storage key and the same roles', () => {
    expect(hintScript).toContain("'ef_auth_hint'");
    expect(navbar).toContain("const AUTH_HINT_KEY = 'ef_auth_hint'");
    expect(hintScript).toMatch(/role === 'customer' \|\| role === 'supplier'/);
    expect(navbar).toContain("const HINT_ROLES = ['customer', 'supplier']");
  });

  test('the early script is small, synchronous and makes no requests', () => {
    const code = hintScript.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(Buffer.byteLength(code)).toBeLessThan(700);
    expect(code).not.toMatch(/\b(fetch|XMLHttpRequest|import|await|setTimeout)\b/);
    // It only ever marks <html>; it never decides what anyone may do.
    expect(code).toContain("classList.add('ef-hint-in')");
  });

  test('navbar.js settles the header: it drops the early state, saves or forgets the hint', () => {
    expect(navbar).toContain("classList.remove('ef-hint-in')");
    expect(navbar).toContain('saveAuthHint(user)');
    expect(navbar).toContain('localStorage.removeItem(AUTH_HINT_KEY)');
    expect(navbar).toContain('updateAuthUI({ role: hintedRole, hint: true })');
  });

  test('a hinted header is never saved as if the server had said so', () => {
    // The stand-in user carries hint: true, which must skip the save and keep the early state.
    expect(navbar).toMatch(/if \(!user\?\.hint\) \{[\s\S]*?saveAuthHint\(user\);/);
  });

  test('navbar.css hides "Log in", reserves the signed-in actions and mirrors the nav rules', () => {
    expect(css).toMatch(/html\.ef-hint-in #ef-auth-link \{\s*display: none !important;/);
    expect(css).toMatch(
      /@media \(min-width: 1280px\) \{\s*[^}]*html\.ef-hint-in \.ef-header-actions \{\s*justify-content: flex-end;\s*min-width: 302\.28px;/
    );
    expect(css).toMatch(
      /@media \(max-width: 1279px\) \{\s*html\.ef-hint-in \.ef-nav-desktop \{\s*display: none;/
    );
    expect(css).toContain('html.ef-hint-in .ef-bottom-nav');
  });

  test('the loading of the CSRF token no longer holds up the header', () => {
    // It used to be awaited before the auth check, so the header waited for two requests in a row.
    expect(navbar).not.toMatch(
      /await initCsrfToken\(\);\s*\n\s*\n\s*\/\/ Setup auth state listener/
    );
    expect(navbar).toMatch(/\n\s+initCsrfToken\(\);\n/);
  });
});
