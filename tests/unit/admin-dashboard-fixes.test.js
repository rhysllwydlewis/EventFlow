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

const HARNESS = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('public/admin.html', 'utf8').replace(/<script[\\s\\S]*?<\\/script>/g, '');
const scenario = process.argv[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin' });
const { window } = dom;
const json = body => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
const fail = () => Promise.resolve({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ error: 'x' }), text: () => Promise.resolve('x') });
const users = [
  { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.test', role: 'customer', verified: true, createdAt: '2026-10-20T10:00:00Z', signupMethod: 'google', authProvider: 'google' },
  { id: 'u2', name: 'Bob <b>Bold</b>', email: 'bob@example.test', role: 'supplier', verified: false, createdAt: '2026-10-21T10:00:00Z' },
];
window.fetch = url => {
  const u = String(url);
  if (u.includes('/auth/me')) return json({ user: { id: 'a1', role: 'admin', name: 'Rhys Lewis', email: 'a@example.test' } });
  if (u.includes('/users/summary')) return json({ total: 2, suppliers: { total: 1 }, bySignup: {}, byVerification: {}, issueCount: 0 });
  if (u.includes('/admin/metrics')) return json({ counts: { usersTotal: 2, suppliersTotal: 1, packagesTotal: 0 } });
  if (u.includes('/photos/pending')) {
    if (scenario === 'photos-fail') return fail();
    return json({ photos: scenario === 'quiet' ? [] : [{ approved: false }, { approved: false }, { approved: true }] });
  }
  if (u.includes('/reviews/pending')) return json({ reviews: [] });
  if (u.includes('/reports/pending')) return scenario === 'reports-fail' ? fail() : json({ count: scenario === 'quiet' ? 0 : 3 });
  if (u.includes('/pending-verification')) return json({ count: scenario === 'quiet' ? 0 : 1 });
  if (u.includes('/users/list')) return json({ items: users });
  return json({});
};
window.AdminShared = {
  fetchWithTimeout: (url, opts) => window.fetch(url, opts),
  escapeHtml: v => String(v),
  showToast() {},
  animateCounter: (el, n) => { el.textContent = String(n); },
  api: url => window.fetch(url),
};
window.eval(fs.readFileSync('public/assets/js/pages/admin-init.js', 'utf8'));
setTimeout(() => {
  const d = window.document;
  const t = id => { const e = d.getElementById(id); return e && e.textContent; };
  console.log(JSON.stringify({
    greeting: t('adhGreeting'), next: t('adhNext'),
    primary: [t('adhPrimary'), d.getElementById('adhPrimary').getAttribute('href')],
    photos: t('adhPendingPhotosCount'), reviews: t('pendingReviewsCount'),
    reports: t('pendingReportsCount'), suppliers: t('pendingSupplierVerificationCount'),
    rows: d.querySelectorAll('#users tbody tr').length,
    head: [...d.querySelectorAll('#users thead th')].map(x => x.textContent),
    usersHtml: d.getElementById('users').innerHTML,
  }));
}, 300);
`;

function runDashboard(scenario) {
  return JSON.parse(
    execFileSync('node', ['-e', HARNESS, scenario], { cwd: ROOT, encoding: 'utf8' })
  );
}

describe('the redesigned page', () => {
  const html = read('public/admin.html');
  const css = read('public/assets/css/admin-dashboard-home.css');

  test('is scoped: the body class, one stylesheet, every selector under .adh-page', () => {
    expect(html).toMatch(/<body class="[^"]*\badh-page\b/);
    expect(html).toContain('admin-dashboard-home.css?v=1');
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map(block => block.split('{')[0].trim())
      .filter(sel => sel && !sel.startsWith('@') && !/^\d+%$|^from$|^to$/.test(sel));
    expect(selectors.length).toBeGreaterThan(50);
    for (const group of selectors) {
      for (const sel of group.split(',').map(x => x.trim())) {
        expect(sel).toMatch(/^(body)?\.adh-page\b/);
      }
    }
  });

  test('the dashboard-only patch layers are gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'public/assets/css/admin-dashboard-refresh.css'))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(ROOT, 'public/assets/js/pages/admin-verification-source-init.js'))
    ).toBe(false);
    expect(html).not.toContain('admin-dashboard-refresh');
    expect(html).not.toContain('admin-verification-source-init');
  });

  test('has no inline styles and no emoji icons', () => {
    const body = html.slice(html.indexOf('<body'), html.indexOf('<footer'));
    expect(body).not.toMatch(/\sstyle="/);
    expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('keeps every id the scripts and browser tests use, once each', () => {
    const ids = [
      'adminNavbarMount',
      'refreshBtn',
      'status',
      'adhGreeting',
      'adhNext',
      'adhPrimary',
      'totalUsersCount',
      'totalUsersChange',
      'totalPackagesCount',
      'totalPackagesChange',
      'totalSuppliersCount',
      'totalSuppliersChange',
      'totalRevenueCount',
      'totalRevenueChange',
      'adhPendingPhotosCount',
      'pendingReviewsCount',
      'pendingReportsCount',
      'pendingSupplierVerificationCount',
      'reviewPhotosBtn',
      'reviewReviewsBtn',
      'reviewReportsBtn',
      'verifySuppliersBtn',
      'dashUserHealthRows',
      'dashSupplierHealthRows',
      'dashHealthGrid',
      'downloadMarketingCsv',
      'downloadAllJson',
      'downloadUsersCsv',
      'totalSuppliersCountCard',
      'pendingSuppliersCount',
      'proSuppliersCount',
      'totalPackagesCountCard',
      'pendingPackagesCount',
      'featuredPackagesCount',
      'totalCalendarEventsCountCard',
      'pendingCalendarRequestsCount',
      'publishedCalendarEventsCount',
      'totalPartnersCountCard',
      'activePartnersCount',
      'openPayoutRequestsCount',
      'userManagementBtn',
      'packageManagementBtn',
      'homepageChangesBtn',
      'supportTicketsBtn',
      'paymentsAnalyticsBtn',
      'reportsQueueBtn',
      'eventsCalendarBtn',
      'auditLogBtn',
      'adminSettingsBtn',
      'contentManagementBtn',
      'mediaCenterBtn',
      'globalSearchBtn',
      'analyticsBtn',
      'emailCentreBtn',
      'analytics',
      'msgModerationSearch',
      'msgModerationStatus',
      'msgModerationSearchBtn',
      'msgModerationBody',
      'msgModerationPrev',
      'msgModerationNext',
      'msgModerationPageInfo',
      'createUserBtn',
      'userSearch',
      'userDateFilter',
      'users',
    ];
    for (const id of ids) {
      expect(html.match(new RegExp(`id="${id}"`, 'g')) || []).toHaveLength(1);
    }
  });

  test('the photo count has its own id: the shared badge updaters write "pendingPhotosCount"', () => {
    expect(html).not.toContain('id="pendingPhotosCount"');
    expect(read('public/assets/js/admin-shared.js')).toContain('pendingPhotosCount');
    expect(read('public/assets/js/admin-features.js')).toContain('pendingPhotosCount');
  });

  test('admin.html loads the changed scripts under new versions', () => {
    expect(html).toContain('pages/admin-init.js?v=18.5.4');
    expect(html).toContain('admin-messages-init.js?v=18.3.2');
  });
});

describe('the dashboard script, run against a faked server', () => {
  test('greets by first name, says what is next and fills the counts', () => {
    const out = runDashboard('ok');
    expect(out.greeting).toMatch(/^Good (morning|afternoon|evening), Rhys$/);
    expect(out.next).toBe('Next: 1 supplier to verify and 2 more queues.');
    expect(out.primary).toEqual(['Verify suppliers', '/admin-suppliers']);
    expect([out.photos, out.reviews, out.reports, out.suppliers]).toEqual(['2', '0', '3', '1']);
  });

  test('says so when nothing is waiting', () => {
    const out = runDashboard('quiet');
    expect(out.next).toBe('Nothing is waiting for you.');
    expect(out.primary).toEqual(['Open Users Centre', '/admin-users']);
  });

  test('a failed count is shown as unknown, not as a reassuring 0', () => {
    const reports = runDashboard('reports-fail');
    expect(reports.reports).toBe('—');
    const photos = runDashboard('photos-fail');
    expect(photos.photos).toBe('—');
    const quietButBroken = runDashboard('reports-fail');
    expect(quietButBroken.next).not.toBe('Nothing is waiting for you.');
  });

  test('recent users are drawn once, in five columns, with the sign-up detail built in', () => {
    const out = runDashboard('ok');
    expect(out.head).toEqual(['User', 'Role', 'Verification', 'Joined', 'Actions']);
    expect(out.rows).toBe(2);
    expect(out.usersHtml).toContain('Signed up: Google');
    expect(out.usersHtml).toContain('Not verified');
    // Names are escaped, not injected.
    expect(out.usersHtml).not.toContain('<b>Bold</b>');
    expect(out.usersHtml).toContain('&lt;b&gt;Bold&lt;/b&gt;');
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
