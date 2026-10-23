#!/usr/bin/env node
/**
 * Behavioural scenarios for the customer dashboard fixes that can be checked without a browser:
 * the global Escape shortcut, device data left by another account, and the summary row.
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the scripts are run in a
 * plain Node process and each scenario's outcome is printed as JSON for the Jest suite to assert on.
 *
 * Run directly to debug: `node tests/helpers/customer-dashboard-fixes-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '../..');
const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');

/** A fresh window at a signed-in page address, with the given markup and no network. */
function windowWith(markup, fetchImpl) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
    url: 'http://localhost/dashboard/customer',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // The scripts log on purpose (failed auth check, shortcuts ready); only the JSON may reach stdout.
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  window.fetch = fetchImpl || (async () => ({ ok: false, status: 503, json: async () => ({}) }));
  window.matchMedia = () => ({ matches: false });
  return window;
}

/** Resolves once the document has finished loading, so scripts see it as an ordinary loaded page. */
function loaded(window) {
  if (window.document.readyState === 'complete') {
    return Promise.resolve(window);
  }
  return new Promise(resolve => window.addEventListener('load', () => resolve(window)));
}

/** Presses Escape with nothing focused and says whether the page cancelled the key. */
function pressEscape(window) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  window.document.dispatchEvent(event);
  return event.defaultPrevented;
}

/** The Escape shortcut must leave native dialogs, the mobile menu and an idle page alone. */
async function escapeScenarios() {
  const script = source('public/assets/js/keyboard-shortcuts.js');
  const out = {};

  let window = await loaded(windowWith('<dialog open id="d"><button>Cancel</button></dialog>'));
  window.eval(script);
  out.nativeDialogOpen = { cancelled: pressEscape(window) };

  window = await loaded(windowWith('<p>nothing open</p>'));
  window.eval(script);
  out.nothingOpen = { cancelled: pressEscape(window) };

  window = await loaded(
    windowWith(
      '<div id="ef-mobile-menu" class="ef-mobile-menu" role="dialog" aria-modal="true"></div>'
    )
  );
  window.eval(script);
  const menu = window.document.getElementById('ef-mobile-menu');
  out.mobileMenuOnly = {
    cancelled: pressEscape(window),
    display: menu.style.display,
    ariaHidden: menu.getAttribute('aria-hidden'),
  };

  window = await loaded(
    windowWith(
      '<div id="t" class="modal"><button>Close</button></div><div id="ef-mobile-menu" role="dialog"></div>'
    )
  );
  window.eval(script);
  const modal = window.document.getElementById('t');
  out.visibleModal = {
    cancelled: pressEscape(window),
    display: modal.style.display,
    ariaHidden: modal.getAttribute('aria-hidden'),
    menuDisplay: window.document.getElementById('ef-mobile-menu').style.display,
  };

  window = await loaded(windowWith('<div id="t" class="modal" style="display:none"></div>'));
  window.eval(script);
  out.alreadyHiddenModal = { cancelled: pressEscape(window) };
  return out;
}

/** A browser shared by two people must not carry one person's stored figures to the other. */
async function deviceDataScenarios() {
  const script = source('public/assets/js/utils/auth-state.js');
  const out = {};

  /** Runs auth-state in a window whose storage starts as given, then signs the user in. */
  async function signIn(initial, user) {
    const window = await loaded(windowWith(''));
    Object.entries(initial).forEach(([key, value]) => window.localStorage.setItem(key, value));
    window.eval(script);
    window.__authState.scopeDeviceData(user);
    return Object.fromEntries(
      [
        'eventflow_custom_budget',
        'eventflow_saved_suppliers',
        'eventflow_device_data_owner',
        'unrelated_key',
      ].map(key => [key, window.localStorage.getItem(key)])
    );
  }

  const stored = {
    eventflow_custom_budget: '12000',
    eventflow_saved_suppliers: '["s1"]',
    unrelated_key: 'keep',
  };
  out.sameAccount = await signIn({ ...stored, eventflow_device_data_owner: 'u1' }, { id: 'u1' });
  out.otherAccount = await signIn({ ...stored, eventflow_device_data_owner: 'u1' }, { id: 'u2' });
  out.firstSignIn = await signIn(stored, { id: 'u1' });
  out.noUser = await signIn({ ...stored, eventflow_device_data_owner: 'u1' }, null);
  return out;
}

/** The pieces of the dashboard page the summary row needs. */
const SUMMARY_MARKUP = `
  <p id="cdh-lede"></p><a id="cdh-next-action" href="/start" hidden></a>
  <a id="cdh-secondary-action" href="/suppliers"></a>
  <div id="cdh-summary-grid"></div>
  <div id="cdh-steps-body"></div><p id="cdh-steps-sub"></p>
  <div id="budget-settings-panel" hidden><input id="custom-budget-input"></div>`;

/** Answers the read-only calls the summary makes. `milestonesDelay` slows the checklist down. */
function summaryFetch({ milestonesDelay = 0, label = 'ok' } = {}) {
  return async url => {
    const target = String(url);
    if (target.includes('/api/v1/customer/milestones')) {
      await new Promise(resolve => setTimeout(resolve, milestonesDelay));
      return {
        ok: true,
        json: async () => ({
          milestones: [
            { id: 'save-supplier', label: `Step ${label}`, done: false, href: '/suppliers' },
          ],
        }),
      };
    }
    if (target.includes('/api/packages/bulk')) {
      return { ok: true, json: async () => ({ packages: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

/** Loads the summary module into a window. */
function summaryWindow(fetchImpl) {
  const window = windowWith(SUMMARY_MARKUP, fetchImpl);
  window.eval(source('public/assets/js/utils/package-price.js'));
  window.eval(source('public/assets/js/pages/customer-dashboard-home.js'));
  return window;
}

/** The plain text of the summary tiles. */
const tilesText = window =>
  [...window.document.querySelectorAll('#cdh-summary-grid .cdh-tile')].map(tile =>
    tile.textContent.replace(/\s+/g, ' ').trim()
  );

async function summaryScenarios() {
  const out = {};
  const base = { id: 'p1', name: 'Our wedding', eventDate: '2027-06-19', location: 'Bristol' };

  let window = summaryWindow(summaryFetch());
  await window.CustomerDashboardHome.render([{ ...base, budget: '£5,000–£10,000' }]);
  out.wizardRange = tilesText(window).find(text => text.startsWith('Budget'));

  window = summaryWindow(summaryFetch());
  await window.CustomerDashboardHome.render([{ ...base, budget: 'Up to £1,000' }]);
  out.upTo = tilesText(window).find(text => text.startsWith('Budget'));

  window = summaryWindow(summaryFetch());
  await window.CustomerDashboardHome.render([{ ...base, budget: 7500 }]);
  out.number = tilesText(window).find(text => text.startsWith('Budget'));

  window = summaryWindow(summaryFetch());
  await window.CustomerDashboardHome.render([{ ...base }]);
  out.noBudget = tilesText(window).find(text => text.startsWith('Budget'));

  // Which plan the summary describes when no plan has an upcoming date.
  window = summaryWindow(summaryFetch());
  const day = offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const pick = plans => window.CustomerDashboardHome.pickFocusPlan(plans)?.id;
  out.focus = {
    undatedBeatsPassed: pick([{ id: 'party', eventDate: day(-30) }, { id: 'wedding' }]),
    upcomingBeatsUndated: pick([{ id: 'wedding' }, { id: 'soon', eventDate: day(9) }]),
    latestPassedWhenAllDated: pick([
      { id: 'old', eventDate: day(-90) },
      { id: 'recent', eventDate: day(-5) },
    ]),
    firstWhenNoneDated: pick([{ id: 'a' }, { id: 'b' }]),
  };

  // A passed plan suggests starting another only while the customer may still have another.
  const ledeAfter = async (plans, options) => {
    const w = summaryWindow(summaryFetch());
    await w.CustomerDashboardHome.render(plans, options);
    return w.document.getElementById('cdh-lede').textContent;
  };
  const passed = [{ id: 'p1', name: 'Hen weekend', eventDate: day(-30) }];
  out.lede = {
    underLimit: await ledeAfter(passed, { limit: 3 }),
    atLimit: await ledeAfter(
      [{ ...passed[0] }, { id: 'p2', eventDate: day(-60) }, { id: 'p3', eventDate: day(-90) }],
      { limit: 3 }
    ),
    noLimitGiven: await ledeAfter(passed),
  };

  // A slow first draw must not paint over a newer one that finished first.
  let calls = 0;
  const raceFetch = async url => {
    if (String(url).includes('/api/v1/customer/milestones')) {
      calls += 1;
      const mine = calls;
      await new Promise(resolve => setTimeout(resolve, mine === 1 ? 120 : 5));
      return {
        ok: true,
        json: async () => ({
          milestones: [
            { id: 'save-supplier', label: `Draw ${mine}`, done: false, href: '/suppliers' },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ packages: [] }) };
  };
  window = summaryWindow(raceFetch);
  const first = window.CustomerDashboardHome.render([{ ...base, budget: 1000 }]);
  const second = window.CustomerDashboardHome.render([{ ...base, budget: 2000 }]);
  await Promise.all([first, second]);
  out.race = {
    budget: tilesText(window).find(text => text.startsWith('Budget')),
    step: window.document.getElementById('cdh-steps-body').textContent.replace(/\s+/g, ' ').trim(),
  };
  return out;
}

/** The dashboard calendar's "Next up" line, drawn by the fallback calendar from the customer's plans. */
async function calendarScenarios() {
  const pad = value => String(value).padStart(2, '0');
  const day = offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  /** Draws the calendar for the given plans and returns the text of the Next up panel. */
  async function nextUpFor(plans, entries = []) {
    const fetchImpl = async url => ({
      ok: true,
      json: async () => (String(url).includes('/me/plans') ? { plans } : { entries, events: [] }),
    });
    const window = await loaded(
      windowWith(
        `<button id="cal-add-entry-btn"></button><div id="events-calendar"></div>
         <div id="calendar-next-up"><div class="customer-calendar-next-up__eyebrow">Next up</div>
         <div class="customer-calendar-next-up__body">Nothing yet</div></div>`,
        fetchImpl
      )
    );
    window.eval(source('public/assets/js/calendar-view.js'));
    await window.CalendarView.init('events-calendar');
    return window.document
      .querySelector('.customer-calendar-next-up__body')
      .textContent.replace(/\s+/g, ' ')
      .trim();
  }

  const out = {};
  out.named = await nextUpFor([
    { id: 'p1', name: 'Our wedding', eventDate: day(120), location: 'Bristol' },
  ]);
  out.entryWithoutTime = await nextUpFor(
    [],
    [{ id: 'e1', title: 'Venue visit', type: 'meeting', date: day(3), time: '' }]
  );
  out.entryWithTime = await nextUpFor(
    [],
    [{ id: 'e2', title: 'Tasting', type: 'appointment', date: day(3), time: '14:30' }]
  );
  out.today = await nextUpFor([{ id: 'p2', name: 'Launch party', eventDate: day(0) }]);
  out.undated = await nextUpFor([{ id: 'p3', name: 'Someday' }]);
  out.passed = await nextUpFor([{ id: 'p4', name: 'Last year', eventDate: day(-30) }]);
  out.expectedDate = (() => {
    const [year, month, date] = day(120).split('-').map(Number);
    return new Date(year, month - 1, date).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  })();
  return out;
}

/** The plans and saved-suppliers cards, drawn by the dashboard's own start-up script. */
async function dashboardCardScenarios() {
  const markup = `
    <h1 id="welcome-heading"></h1>
    <a id="cdh-new-plan" href="/start">New plan</a>
    <div id="customer-plans-list"></div>
    <div id="saved-suppliers-status"></div><button id="openPlanBtn">View saved suppliers</button>`;

  /** Starts the page script with the given plans and shortlist answers; returns the card texts. */
  async function open({ plans, limit, shortlistStatus }) {
    const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
    const fetchImpl = async url => {
      const target = String(url);
      if (target.includes('/api/v1/auth/me')) {
        return answer(200, { user: { id: 'u1', firstName: 'Ann', verified: true } });
      }
      if (target.includes('/api/me/plans')) {
        return answer(200, { plans, limit });
      }
      if (target.includes('/api/v1/shortlist')) {
        return shortlistStatus === 200
          ? answer(200, { data: { items: [] } })
          : answer(shortlistStatus, { error: 'boom' });
      }
      return answer(200, { csrfToken: 'token' });
    };
    const window = await loaded(windowWith(markup, fetchImpl));
    const scoped = [];
    window.__authState = { scopeDeviceData: user => scoped.push(user.id) };
    window.eval(source('public/assets/js/pages/dashboard-customer-init.js'));
    // The script starts itself; wait for the cards to leave their loading state.
    for (let tries = 0; tries < 60; tries += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (window.document.getElementById('saved-suppliers-status').children.length) {
        break;
      }
    }
    const text = id => window.document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
    return {
      plans: text('customer-plans-list'),
      newPlanHidden: window.document.getElementById('cdh-new-plan').hidden,
      saved: text('saved-suppliers-status'),
      retryButton: Boolean(window.document.querySelector('[data-retry-saved]')),
      viewSavedHidden: window.document.getElementById('openPlanBtn').hidden,
      scoped,
    };
  }

  const plan = id => ({ id, name: `Plan ${id}`, eventType: 'party', eventDate: '2027-05-01' });
  return {
    atLimit: await open({
      plans: [plan('a'), plan('b'), plan('c')],
      limit: 3,
      shortlistStatus: 200,
    }),
    underLimit: await open({ plans: [plan('a')], limit: 3, shortlistStatus: 200 }),
    serverLimit: await open({ plans: [plan('a'), plan('b')], limit: 2, shortlistStatus: 200 }),
    noLimitReported: await open({ plans: [plan('a'), plan('b'), plan('c')], shortlistStatus: 200 }),
    shortlistFails: await open({ plans: [plan('a')], limit: 3, shortlistStatus: 500 }),
  };
}

(async () => {
  const results = {
    escape: await escapeScenarios(),
    deviceData: await deviceDataScenarios(),
    summary: await summaryScenarios(),
    calendar: await calendarScenarios(),
    cards: await dashboardCardScenarios(),
  };
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
