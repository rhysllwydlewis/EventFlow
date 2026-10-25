/**
 * Admin dashboard (/admin) audit fixes: the management-card counts that were invisible, the
 * message-moderation panel that could wait forever, the dashboard's own request helper, and the
 * System Analytics rows. The message panel is run under jsdom; the rest is checked in the source.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('management-card counts are visible', () => {
  const refresh = read('public/assets/css/admin-dashboard-refresh.css');

  test('styles.css hides .stat-item until a script adds .is-visible', () => {
    // The reason the override below exists. If this stops being true the override can go.
    expect(read('public/assets/css/styles.css')).toMatch(/\.stat-item\s*\{[^}]*opacity:\s*0/);
  });

  test('the admin dashboard shows .stat-item without waiting for .is-visible', () => {
    const rule = refresh.match(/\.admin-dashboard-page \.stat-item\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/opacity:\s*1/);
    expect(rule[1]).toMatch(/transform:\s*none/);
  });

  test('nothing on the dashboard adds .is-visible to .stat-item', () => {
    const scripts = [
      'public/assets/js/pages/admin-init.js',
      'public/assets/js/admin-features.js',
      'public/assets/js/admin-shared.js',
    ].map(read);
    for (const source of scripts) {
      expect(source).not.toMatch(/stat-item[^\n]*is-visible|is-visible[^\n]*stat-item/);
    }
  });

  test('admin.html loads the changed assets under new versions', () => {
    const html = read('public/admin.html');
    expect(html).toContain('admin-dashboard-refresh.css?v=2');
    expect(html).toContain('pages/admin-init.js?v=18.5.3');
    expect(html).toContain('admin-messages-init.js?v=18.3.1');
  });
});

describe('the dashboard request helper', () => {
  const init = read('public/assets/js/pages/admin-init.js');

  test('goes through AdminShared.fetchWithTimeout so a silent server ends in an error', () => {
    expect(init).toMatch(/AdminShared\.fetchWithTimeout\(url, opts, API_TIMEOUT_MS\)/);
    expect(init).toMatch(/const API_TIMEOUT_MS = \d+/);
  });
});

describe('System Analytics rows', () => {
  const init = read('public/assets/js/pages/admin-init.js');

  test('each signup row is a label and one value, with no row of block glyphs', () => {
    expect(init).not.toContain('▮');
    expect(init).not.toMatch(/\bbar\(/);
    expect(init).toContain('<strong>Signups last 7 days:</strong> ${last7}</p>');
    expect(init).toContain('<strong>Signups last 30 days:</strong> ${last30}</p>');
  });
});

describe('message moderation panel', () => {
  const SOURCE = read('public/assets/js/pages/admin-messages-init.js');

  // jsdom cannot be loaded inside Jest here, so the panel runs in a child Node process and the
  // scenarios report what the table showed at each step.
  const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('public/assets/js/pages/admin-messages-init.js', 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ok = body => ({ ok: true, json: () => Promise.resolve(body) });
const conv = (id, text) => ({ _id: id, participants: [{ displayName: text }], lastMessage: { content: text }, messageCount: 1 });

async function setup(fetchWithTimeout) {
  const dom = new JSDOM('<!doctype html><body>' +
    '<input id="msgModerationSearch"><select id="msgModerationStatus"><option value=""></option></select>' +
    '<button id="msgModerationSearchBtn"></button><table><tbody id="msgModerationBody"></tbody></table>' +
    '<button id="msgModerationPrev"></button><span id="msgModerationPageInfo"></span><button id="msgModerationNext"></button>' +
    '</body>', { runScripts: 'outside-only' });
  const { window } = dom;
  current = window;
  window.AdminShared = {
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
    formatDate: () => 'today',
    fetchWithTimeout,
  };
  window.eval(source);
  // jsdom fires DOMContentLoaded itself once the script has registered; wait for that.
  return new Promise(resolve => window.document.addEventListener('DOMContentLoaded', () => resolve(window)));
}
let current;
const text = window => window.document.getElementById('msgModerationBody').textContent;

(async () => {
  const out = {};

  let w;
  w = await setup(() => {
    // What the table says at the moment the request goes out.
    out.loadingFirst = text(current);
    return Promise.resolve(ok({ total: 1, conversations: [conv('a', 'hello')] }));
  });
  await flush();
  out.afterLoad = text(w);

  let calls = 0;
  w = await setup(() => {
    calls += 1;
    return calls === 1
      ? Promise.reject(new Error('Request timed out after 15000ms'))
      : Promise.resolve(ok({ total: 1, conversations: [conv('b', 'second try')] }));
  });
  await flush();
  const body = w.document.getElementById('msgModerationBody');
  out.timeoutText = text(w);
  out.hasErrorClass = Boolean(body.querySelector('.admin-messenger-state--error'));
  const retry = w.document.getElementById('msgModerationRetry');
  out.hasRetry = Boolean(retry);
  retry.click();
  out.loadingAgain = text(w);
  await flush();
  out.afterRetry = text(w);

  w = await setup(() => Promise.resolve({ ok: false, status: 403 }));
  await flush();
  out.forbidden = text(w);

  const pending = [];
  w = await setup(() => new Promise(resolve => pending.push(resolve)));
  w.document.getElementById('msgModerationSearch').value = 'cake';
  w.document.getElementById('msgModerationSearchBtn').click();
  out.pendingCount = pending.length;
  pending[1](ok({ total: 1, conversations: [conv('new', 'newest result')] }));
  await flush();
  pending[0](ok({ total: 1, conversations: [conv('old', 'stale result')] }));
  await flush();
  out.afterStale = text(w);

  console.log(JSON.stringify(out));
})();
`;

  let result;
  beforeAll(() => {
    result = JSON.parse(execFileSync('node', ['-e', SCRIPT], { cwd: ROOT, encoding: 'utf8' }));
  });

  test('shows a loading row, then the conversations', () => {
    expect(result.loadingFirst).toContain('Loading conversations');
    expect(result.afterLoad).toContain('hello');
    expect(result.afterLoad).not.toContain('Loading conversations');
  });

  test('a timeout is shown as a readable error with a Try again button that works', () => {
    expect(result.timeoutText).toContain('took too long');
    expect(result.hasErrorClass).toBe(true);
    expect(result.hasRetry).toBe(true);
    expect(result.loadingAgain).toContain('Loading conversations');
    expect(result.afterRetry).toContain('second try');
  });

  test('an access error says so instead of printing a bare status code', () => {
    expect(result.forbidden).toContain('do not have access');
  });

  test('a slow answer to an earlier search cannot replace the newest one', () => {
    expect(result.pendingCount).toBe(2);
    expect(result.afterStale).toContain('newest result');
    expect(result.afterStale).not.toContain('stale result');
  });

  test('uses the shared timeout helper rather than a bare fetch', () => {
    expect(SOURCE).toMatch(/AdminShared\.fetchWithTimeout\(url,/);
  });
});

describe('admin notification bell icons', () => {
  const navbar = read('public/assets/js/admin-navbar.js');
  const css = read('public/assets/css/admin-enhanced.css');
  const { NOTIFICATION_TYPES } = require('../../models/index.js');

  test.each(Object.values(NOTIFICATION_TYPES))('"%s" has its own icon and its own colour', type => {
    expect(navbar).toMatch(new RegExp(`\\n      ${type}:\\n`));
    expect(css).toContain(`.admin-notif-item-icon--${type}`);
  });

  test('every admin page loads the navbar under the new version', () => {
    const pages = fs
      .readdirSync(path.join(ROOT, 'public'))
      .filter(name => /^admin.*\.html$/.test(name))
      .map(name => read(`public/${name}`))
      .filter(html => html.includes('admin-navbar.js?v='));
    expect(pages.length).toBeGreaterThan(30);
    for (const html of pages) {
      expect(html).toContain('admin-navbar.js?v=18.4.1');
    }
  });
});

describe('Users Centre', () => {
  const html = read('public/admin-users.html');
  const css = read('public/assets/css/admin-enhanced.css');
  const init = read('public/assets/js/pages/admin-users-init.js');

  test('the summary cards container uses a class that has a grid rule', () => {
    const match = html.match(/id="ucSummaryGrid"\s+class="([^"]+)"/);
    expect(match).not.toBeNull();
    for (const name of match[1].split(/\s+/)) {
      expect(css).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*display:\\s*grid`));
    }
  });

  test('no page size above the 100 the API accepts is offered or accepted', () => {
    const select = html.match(/<select id="ucPageSize"[\s\S]*?<\/select>/)[0];
    const sizes = [...select.matchAll(/<option value="(\d+)"/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    const accepted = init.match(/\[([\d, ]+)\]\.includes\(limit\)/);
    expect(accepted).not.toBeNull();
    expect(Math.max(...accepted[1].split(',').map(Number))).toBeLessThanOrEqual(100);
  });

  test('"Subscription" and "Marketing" columns are wide enough not to break mid-word', () => {
    const cols = [
      ...html.match(/<colgroup>[\s\S]*?<\/colgroup>/)[0].matchAll(/width:(\d+)px/g),
    ].map(m => Number(m[1]));
    // Order: checkbox, name, email, role, subscription, verified, signup, email status, marketing...
    expect(cols[4]).toBeGreaterThanOrEqual(130);
    expect(cols[8]).toBeGreaterThanOrEqual(100);
  });
});

describe('Suppliers filter row', () => {
  test('selects in a wrapping .filter-row are not forced to full width', () => {
    const css = read('public/assets/css/admin-ui-improvements.css');
    const rule = css.match(/\.filter-row \.filter-select\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/width:\s*auto/);
  });

  test('every page loading admin-ui-improvements.css loads the new version', () => {
    const pages = fs
      .readdirSync(path.join(ROOT, 'public'))
      .filter(name => /^admin.*\.html$/.test(name))
      .map(name => read(`public/${name}`))
      .filter(page => page.includes('admin-ui-improvements.css'));
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      expect(page).toContain('admin-ui-improvements.css?v=18.3.3');
    }
  });
});
