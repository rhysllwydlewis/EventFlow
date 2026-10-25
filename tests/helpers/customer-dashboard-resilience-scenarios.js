#!/usr/bin/env node
/**
 * Behavioural scenarios for how the customer dashboard behaves when things go wrong: slow or
 * failing requests, blocked browser storage, a flaky sign-in check, and device data left behind
 * by another account. Each scenario runs the real page scripts in jsdom.
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the scripts run in a
 * plain Node process and each scenario's outcome is printed as JSON for the Jest suite to assert on.
 *
 * Run directly to debug: `node tests/helpers/customer-dashboard-resilience-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '../..');
const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A fresh window at the customer dashboard address, with the given markup. */
function windowWith(markup, fetchImpl, { url = 'http://localhost/dashboard/customer' } = {}) {
  const virtualConsole = new VirtualConsole();
  // jsdom cannot navigate; a script that tries to leave the page is reported here instead.
  const navigations = [];
  virtualConsole.on('jsdomError', error => {
    if (/navigation/iu.test(error.message)) {
      navigations.push(error.message);
    }
  });
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // The scripts log on purpose (timeouts, failed requests); only the JSON may reach stdout.
    virtualConsole,
  });
  const { window } = dom;
  window.__navigations = navigations;
  window.fetch = fetchImpl || (async () => ({ ok: false, status: 503, json: async () => ({}) }));
  window.matchMedia = () => ({ matches: false });
  window.Response = Response;
  return window;
}

/**
 * Loads the real utils/auth-state.js into a window. Its own sign-in check is answered "unavailable"
 * so it neither signs anybody in nor counts as a call the scenario is measuring.
 */
function loadAuthState(window) {
  const pageFetch = window.fetch;
  window.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  window.eval(source('public/assets/js/utils/auth-state.js'));
  window.fetch = pageFetch;
}

/** Resolves once the document has finished loading. */
function loaded(window) {
  if (window.document.readyState === 'complete') {
    return Promise.resolve(window);
  }
  return new Promise(resolve => window.addEventListener('load', () => resolve(window)));
}

/** A fetch reply the scripts can read. */
const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/* -------------------------------------------------------------------------- *
 * S1: the sign-in guard must not answer a slow request with made-up data
 * -------------------------------------------------------------------------- */

const TIME_SCALE = 100; // the guard's 5 s / 30 s waits run as 50 ms / 300 ms

/**
 * A fetch that behaves like a browser's: the promise it returns belongs to the page's own realm
 * (so Promise.race adopts it without an extra step) and is rejected synchronously inside
 * `controller.abort()`, before abort() returns. A mock that is an `async` function, or one built
 * from another realm's promises, rejects a few ticks late, which lets a stand-in that was settled
 * AFTER the abort still win the race and hides the ordering bug the guard once had.
 */
function browserLikeFetch(window, handler) {
  return (input, options = {}) => {
    const target = new URL(String(input), 'http://localhost').pathname;
    return new window.Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = () => {
        const error = new window.Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort);
      Promise.resolve(handler(target, options)).then(resolve, reject);
    });
  };
}

/** Makes the page's timers run TIME_SCALE times faster. */
function speedUp(window) {
  const realSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, ms, ...rest) =>
    realSetTimeout(callback, Math.max(1, Math.round((ms || 0) / TIME_SCALE)), ...rest);
}

/**
 * Starts the sign-in guard on the customer dashboard with its waits shortened, and resolves to
 * the window once the guard has confirmed the signed-in user.
 * `serve(path, options)` answers the page's calls; `control.meSlow` makes /api/v1/auth/me hang.
 */
async function guardedWindow(serve, control = {}) {
  const window = await loaded(windowWith('<main></main>'));
  window.fetch = browserLikeFetch(window, (target, options) => {
    if (target === '/api/v1/auth/me' && !control.meSlow) {
      return answer(200, { user: { id: 'u1', role: 'customer', firstName: 'Ann' } });
    }
    return serve(target, options);
  });
  speedUp(window);
  window.eval(source('public/assets/js/dashboard-guard.js'));
  for (let tries = 0; tries < 100 && !window.__EF_DASHBOARD_USER__; tries += 1) {
    await sleep(10);
  }
  return window;
}

/**
 * Runs the sign-in guard at `url` against a /api/v1/auth/me that answers as `me(attempt)` says
 * (a reply, a promise that never settles, or a throw), and reports what it did.
 */
async function guardCheck(url, me, { settleMs = 600 } = {}) {
  const calls = { me: 0 };
  const window = await loaded(windowWith('<main></main>', undefined, { url }));
  window.fetch = browserLikeFetch(window, (target, options) => {
    if (target === '/api/v1/auth/me') {
      calls.me += 1;
      return me(calls.me, options);
    }
    return answer(200, {});
  });
  speedUp(window);
  window.eval(source('public/assets/js/dashboard-guard.js'));
  let noticeShown = false;
  const watcher = setInterval(() => {
    if (window.document.getElementById('ef-guard-auth-notice')) {
      noticeShown = true;
    }
  }, 5);
  await sleep(settleMs);
  clearInterval(watcher);
  return {
    meRequests: calls.me,
    navigations: window.__navigations.length,
    revealed: !window.document.getElementById('dashboard-guard-style'),
    unconfirmed: window.__EF_SIGNIN_UNCONFIRMED__ === true,
    noticeShown,
    noticeLeft: Boolean(window.document.getElementById('ef-guard-auth-notice')),
    wrapped: window.__EF_CUSTOMER_DASHBOARD_FETCH_GUARD__ === true,
  };
}

/** What a page call ends in: the body it received, or the error it was rejected with. */
async function outcomeOf(promise) {
  try {
    const response = await promise;
    return {
      status: response.status,
      body: await response.json(),
      fallbackHeader: response.headers?.get?.('X-EF-Dashboard-Fallback') || null,
    };
  } catch (error) {
    return { rejected: error.name };
  }
}

async function guardScenarios() {
  const out = {};
  const noticeOf = window => window.document.getElementById('ef-dashboard-slow-notice');

  // A plans request that takes a while but does answer: the real plans arrive, and the page says so
  // while it waits. 150 ms here stands for 15 s: past the 5 s "slow" mark, short of giving up.
  let window = await guardedWindow(async target => {
    if (target === '/api/me/plans') {
      await sleep(150);
      return answer(200, { plans: [{ id: 'real-plan' }] });
    }
    return answer(200, {});
  });
  const slowButAnswers = outcomeOf(window.fetch('/api/me/plans'));
  await sleep(90);
  out.slowButAnswers = { noticeWhileWaiting: Boolean(noticeOf(window)) };
  Object.assign(out.slowButAnswers, await slowButAnswers);
  out.slowButAnswers.noticeAfter = Boolean(noticeOf(window));

  // One that never answers is cancelled, so the page gets a real failure, not an empty list.
  window = await guardedWindow(async target => {
    if (target.startsWith('/api/')) {
      await sleep(5000);
    }
    return answer(200, { plans: [{ id: 'too-late' }] });
  });
  const hung = {};
  for (const target of ['/api/me/plans', '/api/tickets']) {
    hung[target] = await outcomeOf(window.fetch(target));
  }
  out.neverAnswers = { ...hung, noticeAfter: Boolean(noticeOf(window)) };

  // The confirmed user and an existing CSRF token are real values, so they may stand in. The mock
  // rejects the instant the request is aborted, like a browser does: the stand-in must be handed
  // over before the abort or the caller gets the AbortError instead.
  const control = { meSlow: false };
  window = await guardedWindow(async target => {
    await sleep(5000);
    return answer(200, { target });
  }, control);
  control.meSlow = true;
  window.__CSRF_TOKEN__ = 'token-from-page';
  out.standIns = {
    me: await outcomeOf(window.fetch('/api/v1/auth/me')),
    csrf: await outcomeOf(window.fetch('/api/csrf-token')),
    csrfV1: await outcomeOf(window.fetch('/api/v1/csrf-token')),
  };

  // A CSRF cookie that is not valid percent-encoding must not break the stand-in (or the timers).
  window = await guardedWindow(async () => {
    await sleep(5000);
    return answer(200, {});
  });
  window.document.cookie = 'csrf=%E0%A4%A';
  out.malformedCsrfCookie = await outcomeOf(window.fetch('/api/csrf-token'));

  // A request that carries the caller's own AbortSignal is still cancelled at the cut-off, and the
  // caller can still cancel it themselves.
  window = await guardedWindow(async () => {
    await sleep(5000);
    return answer(200, { plans: [{ id: 'too-late' }] });
  });
  const patient = new window.AbortController();
  out.callerSignal = {
    cancelledAtCutOff: await outcomeOf(window.fetch('/api/me/plans', { signal: patient.signal })),
    noticeAfter: Boolean(noticeOf(window)),
  };
  const impatient = new window.AbortController();
  const callerCancels = outcomeOf(window.fetch('/api/me/plans', { signal: impatient.signal }));
  impatient.abort();
  out.callerSignal.cancelledByCaller = await callerCancels;
  const alreadyAborted = new window.AbortController();
  alreadyAborted.abort();
  out.callerSignal.alreadyAborted = await outcomeOf(
    window.fetch('/api/me/plans', { signal: alreadyAborted.signal })
  );

  // The background ticket refresh never shows "your dashboard is still loading"; it is still cut off.
  window = await guardedWindow(async () => {
    await sleep(5000);
    return answer(200, {});
  });
  const poll = outcomeOf(window.fetch('/api/tickets?limit=5'));
  await sleep(90); // well past the 3.5 s "slow" mark, before the cut-off
  out.ticketPoll = { noticeWhileSlow: Boolean(noticeOf(window)) };
  Object.assign(out.ticketPoll, await poll);
  // ...while a slow plans request on the same page does.
  const plansPoll = outcomeOf(window.fetch('/api/me/plans'));
  await sleep(90);
  out.ticketPoll.plansNoticeWhileSlow = Boolean(noticeOf(window));
  out.ticketPoll.plansNoticeIsLow = noticeOf(window)?.classList.contains('cdh-toast--slow');
  await plansPoll;

  // Paths nothing on the page asks for are not intercepted at all.
  window = await guardedWindow(async () => {
    await sleep(150);
    return answer(200, { passedThrough: true });
  });
  out.unguarded = await outcomeOf(window.fetch('/api/notifications'));

  // The start-up calls the dashboard makes before the guard has finished checking are covered too.
  const early = await loaded(windowWith('<main></main>'));
  early.fetch = browserLikeFetch(early, () => new Promise(() => {}));
  speedUp(early);
  early.eval(source('public/assets/js/dashboard-guard.js'));
  out.earlyInstall = {
    wrappedBeforeCheckEnds: early.__EF_CUSTOMER_DASHBOARD_FETCH_GUARD__ === true,
    // /api/v1/auth/me is hanging (the guard's own check); the page's own call is cut off too.
    pageCall: await outcomeOf(early.fetch('/api/me/plans')),
  };

  // The sign-in check itself: only a refusal redirects the customer dashboard.
  const customer = 'http://localhost/dashboard/customer';
  const customerUser = { user: { id: 'u1', role: 'customer' } };
  out.check = {
    signedIn: await guardCheck(customer, () => answer(200, customerUser)),
    refused: await guardCheck(customer, () => answer(401, {})),
    forbidden: await guardCheck(customer, () => answer(403, {})),
    serverDown: await guardCheck(customer, () => answer(503, {})),
    offline: await guardCheck(customer, () => {
      throw new Error('offline');
    }),
    hung: await guardCheck(customer, () => new Promise(() => {}), { settleMs: 900 }),
    recovers: await guardCheck(customer, attempt =>
      attempt < 3 ? answer(502, {}) : answer(200, customerUser)
    ),
    // Everything else keeps redirecting when the check cannot be completed.
    supplierServerDown: await guardCheck('http://localhost/dashboard/supplier', () =>
      answer(503, {})
    ),
    adminOffline: await guardCheck('http://localhost/admin', () => {
      throw new Error('offline');
    }),
    adminHung: await guardCheck('http://localhost/admin-users.html', () => new Promise(() => {}), {
      settleMs: 900,
    }),
  };
  return out;
}

/* -------------------------------------------------------------------------- *
 * Support card: a failed /api/tickets must not leave the skeleton up forever
 * -------------------------------------------------------------------------- */

/** Reply shaped like a real fetch Response, as ticketing.js reads it (status, ok and text()). */
const textReply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

let ticketRun = 0;

/** Loads customer-tickets.js (an ES module) against a fresh page and a scripted /api/tickets. */
async function ticketsCard(ticketReplies, { me, guardUser } = {}) {
  const { pathToFileURL } = require('url');
  const window = await loaded(
    windowWith(
      '<button id="createTicketBtn">New ticket</button><div id="tickets-cust"></div>',
      async url => {
        const target = String(url);
        if (target.includes('/api/v1/auth/me')) {
          return me ? me() : textReply(200, { user: { id: 'u1', firstName: 'Ann' } });
        }
        if (target.includes('/api/tickets')) {
          const next = ticketReplies.length > 1 ? ticketReplies.shift() : ticketReplies[0];
          return next();
        }
        return textReply(200, {});
      }
    )
  );
  if (guardUser) {
    window.__EF_DASHBOARD_USER__ = guardUser;
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.fetch = window.fetch;
  globalThis.HTMLElement = window.HTMLElement;
  ticketRun += 1;
  const moduleUrl = `${pathToFileURL(path.join(root, 'public/assets/js/customer-tickets.js')).href}?run=${ticketRun}`;
  await import(moduleUrl);
  const { default: ticketing } = await import(
    `${pathToFileURL(path.join(root, 'public/assets/js/ticketing.js')).href}?v=18.3.2`
  );
  const container = window.document.getElementById('tickets-cust');
  const text = () => container.textContent.replace(/\s+/g, ' ').trim();
  for (let tries = 0; tries < 50 && /^\s*$/.test(text()); tries += 1) {
    await sleep(20);
  }
  await sleep(60);
  return { window, container, text, ticketing };
}

async function ticketsScenarios() {
  const out = {};

  // /api/tickets answers 500: an error with a retry, not a skeleton and not "No support tickets yet".
  let broken = true;
  let card = await ticketsCard([
    () =>
      broken
        ? textReply(500, { error: 'boom' })
        : textReply(200, {
            tickets: [{ id: 't1', subject: 'Cake', message: 'Hello', status: 'open' }],
          }),
  ]);
  out.failing = {
    text: card.text(),
    skeleton: card.container.querySelector('.skeleton, [class*="skeleton"]') !== null,
    retryButton: Boolean(card.container.querySelector('[data-skeleton-retry]')),
  };

  // Trying again after the server recovers shows the real tickets.
  broken = false;
  card.container.querySelector('[data-skeleton-retry]').click();
  await sleep(120);
  out.afterRetry = { text: card.text() };
  card.ticketing.cleanup();

  // A signed-out answer is an error too, not an empty list.
  card = await ticketsCard([() => textReply(401, { error: 'Unauthorised' })]);
  out.signedOut = { text: card.text() };
  card.ticketing.cleanup();

  // A working request with no tickets still says there are none.
  card = await ticketsCard([() => textReply(200, { tickets: [] })]);
  out.noTickets = { text: card.text() };
  card.ticketing.cleanup();
  return out;
}

/* -------------------------------------------------------------------------- *
 * Summary row: guests tile, budget breakdown, checklist scope
 * -------------------------------------------------------------------------- */

const SUMMARY_MARKUP = `
  <p id="cdh-lede"></p><a id="cdh-next-action" href="/start" hidden></a>
  <a id="cdh-secondary-action" href="/suppliers"></a>
  <div id="cdh-summary-grid"></div>
  <div id="cdh-steps-body"></div><p id="cdh-steps-sub"></p>
  <div id="budget-settings-panel" hidden><input id="custom-budget-input"></div>`;

/** Loads the summary module into a window whose fetch is `fetchImpl`. */
function summaryWindow(fetchImpl) {
  const window = windowWith(SUMMARY_MARKUP, fetchImpl);
  window.eval(source('public/assets/js/utils/package-price.js'));
  window.eval(source('public/assets/js/pages/customer-dashboard-home.js'));
  return window;
}

/** The plain text of each summary tile. */
const tilesText = window =>
  [...window.document.querySelectorAll('#cdh-summary-grid .cdh-tile')].map(tile =>
    tile.textContent.replace(/\s+/g, ' ').trim()
  );

async function summaryScenarios() {
  const out = {};
  const plan = {
    id: 'p1',
    name: 'Our wedding',
    eventDate: '2027-06-19',
    guestCount: 80,
    budget: 5000,
    packages: ['pk1'],
    budgetItems: [{ category: 'Venue', estimated: 1000 }],
  };

  /** Fetch that answers the summary's three calls; `rsvp` is the rsvp-summary reply. */
  const fetchWith =
    ({ rsvp, urls = [], bulk }) =>
    async url => {
      const target = String(url);
      urls.push(target);
      if (target.includes('/milestones')) {
        return answer(200, {
          milestones: [
            { id: 'set-date', label: 'Set your event date', done: false, href: '/start' },
          ],
        });
      }
      if (target.includes('/api/packages/bulk')) {
        return bulk ? bulk() : answer(200, { packages: [{ id: 'pk1', price: '£400' }] });
      }
      if (target.includes('/rsvp-summary')) {
        return rsvp();
      }
      return answer(200, {});
    };

  /** The Guests tile text once the summary has drawn. */
  const guestsTileFor = async rsvp => {
    const window = summaryWindow(fetchWith({ rsvp }));
    await window.CustomerDashboardHome.render([plan]);
    return {
      tile: tilesText(window).find(text => text.startsWith('Guests')),
      retry: Boolean(window.document.querySelector('#cdh-summary-grid [data-retry-steps]')),
    };
  };

  out.guestsFailing = await guestsTileFor(() => answer(500, { error: 'boom' }));
  out.guestsNetworkError = await guestsTileFor(() => {
    throw new Error('offline');
  });
  out.guestsNoList = await guestsTileFor(() => answer(200, { summary: { totalGuests: 0 } }));
  out.guestsReplies = await guestsTileFor(() =>
    answer(200, { summary: { totalGuests: 4, responsesReceived: 2, partySizeTotal: 3 } })
  );

  // The Budget tile says how much of "committed" is packages, which the budget page leaves out.
  const urls = [];
  let window = summaryWindow(
    fetchWith({ rsvp: () => answer(200, { summary: { totalGuests: 0 } }), urls })
  );
  await window.CustomerDashboardHome.render([plan]);
  out.budgetWithPackages = tilesText(window).find(text => text.startsWith('Budget'));
  out.milestonesUrl = urls.find(url => url.includes('/milestones'));

  window = summaryWindow(
    fetchWith({ rsvp: () => answer(200, { summary: { totalGuests: 0 } }), urls: [] })
  );
  await window.CustomerDashboardHome.render([{ ...plan, packages: [] }]);
  out.budgetItemsOnly = tilesText(window).find(text => text.startsWith('Budget'));

  // The package prices could not be fetched: their cost is unknown, not zero, and the tile says so.
  const budgetTileWhen = async (bulk, thePlan) => {
    const w = summaryWindow(
      fetchWith({ rsvp: () => answer(200, { summary: { totalGuests: 0 } }), bulk })
    );
    await w.CustomerDashboardHome.render([thePlan]);
    return tilesText(w).find(text => text.startsWith('Budget'));
  };
  out.bulkFails = {
    status500: await budgetTileWhen(() => answer(500, {}), plan),
    networkError: await budgetTileWhen(() => {
      throw new Error('offline');
    }, plan),
    noBudgetSet: await budgetTileWhen(() => answer(500, {}), { ...plan, budget: 0 }),
    twoPackages: await budgetTileWhen(() => answer(500, {}), { ...plan, packages: ['pk1', 'pk2'] }),
  };

  // Quotes in a plan's id or name must not be able to add attributes to the markup around them.
  const hostile = 'x" onfocus="window.PWN=1" y="';
  window = summaryWindow(fetchWith({ rsvp: () => answer(200, { summary: { totalGuests: 0 } }) }));
  await window.CustomerDashboardHome.render([
    { id: hostile, name: hostile, budgetItems: [], packages: [] },
  ]);
  const grid = window.document.getElementById('cdh-summary-grid');
  out.escapedHome = {
    withAttribute: grid.querySelectorAll('[onfocus]').length,
    editPlanAttribute: grid.querySelector('[data-edit-plan]')?.getAttribute('data-edit-plan'),
  };

  return out;
}

/* -------------------------------------------------------------------------- *
 * The dashboard start-up script: blocked storage, failed plans, flaky sign-in check
 * -------------------------------------------------------------------------- */

const PAGE_MARKUP = `
  <h1 id="welcome-heading"></h1>
  <div class="cdh-hero"></div>
  <a id="cdh-new-plan" href="/start">New plan</a>
  <div id="customer-plans-list"></div>
  <div id="saved-suppliers-status"></div><button id="openPlanBtn">View saved suppliers</button>
  <p id="cdh-lede"></p><a id="cdh-next-action" href="/start" hidden></a>
  <a id="cdh-secondary-action" href="/suppliers"></a>
  <div id="cdh-summary-grid"></div>
  <div id="cdh-steps-body"></div><p id="cdh-steps-sub"></p>
  <div id="budget-settings-panel" hidden>
    <form id="budget-settings-form"><input id="custom-budget-input"><button type="submit">Save</button></form>
    <p id="budget-status"></p><button id="budget-settings-cancel" type="button">Cancel</button>
  </div>`;

const waitFor = async (check, timeoutMs = 4000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      return true;
    }
    await sleep(20);
  }
  return false;
};

/**
 * Starts the dashboard page script against a scripted server.
 * `server` can set: me (function returning a reply or throwing), plans (function), patches (array).
 */
async function openPage(server, { beforeScripts } = {}) {
  const calls = {
    plans: 0,
    patches: [],
    me: 0,
    navigations: 0,
    claims: 0,
    deletes: [],
    shortlist: 0,
  };
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    if (target.includes('/api/v1/auth/me')) {
      calls.me += 1;
      return server.me(calls.me);
    }
    if (target.includes('/api/csrf-token')) {
      return answer(200, { csrfToken: 'token' });
    }
    if (/\/api\/me\/plans\/[^/]+\/rsvp-summary/.test(target)) {
      return answer(200, { summary: { totalGuests: 0 } });
    }
    if (/\/api\/me\/plans\/[^/]+$/.test(target) && method === 'PATCH') {
      calls.patches.push(JSON.parse(options.body));
      return answer(200, { plan: {} });
    }
    if (target.endsWith('/api/me/plans/claim') && method === 'POST') {
      calls.claims += 1;
      return server.claim ? server.claim(calls.claims) : answer(200, { ok: true });
    }
    if (/\/api\/me\/plans\/[^/]+$/.test(target) && method === 'DELETE') {
      calls.deletes.push(target);
      return answer(200, {});
    }
    if (target.includes('/api/me/plans')) {
      calls.plans += 1;
      return server.plans(calls.plans);
    }
    if (target.includes('/api/v1/customer/milestones')) {
      return answer(200, {
        milestones: [{ id: 'set-date', label: 'Set your event date', done: false, href: '/start' }],
      });
    }
    if (target.includes('/api/packages/bulk')) {
      return answer(200, { packages: [] });
    }
    if (target.includes('/api/v1/shortlist')) {
      calls.shortlist += 1;
      return server.shortlist
        ? server.shortlist(calls.shortlist)
        : answer(200, { data: { items: [] } });
    }
    return answer(200, {});
  };

  const window = await loaded(windowWith(PAGE_MARKUP, fetchImpl));
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    if (this.hasAttribute('open')) {
      this.removeAttribute('open');
      this.dispatchEvent(new window.Event('close'));
    }
  };
  if (beforeScripts) {
    beforeScripts(window);
  }
  loadAuthState(window);
  window.addEventListener('beforeunload', () => {
    calls.navigations += 1;
  });
  window.eval(source('public/assets/js/utils/package-price.js'));
  window.eval(source('public/assets/js/pages/customer-dashboard-home.js'));
  window.eval(source('public/assets/js/pages/dashboard-customer-init.js'));
  const text = id => window.document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
  return { window, calls, text };
}

const okMe = () => answer(200, { user: { id: 'u1', firstName: 'Ann', verified: true } });
const wedding = { id: 'p1', name: 'Our wedding', eventDate: '2027-06-19', location: 'Bristol' };
const plansReply = plans => () => answer(200, { plans, limit: 3 });

async function pageScenarios() {
  const out = {};
  const blockStorage = window => {
    const blocked = () => {
      throw new window.DOMException('The operation is insecure.', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: blocked, configurable: true });
    Object.defineProperty(window, 'sessionStorage', { get: blocked, configurable: true });
  };

  // Storage that throws on every access (private modes, strict settings).
  let page = await openPage(
    { me: okMe, plans: plansReply([wedding]) },
    { beforeScripts: blockStorage }
  );
  await waitFor(
    () => page.window.document.getElementById('saved-suppliers-status').children.length
  );
  await waitFor(() => page.window.document.querySelectorAll('#cdh-summary-grid .cdh-tile').length);
  const input = page.window.document.getElementById('custom-budget-input');
  input.value = '7500';
  page.window.document
    .getElementById('budget-settings-form')
    .dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => page.text('budget-status'));
  out.storageBlocked = {
    welcome: page.text('welcome-heading'),
    plans: page.text('customer-plans-list'),
    tiles: page.window.document.querySelectorAll('#cdh-summary-grid .cdh-tile').length,
    saved: page.text('saved-suppliers-status'),
    patches: page.calls.patches,
    budgetStatus: page.text('budget-status'),
  };

  // Storage that reads fine but is full when written to.
  page = await openPage(
    { me: okMe, plans: plansReply([wedding]) },
    {
      beforeScripts: window => {
        window.Storage.prototype.setItem = () => {
          throw new window.DOMException('The quota has been exceeded.', 'QuotaExceededError');
        };
      },
    }
  );
  await waitFor(
    () => page.window.document.getElementById('saved-suppliers-status').children.length
  );
  page.window.document.getElementById('custom-budget-input').value = '9000';
  page.window.document
    .getElementById('budget-settings-form')
    .dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => page.text('budget-status'));
  out.storageFull = { patches: page.calls.patches, budgetStatus: page.text('budget-status') };

  // The plans request fails: an honest error with a retry, never "No plans yet".
  let plansWork = false;
  page = await openPage({
    me: okMe,
    plans: () =>
      plansWork ? answer(200, { plans: [wedding], limit: 3 }) : answer(500, { error: 'boom' }),
  });
  await waitFor(
    () => page.window.document.getElementById('saved-suppliers-status').children.length
  );
  await waitFor(() => page.text('cdh-summary-grid'));
  const plansBefore = page.calls.plans;
  out.plansFailing = {
    plans: page.text('customer-plans-list'),
    summary: page.text('cdh-summary-grid'),
    lede: page.text('cdh-lede'),
    retryButton: Boolean(page.window.document.querySelector('[data-retry-plans]')),
    plansRequests: plansBefore,
  };
  plansWork = true;
  page.window.document.querySelector('[data-retry-plans]').click();
  await waitFor(() => /Our wedding/.test(page.text('customer-plans-list')));
  out.plansRetried = { plans: page.text('customer-plans-list'), lede: page.text('cdh-lede') };

  // A refresh that fails after plans were loaded keeps them.
  let refreshFails = false;
  page = await openPage({
    me: okMe,
    plans: () =>
      refreshFails ? answer(500, { error: 'boom' }) : answer(200, { plans: [wedding], limit: 3 }),
  });
  await waitFor(() => /Our wedding/.test(page.text('customer-plans-list')));
  refreshFails = true;
  page.window.document.dispatchEvent(new page.window.CustomEvent('cdh:reload'));
  await sleep(300);
  out.refreshFails = {
    plans: page.text('customer-plans-list'),
    notice: page.window.document.querySelector('.cdh-toast')?.textContent || '',
  };

  // Sign-in check: a dropped connection is retried and then carries on.
  page = await openPage({
    me: attempt => {
      if (attempt < 3) {
        throw new Error('network down');
      }
      return okMe();
    },
    plans: plansReply([wedding]),
  });
  await waitFor(() => page.text('welcome-heading'), 6000);
  out.authBlip = { welcome: page.text('welcome-heading'), meRequests: page.calls.me };

  // Sign-in check keeps failing, but the guard already confirmed the person: carry on.
  page = await openPage(
    { me: () => answer(503, {}), plans: plansReply([wedding]) },
    {
      beforeScripts: window =>
        (window.__EF_DASHBOARD_USER__ = { id: 'u1', firstName: 'Guard', verified: true }),
    }
  );
  await waitFor(() => page.text('welcome-heading'), 6000);
  out.authDownGuardUser = { welcome: page.text('welcome-heading'), meRequests: page.calls.me };

  // ...and with nobody confirmed it says so, with a retry, and does not leave the page.
  page = await openPage({ me: () => answer(503, {}), plans: plansReply([wedding]) });
  await waitFor(() => page.window.document.getElementById('cdh-signin-check-error'), 6000);
  out.authDownNobody = {
    banner: page.window.document.getElementById('cdh-signin-check-error')?.textContent || '',
    plansRequests: page.calls.plans,
    welcome: page.text('welcome-heading'),
  };

  // A refusal (401) is a real sign-out: no banner, nothing loaded.
  page = await openPage({ me: () => answer(401, {}), plans: plansReply([wedding]) });
  await sleep(300);
  out.authRefused = {
    meRequests: page.calls.me,
    banner: Boolean(page.window.document.getElementById('cdh-signin-check-error')),
    plansRequests: page.calls.plans,
  };

  // Plan editor: closing with unsaved edits asks first.
  page = await openPage({ me: okMe, plans: plansReply([wedding]) });
  await waitFor(() => /Our wedding/.test(page.text('customer-plans-list')));
  const { document } = page.window;
  document.dispatchEvent(
    new page.window.CustomEvent('cdh:edit-plan', { detail: { planId: 'p1', field: '' } })
  );
  const dialog = () => document.getElementById('cdh-plan-edit-dialog');
  const click = element =>
    element.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const cancelButton = () => dialog().querySelector('.cdh-dialog__foot [data-dialog-close]');
  const state = () => ({
    open: Boolean(dialog()),
    cancelLabel: dialog() ? cancelButton().textContent.trim() : null,
    status: dialog() ? dialog().querySelector('#cdh-pf-status').textContent.trim() : null,
  });
  // Untouched: Cancel closes straight away.
  click(cancelButton());
  out.editUntouched = state();

  document.dispatchEvent(
    new page.window.CustomEvent('cdh:edit-plan', { detail: { planId: 'p1', field: '' } })
  );
  const name = dialog().querySelector('#cdh-pf-name');
  name.value = 'Our big wedding';
  name.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  click(cancelButton());
  out.editFirstCancel = state();
  // Escape asks the same way while it is armed it lets go.
  const escape = new page.window.Event('cancel', { cancelable: true });
  dialog().dispatchEvent(escape);
  out.editEscapeWhileArmed = { prevented: escape.defaultPrevented };
  // Typing again disarms it.
  name.value = 'Our biggest wedding';
  name.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  out.editTypedAgain = state();
  click(dialog().querySelector('.cdh-dialog__close'));
  out.editCrossWhenDisarmed = state();
  click(cancelButton());
  out.editDiscard = state();
  return out;
}

/* -------------------------------------------------------------------------- *
 * JadeAssist launcher badge and consent-gated storage
 * -------------------------------------------------------------------------- */

/** Runs the launcher polish script on a page at `url` that already has a mounted launcher. */
async function launcherBadgeStyle(url) {
  const window = await loaded(windowWith('', undefined, { url }));
  const host = window.document.createElement('div');
  host.className = 'jade-widget-root';
  host.attachShadow({ mode: 'open' }).innerHTML =
    '<div class="jade-widget-container"><button class="jade-avatar-button">' +
    '<span class="jade-avatar-badge" aria-label="1 new notification">1</span></button></div>';
  window.document.body.appendChild(host);
  window.eval(source('public/assets/js/jadeassist-launcher-polish.js'));
  await sleep(30);
  const style = host.shadowRoot.getElementById('eventflow-jadeassist-launcher-polish');
  return /\.jade-avatar-badge\s*\{\s*display:\s*none\s*!important/.test(style?.textContent || '');
}

/** Pages' remembered choices when functional storage is declined / accepted / no banner. */
async function consentScenarios() {
  const out = {};
  const consent = functional => ({ getConsent: () => ({ essential: true, functional }) });

  /** Loads the account-type notice, clicks dismiss, and says whether the dismissal was stored. */
  async function noticeDismissed(cookieConsent) {
    const window = await loaded(
      windowWith(
        '<div id="account-type-notice" hidden><button id="account-type-notice-dismiss">x</button></div>'
      )
    );
    if (cookieConsent) {
      window.CookieConsent = cookieConsent;
    }
    loadAuthState(window);
    window.eval(source('public/assets/js/pages/dashboard-account-type-notice.js'));
    window.document.getElementById('account-type-notice-dismiss').click();
    return window.localStorage.getItem('ef_account_type_notice_dismissed') === '1';
  }
  out.noticeDeclined = await noticeDismissed(consent(false));
  out.noticeAccepted = await noticeDismissed(consent(true));
  out.noticeNoBanner = await noticeDismissed(null);

  /** Saves a budget on the dashboard and says whether the browser copy was stored. */
  async function budgetCopyStored(cookieConsent) {
    const page = await openPage(
      { me: okMe, plans: plansReply([wedding]) },
      {
        beforeScripts: window => {
          if (cookieConsent) {
            window.CookieConsent = cookieConsent;
          }
        },
      }
    );
    await waitFor(
      () => page.window.document.getElementById('saved-suppliers-status').children.length
    );
    page.window.document.getElementById('custom-budget-input').value = '4000';
    page.window.document
      .getElementById('budget-settings-form')
      .dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
    await waitFor(() => page.text('budget-status'));
    return {
      stored: page.window.localStorage.getItem('eventflow_custom_budget'),
      patches: page.calls.patches,
      status: page.text('budget-status'),
    };
  }
  out.budgetDeclined = await budgetCopyStored(consent(false));
  out.budgetAccepted = await budgetCopyStored(consent(true));

  // Another account signing in on the same browser does not inherit the device-only figures.
  const window = await loaded(windowWith(''));
  const keys = [
    'eventflow_custom_budget',
    'eventflow_saved_suppliers',
    'ef_budget_v2',
    'ef_budget',
    'ef_budget_imported',
    'ef_customer_plan',
    'ef_account_type_notice_dismissed',
    'eventflow_guest_plan_token',
  ];
  keys.forEach(key => window.localStorage.setItem(key, 'x'));
  window.localStorage.setItem('eventflow_device_data_owner', 'u1');
  window.eval(source('public/assets/js/utils/auth-state.js'));
  window.__authState.scopeDeviceData({ id: 'u2' });
  out.accountSwitch = Object.fromEntries(keys.map(key => [key, window.localStorage.getItem(key)]));

  // What "Reject" in the real cookie banner forgets: set every key, load the banner script, reject.
  const allKeys = [...keys, 'theme', 'ef_onboarding_dismissed'];
  const rejecting = await loaded(windowWith(''));
  allKeys.forEach(key => rejecting.localStorage.setItem(key, 'x'));
  rejecting.eval(source('public/assets/js/cookie-consent.js'));
  rejecting.document.getElementById('cookie-consent-reject').click();
  out.rejectKeeps = allKeys.filter(key => rejecting.localStorage.getItem(key) !== null);
  out.rejectForgets = allKeys.filter(key => rejecting.localStorage.getItem(key) === null);

  // The one place that decides whether a remembered choice may be kept.
  const gateFor = async ({ consent, banner }) => {
    const window = await loaded(
      windowWith(banner ? '<script src="/assets/js/cookie-consent.js?v=3.0.2"></script>' : '')
    );
    if (consent) {
      window.CookieConsent = consent;
    }
    loadAuthState(window);
    return window.efMayKeepFunctionalStorage();
  };
  out.gate = {
    accepted: await gateFor({ consent: { getConsent: () => ({ functional: true }) } }),
    declined: await gateFor({ consent: { getConsent: () => ({ functional: false }) } }),
    notChosenYet: await gateFor({ consent: { getConsent: () => ({}) } }),
    throws: await gateFor({
      consent: {
        getConsent() {
          throw new Error('boom');
        },
      },
    }),
    noBannerOnPage: await gateFor({}),
    bannerScriptNotRunYet: await gateFor({ banner: true }),
  };
  return out;
}

async function badgeScenarios() {
  const out = { consent: await consentScenarios() };
  out.quietOn = {};
  for (const route of ['/dashboard/customer', '/dashboard-customer.html', '/budget', '/guests']) {
    out.quietOn[route] = await launcherBadgeStyle(`http://localhost${route}`);
  }
  out.shownOn = {};
  for (const route of ['/', '/suppliers', '/dashboard/supplier']) {
    out.shownOn[route] = await launcherBadgeStyle(`http://localhost${route}`);
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Review fixes: the Support card's sign-in check and poller, the start-up script's guest-plan
 * claim, budget form, saved suppliers, retries and escaping, and the device-data ordering
 * -------------------------------------------------------------------------- */

/** Runs `work` with every timer of 5 s or more recorded instead of scheduled; returns the delays. */
async function withRecordedTimers(work) {
  const realSetTimeout = globalThis.setTimeout;
  const recorded = { delays: [], fire: [] };
  globalThis.setTimeout = (callback, ms, ...rest) => {
    if (ms >= 5000) {
      recorded.delays.push(ms);
      recorded.fire.push(callback);
      return 0;
    }
    return realSetTimeout(callback, ms, ...rest);
  };
  try {
    await work(recorded);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  return recorded;
}

async function ticketFixScenarios() {
  const out = {};
  const tickets = [{ id: 't1', subject: 'Cake', message: 'Hello', status: 'open' }];
  const created = window => Boolean(window.document.getElementById('createTicketForm'));

  // The sign-in check fails (dropped connection) but the guard already confirmed the person.
  let card = await ticketsCard([() => textReply(200, { tickets })], {
    me: () => textReply(503, {}),
    guardUser: { id: 'u1', firstName: 'Ann' },
  });
  out.checkFailsGuardUser = { text: card.text() };
  card.ticketing.cleanup();

  // The check fails and nobody is confirmed: an error with a retry, never "Sign in to view
  // tickets"; the New ticket button works; trying again once the check recovers shows the tickets.
  let meWorks = false;
  card = await ticketsCard([() => textReply(200, { tickets })], {
    me: () => (meWorks ? textReply(200, { user: { id: 'u1' } }) : textReply(503, {})),
  });
  out.checkFails = {
    text: card.text(),
    retryButton: Boolean(card.container.querySelector('[data-skeleton-retry]')),
  };
  card.window.document.getElementById('createTicketBtn').click();
  out.checkFails.newTicketOpens = created(card.window);
  meWorks = true;
  card.container.querySelector('[data-skeleton-retry]')?.click();
  await sleep(150);
  out.checkFails.afterRetry = card.text();
  card.ticketing.cleanup();

  // The check throws.
  card = await ticketsCard([() => textReply(200, { tickets })], {
    me: () => {
      throw new Error('offline');
    },
  });
  out.checkThrows = { text: card.text() };
  card.ticketing.cleanup();

  // A list that has loaded stays on screen when a later refresh fails, with a note.
  let reply = () => textReply(200, { tickets });
  let recorded = await withRecordedTimers(async timers => {
    card = await ticketsCard([() => reply()]);
    out.staleList = { before: card.text() };
    reply = () => textReply(500, { error: 'boom' });
    timers.fire.shift()?.();
    await sleep(100);
    out.staleList.after = card.text();
    reply = () => textReply(401, { error: 'Unauthorised' });
    timers.fire.shift()?.();
    await sleep(100);
    out.staleList.afterRefusal = card.text();
    // The poller did not give up for good: it is still scheduled, and recovers.
    reply = () => textReply(200, { tickets });
    timers.fire.shift()?.();
    await sleep(100);
    out.staleList.recovered = card.text();
  });
  out.staleList.delays = recorded.delays;
  card.ticketing.cleanup();

  // A refusal before anything loaded: an error that says so, and polling carries on (slowly).
  reply = () => textReply(401, { error: 'Unauthorised' });
  recorded = await withRecordedTimers(async timers => {
    card = await ticketsCard([() => reply()]);
    out.refusedFirst = { text: card.text() };
    reply = () => textReply(200, { tickets });
    timers.fire.shift()?.();
    await sleep(100);
    out.refusedFirst.recovered = card.text();
  });
  out.refusedFirst.delays = recorded.delays;
  card.ticketing.cleanup();

  // Failing polls wait longer each time and never less than a healthy one (60 s here).
  reply = () => textReply(500, { error: 'boom' });
  recorded = await withRecordedTimers(async timers => {
    card = await ticketsCard([() => reply()]);
    for (let i = 0; i < 3; i += 1) {
      timers.fire.shift()?.();
      await sleep(60);
    }
  });
  out.backoffOnTicketCard = recorded.delays;
  card.ticketing.cleanup();

  // The same for a poller on the default 5 s interval, and the old stop-on-refusal for callers that
  // do not handle failures themselves (the supplier dashboard's ticket card).
  card = await ticketsCard([() => textReply(200, { tickets })]);
  recorded = await withRecordedTimers(async timers => {
    card.ticketing.createPoller(
      async () => {
        throw new Error('down');
      },
      () => {},
      {}
    );
    await sleep(20);
    for (let i = 0; i < 4; i += 1) {
      timers.fire.shift()?.();
      await sleep(20);
    }
  });
  out.backoffDefault = recorded.delays;

  reply = () => textReply(401, { error: 'Unauthorised' });
  card.window.fetch = async () => reply();
  globalThis.fetch = card.window.fetch;
  const callbackArgs = [];
  recorded = await withRecordedTimers(async () => {
    card.ticketing.listenToUserTickets('u1', 'supplier', value => callbackArgs.push(value), 5);
    await sleep(80);
  });
  out.refusedWithoutErrorHandler = { callbackArgs, timersScheduled: recorded.delays };
  card.ticketing.cleanup();
  return out;
}

/** The start-up script and its cards, one scenario per review finding. */
async function fixScenarios() {
  const out = {};

  /* ---- H2: the guest-plan token is only dropped on a final answer ---- */
  const claimWith = async reply => {
    const page = await openPage(
      { me: okMe, plans: plansReply([wedding]), claim: reply },
      {
        beforeScripts: window => window.localStorage.setItem('eventflow_guest_plan_token', 'GUEST'),
      }
    );
    await waitFor(() => page.calls.plans >= 1);
    await sleep(30);
    return {
      token: page.window.localStorage.getItem('eventflow_guest_plan_token'),
      claims: page.calls.claims,
    };
  };
  const notJson = status => () => ({
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });
  out.claim = {
    claimed: await claimWith(() => answer(200, { ok: true })),
    alreadyHasPlan: await claimWith(() => answer(400, { error: 'You already have a plan.' })),
    notFound: await claimWith(() => answer(404, { error: 'not found or already claimed' })),
    conflict: await claimWith(() => answer(409, { error: 'conflict' })),
    proxyPage502: await claimWith(notJson(502)),
    proxyPage504: await claimWith(notJson(504)),
    unavailable503: await claimWith(() => answer(503, { error: 'busy' })),
    serverError500: await claimWith(() => answer(500, { error: 'boom' })),
    tooMany429: await claimWith(() => answer(429, { error: 'slow down' })),
    offline: await claimWith(() => {
      throw new Error('offline');
    }),
    csrfRefusedThenOk: await claimWith(n =>
      n === 1 ? answer(403, { error: 'Invalid CSRF token' }) : answer(200, { ok: true })
    ),
    csrfRefusedAlways: await claimWith(() => answer(403, { error: 'Invalid CSRF token' })),
  };

  /* ---- M1: the budget form when the plans never loaded ---- */
  const budgetWhenPlansFail = async ({ consent, recovers = false, retryFromStatus = false }) => {
    let working = false;
    const page = await openPage(
      {
        me: okMe,
        plans: () =>
          working ? answer(200, { plans: [wedding], limit: 3 }) : answer(500, { error: 'boom' }),
      },
      {
        beforeScripts: window => {
          if (consent !== undefined) {
            window.CookieConsent = { getConsent: () => ({ essential: true, functional: consent }) };
          }
        },
      }
    );
    const { document } = page.window;
    await waitFor(() => page.text('cdh-summary-grid'));
    page.window.__before = { lede: page.text('cdh-lede'), summary: page.text('cdh-summary-grid') };
    document.getElementById('custom-budget-input').value = '5000';
    working = recovers;
    document
      .getElementById('budget-settings-form')
      .dispatchEvent(new page.window.Event('submit', { cancelable: true, bubbles: true }));
    await waitFor(() => {
      const status = page.text('budget-status');
      return status && !/^Loading/u.test(status);
    });
    const result = {
      status: page.text('budget-status'),
      patches: page.calls.patches,
      lede: page.text('cdh-lede'),
      summary: page.text('cdh-summary-grid'),
      retryInStatus: Boolean(document.querySelector('#budget-status button')),
      listError: page.text('customer-plans-list'),
    };
    if (retryFromStatus) {
      working = true;
      const retry = document.querySelector('#budget-status button');
      retry?.click();
      retry?.click();
      await waitFor(() => /Our wedding/u.test(page.text('customer-plans-list')));
      await sleep(30);
      result.afterStatusRetry = {
        status: page.text('budget-status'),
        plans: page.text('customer-plans-list'),
        plansRequests: page.calls.plans,
      };
    }
    return result;
  };
  out.budgetPlansFailed = await budgetWhenPlansFail({ retryFromStatus: true });
  out.budgetPlansFailedDeclined = await budgetWhenPlansFail({ consent: false });
  out.budgetPlansFailedThenLoads = await budgetWhenPlansFail({ recovers: true });

  // The plans did load and there are none: only then is "no plan" the true reason.
  const noPlan = await openPage(
    { me: okMe, plans: plansReply([]) },
    { beforeScripts: w => (w.CookieConsent = { getConsent: () => ({ functional: false }) }) }
  );
  await waitFor(() => noPlan.text('cdh-lede'));
  noPlan.window.document.getElementById('custom-budget-input').value = '5000';
  noPlan.window.document
    .getElementById('budget-settings-form')
    .dispatchEvent(new noPlan.window.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => noPlan.text('budget-status'));
  out.budgetNoPlanDeclined = {
    status: noPlan.text('budget-status'),
    patches: noPlan.calls.patches,
  };

  /* ---- M2: saved suppliers when the request itself fails ---- */
  const savedCard = async ({ shortlist, copy }) => {
    const page = await openPage(
      { me: okMe, plans: plansReply([wedding]), shortlist },
      {
        beforeScripts: window => {
          if (copy) {
            window.localStorage.setItem('eventflow_saved_suppliers', JSON.stringify(copy));
          }
        },
      }
    );
    await waitFor(
      () => page.window.document.getElementById('saved-suppliers-status').children.length
    );
    return page;
  };
  const savedState = page => ({
    text: page.text('saved-suppliers-status'),
    retry: Boolean(page.window.document.querySelector('[data-retry-saved]')),
    viewButtonHidden: page.window.document.getElementById('openPlanBtn').hidden,
  });
  const offline = () => {
    throw new Error('offline');
  };
  out.saved = {
    networkErrorNoCopy: savedState(await savedCard({ shortlist: offline })),
    networkErrorWithCopy: savedState(await savedCard({ shortlist: offline, copy: ['s1', 's2'] })),
    serverError: savedState(await savedCard({ shortlist: () => answer(500, {}) })),
  };
  let recovered = false;
  const retried = await savedCard({
    shortlist: () =>
      recovered
        ? answer(200, {
            data: { items: [{ supplierId: 's1', name: 'Cake Co', type: 'supplier' }] },
          })
        : offline(),
  });
  const shortlistBefore = retried.calls.shortlist;
  recovered = true;
  const savedRetry = retried.window.document.querySelector('[data-retry-saved]');
  savedRetry?.click();
  savedRetry?.click();
  await waitFor(() => /Cake Co/u.test(retried.text('saved-suppliers-status')));
  out.saved.retry = {
    text: retried.text('saved-suppliers-status'),
    extraRequests: retried.calls.shortlist - shortlistBefore,
  };

  /* ---- retries: one click, one request ---- */
  let working = false;
  let page = await openPage({
    me: okMe,
    plans: () =>
      working ? answer(200, { plans: [wedding], limit: 3 }) : answer(500, { error: 'boom' }),
  });
  await waitFor(() => page.window.document.querySelector('[data-retry-plans]'));
  await waitFor(() => page.window.document.querySelector('#cdh-summary-grid [data-retry-steps]'));
  await sleep(50);
  working = true;
  let before = page.calls.plans;
  const plansRetry = page.window.document.querySelector('[data-retry-plans]');
  plansRetry?.click();
  plansRetry?.click();
  await waitFor(() => /Our wedding/u.test(page.text('customer-plans-list')));
  await sleep(50);
  out.retryOnce = { plans: page.calls.plans - before };

  working = false;
  page = await openPage({
    me: okMe,
    plans: () =>
      working ? answer(200, { plans: [wedding], limit: 3 }) : answer(500, { error: 'boom' }),
  });
  await waitFor(() => page.window.document.querySelector('#cdh-steps-body [data-retry-steps]'));
  await sleep(50);
  before = page.calls.plans;
  const stepsRetry = page.window.document.querySelector('#cdh-steps-body [data-retry-steps]');
  stepsRetry?.click();
  stepsRetry?.click();
  await sleep(300);
  out.retryOnce.steps = page.calls.plans - before;

  // The sign-in banner's retry: one click starts one check, and focus stays on the retry button.
  page = await openPage({ me: () => answer(503, {}), plans: plansReply([wedding]) });
  await waitFor(() => page.window.document.getElementById('cdh-signin-check-error'), 6000);
  before = page.calls.me;
  const bannerRetry = page.window.document.querySelector('#cdh-signin-check-error button');
  bannerRetry?.focus();
  bannerRetry?.click();
  bannerRetry?.click();
  const disabledWhileChecking = bannerRetry?.disabled;
  await waitFor(
    () =>
      page.calls.me - before >= 3 &&
      page.window.document.querySelector('#cdh-signin-check-error button:not(:disabled)'),
    6000
  );
  await sleep(100);
  const newRetry = page.window.document.querySelector('#cdh-signin-check-error button');
  out.signInRetry = {
    disabledWhileChecking,
    checks: page.calls.me - before,
    focusOnNewRetry: page.window.document.activeElement === newRetry,
    banners: page.window.document.querySelectorAll('#cdh-signin-check-error').length,
  };

  /* ---- the plan editor: Escape on an edited form asks first ---- */
  page = await openPage({ me: okMe, plans: plansReply([wedding]) });
  await waitFor(() => /Our wedding/u.test(page.text('customer-plans-list')));
  const doc = page.window.document;
  doc.dispatchEvent(
    new page.window.CustomEvent('cdh:edit-plan', { detail: { planId: 'p1', field: '' } })
  );
  const nameField = doc.querySelector('#cdh-pf-name');
  nameField.value = 'Changed';
  nameField.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  const firstEscape = new page.window.Event('cancel', { cancelable: true });
  doc.getElementById('cdh-plan-edit-dialog').dispatchEvent(firstEscape);
  out.escapeOnDirtyForm = {
    firstPrevented: firstEscape.defaultPrevented,
    stillOpen: Boolean(doc.getElementById('cdh-plan-edit-dialog')),
    cancelLabel: doc.querySelector('.cdh-dialog__foot [data-dialog-close]').textContent.trim(),
    status: doc.getElementById('cdh-pf-status').textContent.trim(),
  };
  const secondEscape = new page.window.Event('cancel', { cancelable: true });
  doc.getElementById('cdh-plan-edit-dialog').dispatchEvent(secondEscape);
  out.escapeOnDirtyForm.secondPrevented = secondEscape.defaultPrevented;
  // A form nobody has typed in closes on the first Escape.
  doc.getElementById('cdh-plan-edit-dialog').remove();
  doc.dispatchEvent(
    new page.window.CustomEvent('cdh:edit-plan', { detail: { planId: 'p1', field: '' } })
  );
  const cleanEscape = new page.window.Event('cancel', { cancelable: true });
  doc.getElementById('cdh-plan-edit-dialog').dispatchEvent(cleanEscape);
  out.escapeOnDirtyForm.cleanPrevented = cleanEscape.defaultPrevented;

  /* ---- a deleted plan does not come back when the refresh after it fails ---- */
  const hen = { id: 'p2', name: 'Hen weekend', eventDate: '2027-09-04', location: 'Bath' };
  let refreshFails = false;
  page = await openPage({
    me: okMe,
    plans: () =>
      refreshFails
        ? answer(500, { error: 'boom' })
        : answer(200, { plans: [wedding, hen], limit: 3 }),
  });
  await waitFor(() => /Hen weekend/u.test(page.text('customer-plans-list')));
  refreshFails = true;
  page.window.document.querySelector('.plan-delete-btn[data-plan-id="p2"]')?.click();
  page.window.document.getElementById('cdh-del-confirm')?.click();
  await waitFor(() => page.window.document.querySelector('.cdh-toast'));
  await sleep(100);
  out.deletedPlan = {
    deleteRequests: page.calls.deletes.length,
    plans: page.text('customer-plans-list'),
    notice: page.window.document.querySelector('.cdh-toast')?.textContent || '',
  };

  /* ---- a plan name cannot add attributes to the markup around it ---- */
  const hostile = 'a" onfocus="window.PWN=1" x="';
  page = await openPage({
    me: okMe,
    plans: plansReply([{ ...wedding, name: hostile, location: hostile }]),
  });
  await waitFor(() => page.window.document.querySelector('.plan-edit-btn'));
  const list = page.window.document.getElementById('customer-plans-list');
  const editButton = list.querySelector('.plan-edit-btn');
  editButton?.click();
  const editName = page.window.document.querySelector('#cdh-pf-name');
  out.escapedName = {
    attributesInList: list.querySelectorAll('[onfocus]').length,
    ariaLabel: editButton?.getAttribute('aria-label'),
    attributesInDialog: page.window.document
      .getElementById('cdh-plan-edit-dialog')
      .querySelectorAll('[onfocus]').length,
    inputValue: editName?.value,
    hostile,
  };
  return out;
}

/* -------------------------------------------------------------------------- *
 * Device-only data is cleared (for a different account) before the pages read it
 * -------------------------------------------------------------------------- */

/** Loads a real page from public/ in jsdom with the given scripts, and returns its window. */
async function realPage(file, url, { fetchImpl, preload, scripts }) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false });
  window.__CSRF_TOKEN__ = 'token';
  if (preload) {
    preload(window);
  }
  window.fetch = fetchImpl;
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  scripts.forEach(rel => window.eval(source(rel)));
  if (window.document.readyState !== 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  return window;
}

async function deviceDataScenarios() {
  const out = {};
  const SECOND_ACCOUNT_AFTER_MS = 150;
  /** Plans answer at once; the sign-in check answers later, so the plans arrive first. */
  const fetchFor =
    owner =>
    async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/api/v1/auth/me')) {
        await sleep(SECOND_ACCOUNT_AFTER_MS);
        return answer(200, { user: { id: owner, role: 'customer' } });
      }
      if (target.endsWith('/api/me/plans')) {
        return answer(200, { plans: options.plans || [] });
      }
      return answer(200, {});
    };
  const preloaded = window => {
    window.localStorage.setItem('eventflow_device_data_owner', 'u1');
    window.localStorage.setItem('ef_budget_v2', JSON.stringify({ total: 9999, items: [] }));
  };

  // Budget page: u1 left a device budget of £9,999; u2 signs in. u2 must not see it, whichever
  // answer (plans or sign-in check) comes back first.
  for (const [label, owner] of [
    ['secondAccount', 'u2'],
    ['sameAccount', 'u1'],
  ]) {
    const window = await realPage('public/budget.html', 'http://localhost/budget', {
      fetchImpl: fetchFor(owner),
      preload: preloaded,
      scripts: [
        'public/assets/js/utils/auth-state.js',
        'public/assets/js/budget-calc.js',
        'public/assets/js/pages/budget-page.js',
      ],
    });
    await sleep(SECOND_ACCOUNT_AFTER_MS + 250);
    out[`budget_${label}`] = {
      showsOldFigure: window.document.body.textContent.includes('9,999'),
      stored: window.localStorage.getItem('ef_budget_v2'),
    };
  }

  // Guests page: u1 last picked the second plan; u2 (whose plans happen to include that id) must
  // land on the focus plan, not on u1's pick.
  for (const [label, owner] of [
    ['secondAccount', 'u2'],
    ['sameAccount', 'u1'],
  ]) {
    const plans = [
      { id: 'pA', name: 'Alpha', eventType: 'wedding' },
      { id: 'pB', name: 'Beta', eventType: 'wedding' },
    ];
    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/api/me/plans')) {
        return fetchFor(owner)(url, { ...options, plans });
      }
      if (target.includes('/api/v1/auth/me')) {
        return fetchFor(owner)(url, options);
      }
      return answer(200, { guests: [] });
    };
    const window = await realPage('public/guests.html', 'http://localhost/guests', {
      fetchImpl,
      preload: win => {
        win.localStorage.setItem('eventflow_device_data_owner', 'u1');
        win.localStorage.setItem('ef_customer_plan', 'pB');
      },
      scripts: ['public/assets/js/utils/auth-state.js', 'public/assets/js/guests.js'],
    });
    await sleep(SECOND_ACCOUNT_AFTER_MS + 300);
    out[`guests_${label}`] = {
      subtitle: (window.document.getElementById('gm-sub')?.textContent || '').trim(),
      stored: window.localStorage.getItem('ef_customer_plan'),
    };
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Runner
 * -------------------------------------------------------------------------- */

(async () => {
  const results = {
    guard: await guardScenarios(),
    tickets: await ticketsScenarios(),
    ticketFixes: await ticketFixScenarios(),
    summary: await summaryScenarios(),
    page: await pageScenarios(),
    fixes: await fixScenarios(),
    deviceData: await deviceDataScenarios(),
    badge: await badgeScenarios(),
  };
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
