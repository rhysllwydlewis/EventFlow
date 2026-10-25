'use strict';

/**
 * Runs the real supplier dashboard page (public/dashboard-supplier.html body plus
 * supplier-dashboard-home.js and supplier-verification.js) in jsdom against a mocked API and
 * prints what it rendered as JSON. Run in a child process, like the other jsdom scenarios here,
 * because jsdom's dependencies are ES modules that Jest cannot load.
 *
 * usage: node supplier-dashboard-home-scenario.js <base64 json {summary, summaryStatus, suppliers, user, tips, tipsAfterChange, dispatchChanged}>
 *
 * `summary` is the response body of GET /api/supplier/dashboard-summary; `summaryStatus` its HTTP
 * status (200 by default); `suppliers` is what app.js would announce on the `sdh:suppliers` event
 * (omit it to announce nothing).
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

/** The page's own markup, without its scripts, so only the scripts under test run. */
const pageHtml = () => {
  const html = read('public/dashboard-supplier.html');
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  return `<!doctype html><html><head></head>${body.replace(/<script[\s\S]*?<\/script>/g, '')}</body></html>`;
};

const text = node => (node ? node.textContent.replace(/\s+/g, ' ').trim() : null);

async function main() {
  const scenario = JSON.parse(Buffer.from(process.argv[2] || 'e30=', 'base64').toString('utf8'));
  const dom = new JSDOM(pageHtml(), {
    url: `http://localhost/dashboard/supplier${scenario.hash || ''}`,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const { document } = window;
  const requested = [];
  let changed = false;
  window.console.log = () => {};
  window.console.error = () => {};
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.Element.prototype.scrollIntoView = () => {};

  window.fetch = async (url, options) => {
    const target = String(url);
    requested.push(`${(options && options.method) || 'GET'} ${target}`);
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
    if (target.includes('/api/supplier/dashboard-summary') && scenario.summaryNeverResolves) {
      return new Promise(() => {});
    }
    if (target.includes('/api/supplier/dashboard-summary')) {
      return reply(scenario.summaryStatus || 200, scenario.summary || {});
    }
    if (target.includes('/api/v1/auth/me')) {
      return reply(200, { user: scenario.user || { firstName: 'Hannah', verified: true } });
    }
    if (target.includes('/api/v2/subscriptions/upcoming-invoice')) {
      return reply(200, { upcomingInvoice: scenario.invoice || null });
    }
    if (target.includes('/api/v2/subscriptions/me')) {
      return reply(
        200,
        scenario.plan || { plan: 'free', status: 'free', limits: { maxPackages: 3 } }
      );
    }
    if (target.includes('/api/v1/supplier/performance-tips')) {
      if (changed && scenario.tipsFailAfterChange) {
        return reply(500, {});
      }
      return reply(200, { tips: (changed && scenario.tipsAfterChange) || scenario.tips || [] });
    }
    if (target.includes('/api/v1/supplier/review-requests')) {
      return reply(200, scenario.reviewRequests || { items: [], summary: {} });
    }
    return reply(200, {});
  };
  window.matchMedia = () => ({ matches: false });

  window.eval(read('public/assets/js/pages/supplier-dashboard-home.js'));
  window.eval(read('public/assets/js/pages/dashboard-supplier-verification.js'));
  // jsdom fires DOMContentLoaded (which binds the page's listeners) on the next task.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (scenario.failedList) {
    document.dispatchEvent(
      new window.CustomEvent('sdh:suppliers', { detail: { suppliers: null, failed: true } })
    );
  }
  if (scenario.suppliers) {
    document.dispatchEvent(
      new window.CustomEvent('sdh:suppliers', { detail: { suppliers: scenario.suppliers } })
    );
  }
  for (let turn = 0; turn < 12; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  if (scenario.dispatchChanged) {
    // Something saved elsewhere on the page: the page asks for its data again.
    changed = true;
    requested.push('--- sdh:changed ---');
    document.dispatchEvent(new window.CustomEvent('sdh:changed'));
    for (let turn = 0; turn < 12; turn += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const click = selector => {
    const node = document.querySelector(selector);
    if (node) {
      node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  };
  const actions = {};
  if (scenario.unreadUpdate !== undefined) {
    window.dispatchEvent(
      new window.CustomEvent('unreadCountUpdated', { detail: { count: scenario.unreadUpdate } })
    );
  }
  if (scenario.clickPeriod) {
    click(`[data-sdh-days="${scenario.clickPeriod}"]`);
    for (let turn = 0; turn < 12; turn += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (scenario.clickShowAllRequests) {
    click('[data-sdh-action="show-all-requests"]');
  }
  if (scenario.requestFilter) {
    const filter = document.getElementById('rreq-filter');
    filter.value = scenario.requestFilter;
    filter.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  if (scenario.clickStripAction) {
    click('#verification-status-banner [data-sdh-action]');
    const dialog = document.getElementById('sv-verification-modal');
    actions.verificationDialog = {
      open: dialog.hasAttribute('open'),
      title: text(document.getElementById('sv-modal-title')),
      notesShown: !document.getElementById('sv-rejection-notes-block').hidden,
      notes: text(document.getElementById('sv-rejection-notes-text')),
      submit: text(document.getElementById('sv-submit-btn')),
    };
  }
  if (scenario.clickRequestReview) {
    click('#sdh-request-review-btn');
    actions.reviewDialogOpen = document.getElementById('sdh-review-dialog').hasAttribute('open');
  }

  const stepsBody = document.getElementById('sdh-steps-body');
  const primary = document.getElementById('sdh-next-action');
  const strip = document.getElementById('verification-status-banner');
  const result = {
    h1Count: document.querySelectorAll('h1').length,
    heading: text(document.getElementById('welcome-heading')),
    lede: text(document.getElementById('sdh-lede')),
    primary: {
      hidden: primary.hidden,
      label: text(primary),
      action: primary.dataset.sdhAction || '',
    },
    noProfile: document.body.classList.contains('sdh-no-profile'),
    tiles: [...document.querySelectorAll('#sdh-summary-grid .sdh-tile')].map(tile => ({
      label: text(tile.querySelector('.sdh-tile__label')),
      value: text(tile.querySelector('.sdh-tile__value')),
      body: text(tile),
    })),
    summaryEmpty: text(document.getElementById('sdh-summary-grid')),
    summaryBusy: document.getElementById('sdh-summary-grid').getAttribute('aria-busy'),
    extra: {
      hidden: document.getElementById('sdh-summary-extra').hidden,
      text: text(document.getElementById('sdh-summary-extra')),
    },
    steps: {
      todo: [...stepsBody.querySelectorAll('ul.sdh-steps:not(.sdh-steps--done) .sdh-step')].map(
        text
      ),
      next: text(stepsBody.querySelector('.sdh-step--next')),
      done: [...stepsBody.querySelectorAll('.sdh-steps--done .sdh-step')].map(text),
      summary: text(stepsBody.querySelector('details summary')),
      detailsOpen: stepsBody.querySelector('details')
        ? stepsBody.querySelector('details').open
        : null,
      body: text(stepsBody),
    },
    strip: { hidden: strip.hidden, tone: strip.dataset.tone || '', text: text(strip) },
    emailBanner: text(document.getElementById('email-verify-banner')),
    visits: text(document.getElementById('supplier-performance-chart')),
    chartBars: document.querySelectorAll('#supplier-performance-chart .sdh-chart__bar').length,
    plan: text(document.getElementById('supplier-subscription-card')),
    tips: text(document.getElementById('supplier-perf-tips')),
    tipsHtml: document.getElementById('supplier-perf-tips').innerHTML,
    visitsHtml: document.getElementById('supplier-performance-chart').innerHTML,
    extraHtml: document.getElementById('sdh-summary-extra').innerHTML,
    requestsHtml: document.getElementById('supplier-review-request-widget').innerHTML,
    profileLink: (document.getElementById('rreq-profile-link') || {}).value,
    profileLinkHidden: document.getElementById('rreq-link-field').hidden,
    tipsHidden: document.getElementById('sdh-tips').hidden,
    requested,
    actions,
  };
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
