'use strict';

/**
 * Capabilities of the old supplier dashboard that the redesign keeps (feature-parity audit R1-R11):
 * enquiry figures, the 7/30/90-day period buttons and the visit-to-reply view, review request
 * history, message search/filter/sort, copy profile link, live unread count, and the deep links the
 * server sends. Everything shown comes from the summary; nothing is invented.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const homeJs = read('public/assets/js/pages/supplier-dashboard-home.js');

const runner = path.join(__dirname, '../helpers/supplier-dashboard-home-scenario.js');
/** Runs the page scenario and returns what it rendered. */
const run = scenario =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, Buffer.from(JSON.stringify(scenario), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

const day = (date, views, enquiries) => ({ date, views, enquiries });
const summary = {
  window: { days: 30, maxDays: 90, requestedDays: 30 },
  verification: { emailVerified: true, approved: true, status: 'approved', state: 'approved' },
  profile: {
    name: 'Hawthorn Barn',
    publicProfilePath: '/supplier/hawthorn-barn--0123456789abcdef',
    completeness: { score: 85, checks: [] },
  },
  packages: { total: 2, active: 2, limit: 50, countedTowardsLimit: 2 },
  messages: { unreadMessages: 4, conversationsWithUnread: 3 },
  enquiries: {
    newThisPeriod: 7,
    previousPeriod: 2,
    sources: { conversations: 5, quoteRequests: 1, contactForm: 1 },
    requests: { received: 2, new: 2 },
  },
  responses: { sampleSize: 5, repliedPct: 75, medianMinutes: 30 },
  views: {
    total: 120,
    days: 30,
    basis: 'page_loads',
    description: 'Times your public profile page was loaded, counted once per visitor per hour.',
  },
  reviews: { approvedCount: 3, averageRating: 4.5, pendingCount: 0 },
  subscription: { plan: 'pro', status: 'active', limits: { maxPackages: 50 } },
  analytics: {
    dailyData: [day('2026-07-01', 2, 0), day('2026-07-02', 3, 1), day('2026-07-03', 0, 2)],
  },
};
const clone = value => JSON.parse(JSON.stringify(value));

describe('enquiry figures (R1)', () => {
  const page = run({ summary, suppliers: [{ id: 's1' }] });

  test('the summary shows enquiries for the period, the trend against the one before, and a way to open the list', () => {
    expect(page.extraHtml).toContain('Enquiries, last 30 days');
    expect(page.extraHtml).toContain('>7<');
    expect(page.extraHtml).toContain('Up 250% on the 30 days before.');
    expect(page.extraHtml).toContain('data-sdh-action="open-enquiries"');
    expect(page.extraHtml).toContain('View 2 new requests');
  });

  test('the visits card has an enquiries-per-day chart next to the visits chart', () => {
    expect(page.visitsHtml).toContain('Enquiries per day');
    expect(page.visitsHtml).toContain('sdh-chart__bar--alt');
    expect(page.visitsHtml.match(/<figure class="sdh-chart"/g)).toHaveLength(2);
  });

  test('no enquiry figure is shown when the server sent none', () => {
    const bare = clone(summary);
    delete bare.enquiries;
    const bare2 = run({ summary: bare, suppliers: [{ id: 's1' }] });
    expect(bare2.extraHtml).not.toContain('Enquiries, last');
    expect(bare2.visitsHtml).not.toMatch(/<li><strong>\d+<\/strong> enquiries/);
  });

  test('the trend says what it knows: none before, same, down, and nothing without a previous figure', () => {
    const outer = run({ summary, suppliers: [{ id: 's1' }] });
    expect(outer).toBeTruthy();
    const trend = (fresh, previous) =>
      run({
        summary: {
          ...summary,
          enquiries: { ...summary.enquiries, newThisPeriod: fresh, previousPeriod: previous },
        },
        suppliers: [{ id: 's1' }],
      }).extraHtml;
    expect(trend(4, 0)).toContain('None in the 30 days before.');
    expect(trend(4, 4)).toContain('Same as the 30 days before.');
    expect(trend(2, 4)).toContain('Down 50% on the 30 days before.');
    expect(trend(2, null)).not.toMatch(/days before/);
  });
});

describe('period buttons and the visit-to-reply view (R3)', () => {
  test('7, 30 and 90 days are offered; the chosen one is pressed', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }] });
    expect(page.visitsHtml).toMatch(/data-sdh-days="7" aria-pressed="false"/);
    expect(page.visitsHtml).toMatch(/data-sdh-days="30" aria-pressed="true"/);
    expect(page.visitsHtml).toMatch(/data-sdh-days="90" aria-pressed="false"/);
  });

  test('a plan that shows less turns the longer periods off, with the reason', () => {
    const starter = clone(summary);
    starter.window = { days: 7, maxDays: 7, requestedDays: 30 };
    starter.views = { ...starter.views, days: 7 };
    const page = run({ summary: starter, suppliers: [{ id: 's1' }] });
    expect(page.visitsHtml).toMatch(
      /data-sdh-days="30"[^>]*disabled=""[^>]*title="Your plan shows up to 7 days"/
    );
    expect(page.visitsHtml).toMatch(/data-sdh-days="90"[^>]*disabled/);
    expect(page.visitsHtml).not.toMatch(/data-sdh-days="7"[^>]*disabled/);
    // What is pressed is what is shown: the 7 days the plan serves, not the 30 that were asked for.
    expect(page.visitsHtml).toMatch(/data-sdh-days="7" aria-pressed="true"/);
  });

  test('choosing a period asks the server for that window', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }], clickPeriod: 90 });
    const asked = page.requested.filter(url => url.includes('dashboard-summary'));
    expect(asked[0]).toContain('days=30');
    expect(asked[asked.length - 1]).toContain('days=90');
  });

  test('from visit to reply: page loads, enquiries and the reply rate, each only with a real value, and not called a conversion rate', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }] });
    expect(page.visitsHtml).toContain('From visit to reply');
    expect(page.visitsHtml).toContain('<strong>120</strong> profile page loads');
    expect(page.visitsHtml).toContain(
      '<strong>7</strong> enquiries (5 conversations, 1 quote request, 1 contact message)'
    );
    expect(page.visitsHtml).toContain('<strong>75%</strong> of 5 recent conversations replied to');
    expect(page.visitsHtml).toContain('not a conversion rate');
    const sparse = clone(summary);
    sparse.responses = { sampleSize: 2, repliedPct: null, medianMinutes: null };
    const quiet = run({ summary: sparse, suppliers: [{ id: 's1' }] });
    expect(quiet.visitsHtml).not.toContain('replied to');
  });

  test("the visits footnote is the server's own sentence, not one written on the page", () => {
    const page = run({ summary, suppliers: [{ id: 's1' }] });
    expect(page.visitsHtml).toContain(
      'Times your public profile page was loaded, counted once per visitor per hour.'
    );
    expect(page.visitsHtml).not.toContain('One visitor can be counted once an hour.');
  });
});

describe('review request history (R5)', () => {
  const items = [
    {
      id: 'a',
      customerName: 'Olivia M.',
      customerEmail: 'olivia@example.com',
      status: 'completed',
      completedAt: '2026-06-01T00:00:00.000Z',
      retryable: true,
    },
    {
      id: 'b',
      customerName: 'Rachel B.',
      customerEmail: 'rachel@example.com',
      status: 'sent',
      sentAt: '2026-06-02T00:00:00.000Z',
      retryable: false,
      retryAt: '2026-07-02T00:00:00.000Z',
    },
    {
      id: 'c',
      customerEmail: 'sam@example.com',
      status: 'failed',
      lastError: 'The mailbox does not exist',
      retryable: true,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `x${index}`,
      customerEmail: `p${index}@example.com`,
      status: 'sent',
    })),
  ];
  const reviewRequests = {
    items,
    summary: { total: 8, active: 6, completed: 1, deliveryIssues: 1 },
  };

  test('the history is a details with the four counts, the customer email and the failure reason', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }], reviewRequests });
    expect(page.requestsHtml).toContain('<details class="sdh-more sdh-rreq-history"');
    expect(page.requestsHtml).toContain('(1 need attention)');
    ['requests', 'waiting', 'completed', 'needs attention'].forEach(label =>
      expect(page.requestsHtml).toContain(label)
    );
    expect(page.requestsHtml).toContain('olivia@example.com');
    expect(page.requestsHtml).toContain('The mailbox does not exist');
    expect(page.requestsHtml).toContain('You can ask again on 2 July 2026.');
  });

  test('five rows show first, Show all reveals the rest, and the status filter narrows the list', () => {
    const first = run({ summary, suppliers: [{ id: 's1' }], reviewRequests });
    expect(first.requestsHtml.match(/sdh-list__row/g)).toHaveLength(5);
    expect(first.requestsHtml).toContain('Show all 8');
    const all = run({
      summary,
      suppliers: [{ id: 's1' }],
      reviewRequests,
      clickShowAllRequests: true,
    });
    expect(all.requestsHtml.match(/sdh-list__row/g)).toHaveLength(8);
    const failed = run({
      summary,
      suppliers: [{ id: 's1' }],
      reviewRequests,
      requestFilter: 'failed',
    });
    expect(failed.requestsHtml.match(/sdh-list__row/g)).toHaveLength(1);
    expect(failed.requestsHtml).toContain('<option value="failed" selected="">');
  });

  test('a retry is only offered when the server says it is allowed', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }], reviewRequests });
    expect(page.requestsHtml.match(/data-sdh-action="retry-request"/g)).toHaveLength(2);
  });
});

describe('copy profile link (R7)', () => {
  test('the Request a review dialog offers the public profile link to copy', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }], clickRequestReview: true });
    expect(page.profileLinkHidden).toBe(false);
    expect(page.profileLink).toBe('http://localhost/supplier/hawthorn-barn--0123456789abcdef');
    expect(homeJs).toContain('navigator.clipboard.writeText');
    expect(homeJs).toContain('Press Ctrl+C (Cmd+C on a Mac) to copy the selected link.');
  });

  test('with no public path there is no link field', () => {
    const bare = clone(summary);
    delete bare.profile.publicProfilePath;
    const page = run({ summary: bare, suppliers: [{ id: 's1' }], clickRequestReview: true });
    expect(page.profileLinkHidden).toBe(true);
  });
});

describe('messages and the keyboard (R4, R6, R10)', () => {
  test('search, filter and sort are back on the Messages card, and Ctrl/Cmd+K has a search box to land in', () => {
    expect(html).toMatch(
      /type="search"[^>]*id="widget-search-input-supplier"|id="widget-search-input-supplier"[^>]*type="search"/
    );
    expect(read('public/assets/js/keyboard-shortcuts.js')).toContain('input[type="search"]');
  });

  test('the unread tile and the greeting follow the live unread count', () => {
    const page = run({ summary, suppliers: [{ id: 's1' }], unreadUpdate: 9 });
    const tile = page.tiles.find(item => item.label === 'Unread messages');
    expect(tile.value).toBe('9');
    expect(page.lede).toBe('You have 9 unread messages.');
    const cleared = run({ summary, suppliers: [{ id: 's1' }], unreadUpdate: 0 });
    expect(cleared.tiles.find(item => item.label === 'Unread messages').value).toBe('0');
  });
});

describe('deep links the server sends (R11)', () => {
  test('#reviews and #review-requests scroll to the reviews card, #verification opens the form, #enquiries opens the list', () => {
    expect(homeJs).toContain("hash === 'reviews' || hash === 'review-requests'");
    expect(homeJs).toContain("hash === 'verification'");
    expect(homeJs).toContain("hash === 'enquiries'");
  });
});
