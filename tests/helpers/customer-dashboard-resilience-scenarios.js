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
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // The scripts log on purpose (timeouts, failed requests); only the JSON may reach stdout.
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  window.fetch = fetchImpl || (async () => ({ ok: false, status: 503, json: async () => ({}) }));
  window.matchMedia = () => ({ matches: false });
  window.Response = Response;
  return window;
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

/** Rejects like a browser's fetch does once its signal is aborted. */
function abortable(signal, work) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort);
    work().then(resolve, reject);
  });
}

/* -------------------------------------------------------------------------- *
 * S1: the sign-in guard must not answer a slow request with made-up data
 * -------------------------------------------------------------------------- */

const TIME_SCALE = 100; // the guard's 5 s / 30 s waits run as 50 ms / 300 ms

/**
 * Starts the sign-in guard on the customer dashboard with its waits shortened, and resolves to
 * the window once the guard has wrapped fetch. `serve(path, options)` answers the page's calls.
 */
async function guardedWindow(serve, control = {}) {
  const fetchImpl = async (input, options = {}) => {
    const target = new URL(String(input), 'http://localhost').pathname;
    if (target === '/api/v1/auth/me' && !control.meSlow) {
      return answer(200, { user: { id: 'u1', role: 'customer', firstName: 'Ann' } });
    }
    return abortable(options.signal, () => serve(target, options));
  };
  const window = await loaded(windowWith('<main></main>', fetchImpl));
  const realSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, ms, ...rest) =>
    realSetTimeout(callback, Math.max(1, Math.round((ms || 0) / TIME_SCALE)), ...rest);
  window.eval(source('public/assets/js/dashboard-guard.js'));
  for (let tries = 0; tries < 100 && !window.__EF_CUSTOMER_DASHBOARD_FETCH_GUARD__; tries += 1) {
    await sleep(10);
  }
  return window;
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
  for (const target of [
    '/api/me/plans',
    '/api/notifications',
    '/api/conversations',
    '/api/tickets',
  ]) {
    hung[target] = await outcomeOf(window.fetch(target));
  }
  out.neverAnswers = { ...hung, noticeAfter: Boolean(noticeOf(window)) };

  // The confirmed user and an existing CSRF token are real values, so they may stand in.
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
async function ticketsCard(ticketReplies) {
  const { pathToFileURL } = require('url');
  const window = await loaded(
    windowWith(
      '<button id="createTicketBtn">New ticket</button><div id="tickets-cust"></div>',
      async url => {
        const target = String(url);
        if (target.includes('/api/v1/auth/me')) {
          return textReply(200, { user: { id: 'u1', firstName: 'Ann' } });
        }
        if (target.includes('/api/tickets')) {
          const next = ticketReplies.length > 1 ? ticketReplies.shift() : ticketReplies[0];
          return next();
        }
        return textReply(200, {});
      }
    )
  );
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.fetch = window.fetch;
  globalThis.HTMLElement = window.HTMLElement;
  ticketRun += 1;
  const moduleUrl = `${pathToFileURL(path.join(root, 'public/assets/js/customer-tickets.js')).href}?run=${ticketRun}`;
  await import(moduleUrl);
  const { default: ticketing } = await import(
    `${pathToFileURL(path.join(root, 'public/assets/js/ticketing.js')).href}?v=18.3.1`
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
    ({ rsvp, urls = [] }) =>
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
        return answer(200, { packages: [{ id: 'pk1', price: '£400' }] });
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
  const calls = { plans: 0, patches: [], me: 0, navigations: 0 };
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
      return answer(200, { data: { items: [] } });
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
  window.__authState = { scopeDeviceData: () => {} };
  if (beforeScripts) {
    beforeScripts(window);
  }
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
 * Runner
 * -------------------------------------------------------------------------- */

(async () => {
  const results = {
    guard: await guardScenarios(),
    tickets: await ticketsScenarios(),
    summary: await summaryScenarios(),
    page: await pageScenarios(),
  };
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
