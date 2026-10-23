'use strict';

/**
 * Fixes from the independent front-end review of the supplier dashboard: no error flash while the
 * first load is still going, no 404 toasts for a supplier with no profile, the package price the
 * server really stores, attribute-safe escaping, links that cannot leave the site, tips that do
 * something, and the profile card not looking like a card inside a card.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const homeSource = read('public/assets/js/pages/supplier-dashboard-home.js');
const html = read('public/dashboard-supplier.html');
const css = read('public/assets/css/supplier-dashboard-home.css');
const appJs = read('public/assets/js/app.js');

const homeRunner = path.join(__dirname, '../helpers/supplier-dashboard-home-scenario.js');
const cardsRunner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');
/** Runs a scenario script in a child process and parses what it printed. */
const runScenario = (runner, args) =>
  JSON.parse(
    execFileSync(process.execPath, [runner, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    })
  );
const runHome = scenario =>
  runScenario(homeRunner, [Buffer.from(JSON.stringify(scenario), 'utf8').toString('base64')]);

describe('first load: no error flash, no 404 toasts', () => {
  test('while the summary request is still going nothing says it failed, and the grid stays busy', () => {
    const page = runHome({ summaryNeverResolves: true, suppliers: [{ id: 's1' }] });
    expect(page.summaryEmpty).not.toMatch(/could not be loaded|Try again/);
    expect(page.steps.body).not.toMatch(/Something went wrong/);
    expect(page.plan || '').not.toMatch(/could not load/);
    expect(page.lede).not.toMatch(/could not load/);
    expect(page.summaryBusy).toBe('true');
  });

  test('a supplier with no profile makes none of the requests that would 404', () => {
    const page = runHome({ summaryStatus: 404, suppliers: [] });
    const asked = page.requested.join(' ');
    expect(asked).not.toContain('dashboard-summary');
    expect(asked).not.toContain('/api/v1/supplier/performance-tips');
    expect(asked).not.toContain('/api/v1/supplier/review-requests');
  });

  test('a supplier with a profile does make them', () => {
    const page = runHome({ summaryStatus: 200, summary: {}, suppliers: [{ id: 's1' }] });
    const asked = page.requested.join(' ');
    expect(asked).not.toContain('/api/v1/supplier/availability');
    expect(asked).toContain('/api/v1/supplier/performance-tips');
    expect(asked).toContain('/api/v1/supplier/review-requests');
  });

  test('if the profile list cannot be loaded, app.js says so and the page goes ahead with the summary', () => {
    expect(appJs).toMatch(/detail: \{ suppliers: null, failed: true \}/);
    expect(homeSource).toContain('event.detail?.failed');
    const page = runHome({
      summary: { profile: { name: 'A' } },
      suppliers: null,
      failedList: true,
    });
    expect(page.summaryBusy).not.toBe('true');
  });

  test('big containers are not live regions (only small status nodes are)', () => {
    [
      'my-suppliers',
      'my-packages',
      'supplier-reviews-section',
      'tickets-sup',
      'sdh-steps-body',
      'supplier-subscription-card',
      'supplier-performance-chart',
      'supplier-perf-tips',
      'sdh-summary-grid',
    ].forEach(id => {
      const start = html.indexOf(`id="${id}"`);
      const tag = html.slice(start, html.indexOf('>', start));
      expect(tag).not.toContain('aria-live');
    });
    expect(html).toMatch(/id="sdh-lede"[^>]*aria-live="polite"/);
  });
});

describe('packages: the price the server stores, and attribute-safe text', () => {
  const cards = runScenario(cardsRunner, ['cards']);

  test('the price is `price` (what the supplier typed), with the older price_display as a fallback', () => {
    expect(cards.priceNames).toEqual({
      typed: '£850 pp',
      older: '£1,000',
      both: '£1,000',
      number: '500',
      none: '',
    });
    expect(cards.noPrice).toBe(true);
    expect(appJs).toContain("document.getElementById('pkg-price').value = packagePriceText(pkg)");
  });

  test('a package called 6" round cake keeps its whole name in the Edit and Delete labels', () => {
    expect(cards.quoted.editLabel).toBe('Edit 6" round cake');
    expect(cards.quoted.deleteLabel).toBe('Delete 6" round cake');
    // No stray attribute was created by the quote.
    expect(cards.quoted.editAttributes).toEqual([
      'type',
      'class',
      'data-action',
      'data-package-id',
      'aria-label',
    ]);
    expect(cards.quoted.title).toBe('6" round cake');
    expect(cards.quoted.packageId).toBe('k"1');
    expect(cards.quoted.imgAttributes).toEqual(['src', 'alt', 'loading', 'data-fallback-src']);
    expect(cards.quoted.viewHref).toBe('/package?slug=six"cake');
  });

  test('the profile card is just .sdh-profile (the legacy .supplier-card box rule no longer applies) and escapes its id', () => {
    expect(cards.profile.cardClasses).toBe('sdh-profile');
    expect(cards.profile.name).toBe('Barn "Two" & Sons');
    expect(cards.profile.supplierId).toBe('s"1');
  });

  test('a profile photo that will not load falls back to the supplier initials', () => {
    expect(cards.profile.fallbackText).toBe('B');
    expect(appJs).toContain('img.dataset.fallbackText !== undefined');
  });

  test('the home script escapes quotes too, so any value can sit in an attribute', () => {
    expect(homeSource).toContain(".split('\"').join('&quot;')");
  });
});

/** Loads the home script's pure helpers in a vm, as the main test file does. */
function loadHome() {
  const classList = { toggle() {} };
  const node = () => ({
    classList,
    dataset: {},
    style: {},
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  });
  const window = {
    EFCheckoutUrl: require('../../public/assets/js/utils/checkout-url'),
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    matchMedia: () => ({ matches: false }),
    location: { hash: '', href: '', origin: 'https://event-flow.test' },
  };
  const document = {
    getElementById: () => null,
    createElement: node,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    body: node(),
    readyState: 'loading',
  };
  vm.runInNewContext(homeSource, {
    window,
    document,
    console,
    URL,
    fetch: () => Promise.reject(new Error('offline')),
    setTimeout,
    clearTimeout,
  });
  return window.SupplierDashboardHome;
}

describe('links stay on this site', () => {
  const home = loadHome();

  test('same-site paths and fragments pass', () => {
    expect(home.localHref('/supplier/hawthorn--0123')).toBe('/supplier/hawthorn--0123');
    expect(home.localHref('/dashboard/supplier?tab=1#reviews')).toBe(
      '/dashboard/supplier?tab=1#reviews'
    );
    expect(home.localHref('#reviews')).toBe('#reviews');
  });

  test('the tab/newline trick that browsers turn into //evil.example is refused, with every other way off site', () => {
    [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'evil.example',
      ' ',
      '',
      null,
      undefined,
      42,
    ].forEach(value => expect(home.localHref(value)).toBe(''));
  });

  test('the same check is used for the public profile path, step links and tip links, not a pattern test', () => {
    expect(homeSource).toContain('localHref(profile.publicProfilePath)');
    expect(homeSource).toContain('href: localHref(step.href)');
    expect(homeSource).not.toContain('/^(\\/(?!\\/)|#)/u');
    expect(homeSource).not.toContain('/^\\/[^/\\\\]/u');
    const model = home.normaliseSummary({ profile: { publicProfilePath: '/\t/evil.example' } });
    expect(model.profile.publicProfilePath).toBe('');
  });
});

describe('tips do something', () => {
  const tips = [
    {
      id: 'add-desc',
      title: 'Add a description',
      body: 'b',
      action: { href: '#toggle-profile-form', label: 'Add description' },
    },
    {
      id: 'add-photos',
      title: 'Add photos',
      body: 'b',
      action: { href: '#my-suppliers', label: 'Add photos' },
    },
    {
      id: 'add-package',
      title: 'Add a package',
      body: 'b',
      action: { href: '#toggle-package-form', label: 'Create a package' },
    },
    {
      id: 'get-review',
      title: 'Get a review',
      body: 'b',
      action: { href: '#reviews', label: 'Ask for a review' },
    },
    {
      id: 'add-tagline',
      title: 'Add a tagline',
      body: 'b',
      action: { href: '/supplier/profile-customization', label: 'Add tagline' },
    },
    {
      id: 'mystery',
      title: 'Something else',
      body: 'b',
      action: { href: '#toggle-profile-form', label: 'Open' },
    },
  ];
  const page = runHome({ summary: {}, suppliers: [{ id: 's1' }], tips });

  test('tips that are about the profile or packages open the real editor, not an inert anchor', () => {
    expect(page.tipsHtml).toContain('data-sdh-action="edit-profile" data-sdh-focus="sup-long"');
    expect(page.tipsHtml).toContain(
      'data-sdh-action="edit-profile" data-sdh-focus="sup-photo-drop"'
    );
    expect(page.tipsHtml).toContain('data-sdh-action="new-package"');
    expect(page.tipsHtml).toContain('data-sdh-action="request-review"');
  });

  test('tagline and social tips go to the page that has the setting', () => {
    expect(page.tipsHtml).toContain('href="/supplier/profile-customization"');
  });

  test('no tip links to a button that opens nothing', () => {
    expect(page.tipsHtml).not.toContain('#toggle-profile-form');
    expect(page.tipsHtml).not.toContain('#toggle-package-form');
    expect(page.tipsHtml).not.toContain('#my-suppliers');
    // An unknown tip with a dead link is shown without an action rather than with a broken one.
    expect(page.tipsHtml).toContain('Something else');
    expect(page.tipsHtml).not.toContain('>Open<');
  });
});

describe('the profile card does not sit in a card inside the card', () => {
  test('the sheet styles .sdh-profile as a row, and the long text cannot widen the page', () => {
    expect(css).toMatch(/\.sdh-page \.sdh-profile__main \{[^}]*min-width: 0/);
    expect(css).toMatch(/\.sdh-page \.sdh-profile__name \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.sdh-page \.sdh-pkg__price \{[^}]*overflow-wrap: anywhere/);
  });
});

describe('supplier dashboard home: addresses the server asks the page to open', () => {
  const home = loadHome();
  const base = 'https://event-flow.co.uk/dashboard/supplier';

  test("one of Stripe's hosted pages or a page on this site is opened", () => {
    expect(home.navigableUrl('https://billing.stripe.com/p/session/abc', base)).toBe(
      'https://billing.stripe.com/p/session/abc'
    );
    expect(home.navigableUrl('/supplier/subscription?x=1', base)).toBe(
      'https://event-flow.co.uk/supplier/subscription?x=1'
    );
  });

  test.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://evil.example/portal',
    'https://evil.example/portal',
    'https://billing.stripe.com.evil.example/p/session/abc',
    'https://user:pass@billing.stripe.com/p/session/abc',
    'http://billing.stripe.com/p/session/abc',
    '//evil.example/portal',
    'vbscript:msgbox(1)',
    '',
    '   ',
    undefined,
    null,
    42,
  ])('%p is never navigated to', value => {
    expect(home.navigableUrl(value, base)).toBe('');
  });
});
