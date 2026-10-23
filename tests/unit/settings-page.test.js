/**
 * The settings page (/settings), as source. The behaviour is covered in a real browser by
 * e2e/settings-page.spec.js; these pin the structural choices that behaviour depends on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const html = read('public/settings.html');
const js = read('public/assets/js/pages/settings-init.js');
const css = read('public/assets/css/settings.css');

describe('the old app.js settings code is gone, and cached copies of it cannot reach this page', () => {
  test('app.js no longer contains initSettings', () => {
    const appJs = read('public/assets/js/app.js');
    expect(appJs).not.toContain('initSettings');
    expect(appJs).not.toContain('Unable to load settings.');
  });

  test('the page keeps a tag other than "settings", which a cached older app.js would act on', () => {
    expect(html).toMatch(/<meta name="ef-page" content="account_settings">/);
    expect(html).not.toMatch(/<meta name="ef-page" content="settings">/);
  });
});

describe('confirmations are native dialogs', () => {
  test.each(['delete-account-modal', 'remove-photo-dialog', 'downgrade-dialog'])(
    '#%s is a <dialog> opened with showModal()',
    id => {
      expect(html).toMatch(new RegExp(`<dialog id="${id}"`));
      expect(js).toContain(`byId('${id}')`);
    }
  );

  test('nothing falls back to confirm() or the shared Modal class', () => {
    expect(js).not.toMatch(/\bconfirm\(/);
    expect(js).not.toMatch(/new Modal\(/);
  });
});

describe('the markup', () => {
  test('has no inline <style> block: the styles live in settings.css', () => {
    expect(html).not.toMatch(/<style[\s>]/);
  });

  test('the photo upload is a button, not a label for a display:none input', () => {
    expect(html).toContain('<button type="button" id="avatar-upload-btn"');
    expect(html).not.toMatch(/<label[^>]*for="avatar-upload-input"/);
  });

  test('the unverified notice starts hidden', () => {
    expect(html).toMatch(/id="email-unverified-notice"[^>]*\shidden/);
  });

  test('the email address is read-only, because nothing on the server changes it', () => {
    expect(html).toMatch(/<input[^>]*id="profile-email"[^>]*\sreadonly/);
    expect(html).toContain('id="profile-email-help"');
    expect(js).not.toMatch(/formData\s*=\s*\{[^}]*email/);
  });

  test('the Restart Tour card is gone: there is no tour for it to restart', () => {
    expect(html).not.toContain('restart-tour');
    expect(js).not.toContain('ef_homepage_tour_completed');
  });
});

describe('the script', () => {
  test('status colours come from the stylesheet, never inline', () => {
    expect(js).not.toMatch(/\.style\.color\s*=/);
    expect(css).toMatch(/\[data-state=["']success["']\][^{]*\{\s*color:\s*var\(--st-ok\)/);
    expect(css).toMatch(/\[data-state=["']error["']\][^{]*\{\s*color:\s*var\(--st-danger\)/);
  });

  test('the newsletter request uses the saved address', () => {
    expect(js).toMatch(/body: \{ email: _userEmail \}/);
    expect(js).not.toMatch(/getElementById\('profile-email'\)\?\.value \|\| ''/);
  });

  test('the password rule is the server rule: a letter and a number', () => {
    expect(js).toMatch(/\/\[A-Za-z\]\/\.test\(pw\) && \/\[0-9\]\/\.test\(pw\)/);
  });

  test('the account is read from /api/profile, which includes the phone number', () => {
    expect(js).toContain("fetch('/api/profile'");
    expect(js).not.toContain("fetch('/api/v1/auth/me'");
  });

  test('a plain-text error body (e.g. the rate limiter) is shown, not swallowed', () => {
    expect(js).toContain("type.includes('text/')");
  });

  test('one /api/me/settings request feeds every preference', () => {
    expect(js.match(/fetch\('\/api\/me\/settings'/g)).toHaveLength(1);
  });
});

describe('the page looks like the dashboards', () => {
  const customerCss = read('public/assets/css/customer-dashboard-home.css');
  const supplierCss = read('public/assets/css/supplier-dashboard-home.css');
  const token = (source, name) => source.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

  // The settings tokens are copies of the dashboards' own, so a change to the dashboards' palette
  // shows up here as a failing test instead of a page that quietly drifts.
  test.each([
    ['bg', 'bg'],
    ['surface', 'surface'],
    ['ink', 'ink'],
    ['ink-2', 'ink-2'],
    ['muted', 'muted'],
    ['line', 'line'],
    ['line-soft', 'line-soft'],
    ['line-strong', 'line-strong'],
    ['accent', 'accent'],
    ['accent-hover', 'accent-hover'],
    ['accent-deep', 'accent-deep'],
    ['accent-soft', 'accent-soft'],
    ['accent-line', 'accent-line'],
    ['danger', 'danger'],
    ['warn', 'warn'],
    ['radius', 'radius'],
    ['radius-sm', 'radius-sm'],
  ])('--st-%s matches the dashboards', name => {
    const value = token(css, `st-${name}`);
    expect(value).toBeTruthy();
    expect(value).toBe(token(customerCss, `cdh-${name}`));
    expect(value).toBe(token(supplierCss, `sdh-${name}`));
  });

  test('the body carries the page class that sets the warm background', () => {
    expect(html).toMatch(/<body class="settings-body">/);
    expect(css).toMatch(/\.settings-body\s*\{[^}]*background:\s*var\(--st-bg\)/);
  });

  test("cards, buttons and fields use the dashboards' shapes, not the old site classes", () => {
    expect(html).not.toMatch(/class="card[\s"]/);
    expect(html).not.toMatch(/class="(?:[^"]*\s)?cta[\s"]/);
    expect(html).toContain('class="settings-card"');
    expect(html).toContain('settings-btn--primary');
    expect(css).toMatch(/\.settings-card\s*\{[^}]*border-radius:\s*var\(--st-radius\)/);
  });

  test('the hero links back to the dashboard that matches the account', () => {
    expect(html).toContain('id="settings-dashboard-link"');
    expect(js).toContain("customer: '/dashboard/customer'");
    expect(js).toContain("supplier: '/dashboard/supplier'");
  });

  test('no emoji or gradient decoration is left in the page', () => {
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(css).not.toMatch(/linear-gradient\((?!90deg, #efede8)/);
  });
});

describe('links from other pages land on something', () => {
  const fs = require('fs');
  const walk = dir =>
    fs.readdirSync(path.join(__dirname, '../..', dir), { withFileTypes: true }).flatMap(entry => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return rel.includes('node_modules') ? [] : walk(rel);
      }
      return /\.(html|js)$/.test(entry.name) ? [rel] : [];
    });

  test('every /settings#fragment on the site names an id on this page, or one the script maps', () => {
    const fragments = new Set();
    for (const file of [
      ...walk('public/assets/js'),
      ...fs
        .readdirSync(path.join(__dirname, '../../public'))
        .filter(f => f.endsWith('.html'))
        .map(f => `public/${f}`),
    ]) {
      for (const match of read(file).matchAll(/\/settings(?:\.html)?#([a-z][\w-]*)/g)) {
        fragments.add(match[1]);
      }
    }
    expect(fragments.size).toBeGreaterThan(0);
    for (const fragment of fragments) {
      const mapped = js.match(new RegExp(`'${fragment}':\\s*'([^']+)'`))?.[1];
      expect(html).toContain(`id="${mapped || fragment}"`);
    }
  });

  test('the script scrolls to a fragment once its target has been drawn', () => {
    expect(js).toContain('function scrollToLinkedSection');
    expect(js).toContain("'verify-email': 'email-unverified-notice'");
  });
});

describe('the stylesheet', () => {
  test('is only for this page and carries no dead rules from removed features', () => {
    for (const dead of ['settings-beta-badge', 'settings-tag-btn', 'settings-progress-bar']) {
      expect(css).not.toContain(dead);
    }
  });

  test('every red used for text is the AA shade', () => {
    expect(css).not.toMatch(/color:\s*#(?:ef4444|dc2626)/i);
  });
});
