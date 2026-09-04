/**
 * Every guide article carries its own copy of the site header, the mobile
 * bottom navigation and the footer. Nothing enforced that the 34 copies stayed
 * in step, and they did not: six different headers, two bottom navigations and
 * seven footers, and not one of the 34 had the Events or Community links that
 * index.html, guides.html, suppliers.html and pricing.html have all carried for
 * months. Nothing was broken, so nobody saw it.
 *
 * `scripts/generate-article-shells.mjs` now owns those three blocks and the
 * output is committed. `--check` regenerates in memory and compares, so drift
 * fails here instead of shipping.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-article-shells.mjs');
const ARTICLES = path.join(ROOT, 'public/articles');

/**
 * Read every committed article.
 * @returns {Array<{name: string, html: string}>} The articles.
 */
function articles() {
  return fs
    .readdirSync(ARTICLES)
    .filter(name => name.endsWith('.html'))
    .sort()
    .map(name => ({ name, html: fs.readFileSync(path.join(ARTICLES, name), 'utf8') }));
}

/**
 * Extract one chrome block from a page.
 * @param {string} html The page source.
 * @param {RegExp} pattern The block pattern.
 * @returns {string|null} The block, or null when absent.
 */
function block(html, pattern) {
  const match = html.match(pattern);
  return match ? match[0] : null;
}

const HEADER = /<header class="ef-header"[\s\S]*?<\/header>/;
const BOTTOM_NAV = /<nav aria-label="Mobile bottom navigation"[\s\S]*?<\/nav>/;
const FOOTER = /<footer class="footer"[\s\S]*?<\/footer>/;

describe('the committed article shells match their template', () => {
  it('reports no drift', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync('node', [GENERATOR, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failed = true;
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }
    expect(failed ? output : '').toBe('');
    expect(output).toContain('match the template');
  });

  it('does not write anything in --check mode', () => {
    const target = path.join(ARTICLES, 'event-travel-costs-guide.html');
    const before = fs.readFileSync(target, 'utf8');
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
  });
});

describe('every article ships one and the same chrome', () => {
  const all = articles();

  it('has articles to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each([
    ['site header', HEADER],
    ['mobile bottom navigation', BOTTOM_NAV],
    ['footer', FOOTER],
  ])('%s is byte-identical across all articles', (_name, pattern) => {
    const variants = new Map();
    for (const article of all) {
      const markup = block(article.html, pattern);
      expect(markup).not.toBeNull();
      if (!variants.has(markup)) {
        variants.set(markup, []);
      }
      variants.get(markup).push(article.name);
    }
    // On failure, name the odd files out rather than dumping two blobs of HTML.
    const groups = [...variants.values()].sort((a, b) => b.length - a.length);
    expect(groups.slice(1).flat()).toEqual([]);
  });
});

describe('article navigation matches the rest of the site', () => {
  const all = articles();
  const canonical = fs.readFileSync(path.join(ROOT, 'public/guides.html'), 'utf8');

  it('uses the header from guides.html verbatim', () => {
    // The generator reads it from there; this states the contract so a future
    // reader knows the drift check above is comparing against a live page.
    const expected = block(canonical, HEADER);
    expect(expected).not.toBeNull();
    for (const article of all) {
      expect(block(article.html, HEADER)).toBe(expected);
    }
  });

  it.each(['/public-calendar', '/community', '/pricing', '/for-suppliers', '/faq'])(
    'links to %s from every article',
    href => {
      const missing = all.filter(a => !a.html.includes(`href="${href}"`)).map(a => a.name);
      expect(missing).toEqual([]);
    }
  );

  it('does not leave a version label no article script can fill', () => {
    // `#ef-version-label` is only ever populated by admin-shared.js and
    // home-init.js. No article loads either, so the block read
    // "Version: loading…" on every guide until the footer was regenerated.
    const stuck = all.filter(a => a.html.includes('ef-version-label')).map(a => a.name);
    expect(stuck).toEqual([]);
  });
});

/**
 * Call one export of the ESM chrome module in a subprocess.
 *
 * Jest runs this suite as CommonJS with no ESM support, and the module under
 * test is ESM, so the boundary is crossed the same way the rest of this file
 * crosses it: by shelling out.
 * @param {string} script The body to run; the module is bound to `chrome`.
 * @returns {{ok: boolean, value: *, error: string}} The outcome.
 */
function inChromeModule(script) {
  const source = `
    import * as chrome from ${JSON.stringify(path.join(ROOT, 'scripts/lib/article-chrome.mjs'))};
    try {
      const value = (() => { ${script} })();
      process.stdout.write(JSON.stringify({ ok: true, value }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    }
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
    })
  );
}

describe('notification dropdown', () => {
  const CANONICAL_OPEN =
    '<div id="notification-dropdown" class="notification-dropdown" hidden aria-hidden="true" style="display: none;">';

  test.each(articles().map(article => [article.name, article.html]))(
    '%s carries exactly one dropdown, in the canonical shape',
    (_name, html) => {
      expect((html.match(/id="notification-dropdown"/g) || []).length).toBe(1);
      expect(html).toContain(CANONICAL_OPEN);
    }
  );

  test.each(articles().map(article => [article.name, article.html]))(
    '%s makes the mark-all control a real button',
    (_name, html) => {
      // Both shapes the articles used to ship omitted type="button".
      expect(html).toContain(
        '<button class="notification-mark-all" id="notification-mark-all-read" type="button">'
      );
    }
  );

  test.each(articles().map(article => [article.name, article.html]))(
    '%s places the dropdown right after the header, next to the bell',
    (_name, html) => {
      const headerEnd = html.indexOf('</header>') + '</header>'.length;
      // Only the labelling comment may sit between the two.
      expect(html.slice(headerEnd, headerEnd + 200)).toContain('<div id="notification-dropdown"');
      expect(html.slice(headerEnd, html.indexOf('<div id="notification-dropdown"'))).toMatch(
        /^\s*(<!--[\s\S]*?-->\s*)?$/
      );
    }
  );

  test('the finder walks div depth rather than stopping at the first close', () => {
    // A pattern anchored on the opening tag and closed non-greedily stops four
    // levels early here, which would have deleted the rest of every article.
    const page = [
      '<p>before</p>',
      '<div id="notification-dropdown" class="notification-dropdown">',
      '<div class="notification-header"><h3>Notifications</h3></div>',
      '<div class="notification-list"></div>',
      '</div>',
      '<p>after</p>',
    ].join('\n');

    const result = inChromeModule(
      `const page = ${JSON.stringify(page)};
       const span = chrome.findNotificationDropdown(page, 'test.html');
       return { block: page.slice(span.start, span.end), after: page.slice(span.end) };`
    );

    expect(result.ok).toBe(true);
    expect(result.value.block).toContain('notification-list');
    expect(result.value.block.endsWith('</div>')).toBe(true);
    expect(result.value.after).toBe('\n<p>after</p>');
  });

  test('the finder skips commented-out markup instead of running off the end', () => {
    // A <div> inside a comment would raise the depth and never come back down,
    // and the scanner would swallow the rest of the document.
    const page = [
      '<div id="notification-dropdown">',
      '<!-- <div>an older layout</div> -->',
      '<div class="notification-list"></div>',
      '</div>',
      '<p>after</p>',
    ].join('\n');

    const result = inChromeModule(
      `const page = ${JSON.stringify(
        '<div id="notification-dropdown">\n<!-- <div>an older layout</div> -->\n<div class="notification-list"></div>\n</div>\n<p>after</p>'
      )};
       const span = chrome.findNotificationDropdown(page, 'test.html');
       return page.slice(span.end);`
    );

    expect(page).toContain('an older layout');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('\n<p>after</p>');
  });

  test('the finder refuses a page with two dropdowns rather than guessing', () => {
    const result = inChromeModule(
      `return chrome.findNotificationDropdown(
         '<div id="notification-dropdown"></div><div id="notification-dropdown"></div>',
         'test.html'
       );`
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/more than one/);
  });

  test('the finder refuses an unclosed dropdown rather than truncating', () => {
    const result = inChromeModule(
      `return chrome.findNotificationDropdown(
         '<div id="notification-dropdown"><div></div>',
         'test.html'
       );`
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/never closed/);
  });

  test('a page without a dropdown gains one instead of being left to the JS fallback', () => {
    const result = inChromeModule(
      `const page = '<header class="ef-header"></header>\\n<main></main>';
       return chrome.applyNotificationDropdown(page, 'test.html');`
    );
    expect(result.ok).toBe(true);
    expect(result.value).toContain('<div id="notification-dropdown"');
    expect(result.value.indexOf('<div id="notification-dropdown"')).toBeGreaterThan(
      result.value.indexOf('</header>')
    );
    expect(result.value.indexOf('<div id="notification-dropdown"')).toBeLessThan(
      result.value.indexOf('<main>')
    );
  });
});

describe('header scripts', () => {
  test.each(articles().map(article => [article.name, article.html]))(
    '%s loads notifications.js, so the header bell actually opens something',
    (_name, html) => {
      // Every article renders the bell. None of the 34 loaded the script behind
      // it, so on an article it was a control that did nothing at all.
      expect(html).toContain('<script defer="" src="/assets/js/notifications.js"></script>');
    }
  );

  test.each(articles().map(article => [article.name, article.html]))(
    '%s does not load websocket-client.js, which nothing on an article reads',
    (_name, html) => {
      // It only defines window.WebSocketClient; notifications.js loads socket.io
      // itself, and nothing an article loads constructs one.
      expect(html).not.toContain('websocket-client.js');
    }
  );

  test.each(articles().map(article => [article.name, article.html]))(
    '%s loads the header scripts in one run, in order',
    (_name, html) => {
      const run = [
        '<script defer="" src="/assets/js/utils/auth-state.js"></script>',
        '<script defer="" src="/assets/js/burger-menu.js"></script>',
        '<script defer="" src="/assets/js/navbar.js"></script>',
        '<script defer="" src="/assets/js/notifications.js"></script>',
      ].join('\n');
      expect(html).toContain(run);
    }
  );

  test('the applier refuses a page that loads them in two places', () => {
    const result = inChromeModule(
      `const page = '<script src="/assets/js/navbar.js"></script>\\n<p>x</p>\\n' +
                   '<script src="/assets/js/navbar.js"></script>';
       return chrome.applyHeaderScripts(page, 'test.html');`
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/in 2 places/);
  });

  test('the applier refuses a page with no run rather than inventing a place for it', () => {
    const result = inChromeModule(
      `return chrome.applyHeaderScripts('<p>nothing here</p>', 'test.html');`
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no header script run/);
  });

  test('the applier keeps the whitespace that followed the run', () => {
    const result = inChromeModule(
      `return chrome.applyHeaderScripts(
         '<script src="/assets/js/navbar.js"></script>\\n<p>after</p>',
         'test.html'
       );`
    );
    expect(result.ok).toBe(true);
    expect(result.value.endsWith('</script>\n<p>after</p>')).toBe(true);
  });
});
