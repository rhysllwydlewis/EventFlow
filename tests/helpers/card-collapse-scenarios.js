#!/usr/bin/env node
/**
 * Behavioural scenarios for the mobile card-collapse control
 * (public/assets/js/card-collapse.js), driven through a real DOM.
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the
 * script is driven in a plain Node process — the same approach the admin
 * locations editor and supplier-init suites take — and the outcome of each
 * scenario is printed as JSON for the Jest suite to assert on.
 *
 * jsdom does not run layout, so getBoundingClientRect()/scrollHeight are
 * always zero here. That only affects the *animation* (which relies on the
 * 350ms setTimeout fallback anyway, since jsdom never fires transitionend),
 * not the state this suite actually checks: classes, aria attributes, the
 * chevron's rotate value, and what card-collapse.js chose to skip.
 *
 * Run directly to debug: `node tests/helpers/card-collapse-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const scriptSrc = fs.readFileSync(path.join(root, 'public/assets/js/card-collapse.js'), 'utf8');

const FIXTURE_BODY = `
  <div class="dashboard-hero no-collapse">
    <h1>Welcome</h1>
    <p>Hero content that must never collapse.</p>
  </div>

  <div class="card-collapse-bulk-actions" data-test="card-collapse-bulk-actions">
    <button type="button" class="card-collapse-bulk-btn" data-bulk-action="expand">Expand all</button>
    <button type="button" class="card-collapse-bulk-btn" data-bulk-action="collapse">Collapse all</button>
  </div>

  <div class="card sd-card" data-default-expanded="true">
    <div class="sd-card-header"><h2>Your Supplier Profile</h2></div>
    <div id="my-suppliers" class="section">
      <p>Profile form goes here.</p>
      <div class="card package-card">
        <img src="a.jpg">
        <h4>Nested package card</h4>
      </div>
    </div>
  </div>

  <div class="card sd-card" id="packages-section" data-default-expanded="true">
    <div class="sd-card-header"><h3>Your Packages</h3></div>
    <div id="my-packages" class="section">
      <div class="card package-card">
        <img src="a.jpg">
        <h4>Barn Exclusive</h4>
      </div>
      <div class="card package-card">
        <img src="b.jpg">
        <h4>Wedding Photography</h4>
      </div>
    </div>
  </div>

  <div class="card sd-card">
    <div class="sd-card-header"><h3>Messages</h3></div>
    <div class="section"><p>0 unread</p></div>
  </div>

  <div class="stat-widget card">
    <div class="value">42</div>
  </div>

  <div class="card sd-card" id="lonely-header-card">
    <div class="sd-card-header"><h3>Only a header</h3></div>
  </div>
`;

function buildDom(width) {
  // sessionStorage throws on jsdom's default opaque (about:blank) origin —
  // give it a real URL so loadState()/saveState() work like they do in a browser.
  const dom = new JSDOM(`<!doctype html><body>${FIXTURE_BODY}</body>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://event-flow.co.uk/dashboard-supplier.html',
  });
  Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true });
  return dom;
}

function cardState(document, headingText) {
  const card = Array.from(document.querySelectorAll('.card-collapsible')).find(c =>
    (c.querySelector('h1,h2,h3,h4')?.textContent || '').includes(headingText)
  );
  if (!card) {
    return null;
  }
  const btn = card.querySelector(':scope > .card-collapse-btn');
  const wrapper = card.querySelector(':scope > .card-body-collapsible');
  return {
    collapsed: card.classList.contains('card--collapsed'),
    ariaExpanded: btn ? btn.getAttribute('aria-expanded') : null,
    ariaLabel: btn ? btn.getAttribute('aria-label') : null,
    rotate: btn ? btn.style.rotate : null,
    throb: btn ? btn.dataset.throb : undefined,
    wrapperDisplay: wrapper ? wrapper.style.display : null,
  };
}

function clickToggle(document, headingText) {
  const card = Array.from(document.querySelectorAll('.card-collapsible')).find(c =>
    (c.querySelector('h1,h2,h3,h4')?.textContent || '').includes(headingText)
  );
  card.querySelector(':scope > .card-collapse-btn').click();
}

function settle(ms = 450) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scenarioMobileInit() {
  const dom = buildDom(390);
  dom.window.eval(scriptSrc);
  await settle();
  const { document } = dom.window;

  return {
    heroCollapsible: document.querySelector('.no-collapse').classList.contains('card-collapsible'),
    profile: cardState(document, 'Your Supplier Profile'),
    packages: cardState(document, 'Your Packages'),
    messages: cardState(document, 'Messages'),
    // Nested .package-card inside an already-collapsible ancestor must not get
    // its own button — that would double the toggle for the same content.
    nestedPackageCardIsCollapsible: Array.from(document.querySelectorAll('.package-card')).map(c =>
      c.classList.contains('card-collapsible')
    ),
    // A single-child card has nothing to wrap into a collapsible body.
    lonelyHeaderCardIsCollapsible: document
      .getElementById('lonely-header-card')
      .classList.contains('card-collapsible'),
    statWidgetIsCollapsible: document
      .querySelector('.stat-widget')
      .classList.contains('card-collapsible'),
    bulkActionsVisible: !!document.querySelector('.card-collapse-bulk-actions'),
  };
}

async function scenarioDesktopInit() {
  const dom = buildDom(1440);
  dom.window.eval(scriptSrc);
  await settle(50);
  const { document } = dom.window;

  return {
    collapsibleCount: document.querySelectorAll('.card-collapsible').length,
    collapseButtonCount: document.querySelectorAll('.card-collapse-btn').length,
  };
}

async function scenarioKeyboardToggle() {
  const dom = buildDom(390);
  dom.window.eval(scriptSrc);
  await settle();
  const { document } = dom.window;

  const before = cardState(document, 'Messages');
  clickToggle(document, 'Messages');
  await settle();
  const afterFirstToggle = cardState(document, 'Messages');
  clickToggle(document, 'Messages');
  await settle();
  const afterSecondToggle = cardState(document, 'Messages');

  return { before, afterFirstToggle, afterSecondToggle };
}

async function scenarioBulkActions() {
  const dom = buildDom(390);
  dom.window.eval(scriptSrc);
  await settle();
  const { document } = dom.window;

  const initial = {
    profile: cardState(document, 'Your Supplier Profile').collapsed,
    packages: cardState(document, 'Your Packages').collapsed,
    messages: cardState(document, 'Messages').collapsed,
  };

  document.querySelector('[data-bulk-action="expand"]').click();
  await settle();
  const afterExpandAll = {
    profile: cardState(document, 'Your Supplier Profile').collapsed,
    packages: cardState(document, 'Your Packages').collapsed,
    messages: cardState(document, 'Messages').collapsed,
  };

  document.querySelector('[data-bulk-action="collapse"]').click();
  await settle();
  const afterCollapseAll = {
    profile: cardState(document, 'Your Supplier Profile').collapsed,
    packages: cardState(document, 'Your Packages').collapsed,
    messages: cardState(document, 'Messages').collapsed,
  };

  return { initial, afterExpandAll, afterCollapseAll };
}

async function scenarioPersistenceAcrossReinit() {
  const dom = buildDom(390);
  dom.window.eval(scriptSrc);
  await settle();
  const { document, sessionStorage } = dom.window;

  // The user collapses a default-expanded card and expands a default-collapsed one.
  clickToggle(document, 'Your Packages');
  await settle();
  clickToggle(document, 'Messages');
  await settle();

  const storedRaw = sessionStorage.getItem('ef-collapsed-cards');

  // Simulate a reload: tear down and re-run init against the same sessionStorage.
  dom.window.cardCollapseTeardown();
  dom.window.cardCollapseInit();
  await settle();

  return {
    storedRaw: JSON.parse(storedRaw),
    packagesAfterReinit: cardState(document, 'Your Packages'),
    messagesAfterReinit: cardState(document, 'Messages'),
    // Untouched default-expanded card should still resolve to its default.
    profileAfterReinit: cardState(document, 'Your Supplier Profile'),
  };
}

async function runAll() {
  const results = {};
  const scenarios = {
    mobileInit: scenarioMobileInit,
    desktopInit: scenarioDesktopInit,
    keyboardToggle: scenarioKeyboardToggle,
    bulkActions: scenarioBulkActions,
    persistenceAcrossReinit: scenarioPersistenceAcrossReinit,
  };

  for (const [name, fn] of Object.entries(scenarios)) {
    try {
      results[name] = { ok: true, value: await fn() };
    } catch (error) {
      results[name] = { ok: false, error: error.message, stack: error.stack };
    }
  }

  process.stdout.write(JSON.stringify(results));
}

runAll().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
