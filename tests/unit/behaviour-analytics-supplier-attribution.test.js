'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Both bugs covered here share one root cause: canonical supplier profile
// URLs (/supplier/name--token) never carry an ?id= query string -- the slug
// token is a one-way hash of the real id, not the id itself (see
// services/publicSupplierSeo.service.js#supplierSlugToken). Any code that
// tried to recover the id by parsing the *current* location.search, or by
// parsing a *link's* href query string, silently got nothing on these URLs.
// public-supplier-avatar.js had the same class of bug (fixed alongside
// this); this file guards the two spots in behaviour-analytics.js that had
// it too: page-view attribution (currentEntityContext/currentPageSupplierId)
// and outbound-click attribution (linkEntityContext).

function makeCapturingTarget() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, handler) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    }),
    removeEventListener: jest.fn(),
    listeners,
  };
}

function makeElement({ tagName = 'A', dataset = {}, href = '', textContent = '' } = {}) {
  const el = {
    tagName,
    dataset,
    href,
    textContent,
    value: '',
    style: {},
    closest(selector) {
      if (selector === 'a, button, [role="button"], input[type="submit"]') {
        return tagName === 'A' || tagName === 'BUTTON' ? el : null;
      }
      if (selector === '.ph-no-capture, [data-analytics-sensitive]') {
        return null;
      }
      if (selector === '[data-supplier-id]') {
        return dataset.supplierId ? el : null;
      }
      if (selector === '[data-package-id]') {
        return dataset.packageId ? el : null;
      }
      return null;
    },
  };
  return el;
}

function loadBehaviourAnalytics({ pathname, search = '', supplierRoute } = {}) {
  const code = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/behaviour-analytics.js'),
    'utf8'
  );

  const documentTarget = makeCapturingTarget();
  const windowTarget = makeCapturingTarget();
  const sessionStore = {};

  const sandbox = {
    window: {
      location: {
        pathname,
        search,
        href: `https://event-flow.co.uk${pathname}${search}`,
        origin: 'https://event-flow.co.uk',
        hostname: 'event-flow.co.uk',
      },
      EventFlowSupplierRoute: supplierRoute,
      CookieConsent: { getConsent: () => ({ analytics: true }) },
      crypto: { randomUUID: () => 'test-session-id' },
      sessionStorage: {
        getItem: key => (key in sessionStore ? sessionStore[key] : null),
        setItem: (key, value) => {
          sessionStore[key] = value;
        },
        removeItem: key => {
          delete sessionStore[key];
        },
      },
      innerWidth: 1200,
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      requestAnimationFrame: () => {},
      addEventListener: windowTarget.addEventListener,
      removeEventListener: windowTarget.removeEventListener,
    },
    document: {
      readyState: 'loading',
      visibilityState: 'hidden',
      hasFocus: () => false,
      referrer: '',
      documentElement: { clientWidth: 1200 },
      addEventListener: documentTarget.addEventListener,
      removeEventListener: documentTarget.removeEventListener,
    },
    navigator: {},
    performance: { now: () => 0 },
    URL,
    URLSearchParams,
    fetch: jest.fn(async url => {
      if (String(url).includes('/behaviour/config')) {
        return {
          ok: true,
          json: async () => ({ enabled: true, heartbeatSeconds: 15, posthog: { enabled: false } }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
    module: { exports: {} },
  };

  vm.runInNewContext(code, sandbox);

  return { sandbox, documentListeners: documentTarget.listeners };
}

function collectedEvents(fetchMock) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/behaviour/collect'))
    .flatMap(([, init]) => JSON.parse(init.body).events);
}

describe('behaviour-analytics supplier id attribution on canonical URLs', () => {
  test('attributes supplier_profile_view via window.EventFlowSupplierRoute, not the id-less canonical URL', async () => {
    const { sandbox } = loadBehaviourAnalytics({
      pathname: '/supplier/celtic-collection--0123456789abcdef',
      supplierRoute: { getSupplierId: () => 'sup_celtic' },
    });

    await sandbox.window.EFAnalytics.start();
    sandbox.window.EFAnalytics.flush();

    const events = collectedEvents(sandbox.fetch);
    const view = events.find(e => e.event === 'supplier_profile_view');
    expect(view).toBeDefined();
    expect(view.properties.supplierId).toBe('sup_celtic');
  });

  test('falls back to the query string when EventFlowSupplierRoute is unavailable (e.g. supplier.html?id=... directly)', async () => {
    const { sandbox } = loadBehaviourAnalytics({
      pathname: '/supplier.html',
      search: '?id=sup_legacy',
    });

    await sandbox.window.EFAnalytics.start();
    sandbox.window.EFAnalytics.flush();

    const events = collectedEvents(sandbox.fetch);
    const view = events.find(e => e.event === 'supplier_profile_view');
    expect(view).toBeDefined();
    expect(view.properties.supplierId).toBe('sup_legacy');
  });

  test('attributes a supplier-card click using the link’s data-supplier-id, not its id-less href', async () => {
    const { sandbox, documentListeners } = loadBehaviourAnalytics({ pathname: '/suppliers' });

    await sandbox.window.EFAnalytics.start();
    const clickHandler = documentListeners.click && documentListeners.click[0];
    expect(typeof clickHandler).toBe('function');

    const link = makeElement({
      tagName: 'A',
      dataset: { supplierId: 'sup_target', action: 'view-profile' },
      href: 'https://event-flow.co.uk/supplier/other-supplier--fedcba9876543210',
    });
    clickHandler({ target: link });
    sandbox.window.EFAnalytics.flush();

    const events = collectedEvents(sandbox.fetch);
    const clicked = events.find(e => e.event === 'result_clicked');
    expect(clicked).toBeDefined();
    expect(clicked.properties.resultType).toBe('supplier');
    expect(clicked.properties.supplierId).toBe('sup_target');
    expect(clicked.properties.resultId).toBe('sup_target');
  });
});
