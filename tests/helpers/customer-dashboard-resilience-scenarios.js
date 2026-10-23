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
 * Runner
 * -------------------------------------------------------------------------- */

(async () => {
  const results = {
    guard: await guardScenarios(),
  };
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
