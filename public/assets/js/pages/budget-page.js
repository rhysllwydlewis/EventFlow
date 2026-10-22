'use strict';
/**
 * Customer budget page (/budget).
 *
 * One self-contained module. The page keeps the budget on the customer's event plan, the same
 * place the dashboard reads it from:
 *   GET   /api/me/plans                 plans, each with `budget` (total) and `budgetItems`
 *   PATCH /api/me/plans/:id             { budget }       the total
 *   POST  /api/me/plans/:id/budget      { budgetItems }  replaces the whole list
 * Customers with no event plan yet keep their budget on this device instead (localStorage), in
 * the same shape, and it moves into a plan the next time they have one.
 *
 * Maths lives in budget-calc.js (window.EFBudgetCalc); styles in budget-page.css (.bp-*).
 */
/* global exportUtility */
(function () {
  const Calc = window.EFBudgetCalc;
  if (!Calc) {
    return;
  }

  const LEGACY_KEY = 'ef_budget'; // the previous page's data: { total, expenses: [...] }
  const LOCAL_KEY = 'ef_budget_v2'; // device-only budget: { total, items: [...] }
  const IMPORTED_KEY = 'ef_budget_imported'; // set once the legacy data has been moved to a plan
  const DASHBOARD_BUDGET_KEY = 'eventflow_custom_budget'; // read by the dashboard as a fallback
  const PLAN_PICK_KEY = 'ef_customer_plan'; // shared with the guest list so both stay on one event
  const REQUEST_TIMEOUT_MS = 20000;

  const STATUS_TEXT = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', none: '' };

  const state = {
    status: 'loading', // loading | ready | error
    mode: 'plan', // plan | device
    plans: [],
    plan: null,
    total: 0,
    items: [],
    filterCategory: '',
    filterPayment: '',
    error: '',
    signedOut: false, // the plans request was refused: the session has ended
    legacy: null, // converted legacy data waiting to be imported into the plan
    importDismissed: false,
    editingId: null,
    deletingId: null,
    saving: false,
  };

  /** Shorthand for document.getElementById. */
  const byId = id => document.getElementById(id);
  /** Formats an amount as GBP. */
  const money = Calc.formatGBP;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  /** Escapes text so it can be placed inside HTML markup or an attribute value. */
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Reads a localStorage value, or null when storage is blocked or empty. */
  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /** Writes a localStorage value; returns false when storage is blocked or full. */
  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /** Reads and parses a JSON localStorage value, or null when missing or broken. */
  function readJson(key) {
    const raw = readStorage(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** A new unique id for a budget item created on this page. */
  function newId() {
    return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  /** The CSRF token from the page, its meta tag or the cookie, or an empty string. */
  function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.getAttribute('content')) {
      return meta.getAttribute('content');
    }
    const match = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return '';
  }

  /** Returns the CSRF token, fetching one from the server when the page has none. */
  async function ensureCsrfToken() {
    const existing = getCsrfToken();
    if (existing) {
      return existing;
    }
    try {
      const res = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const json = await res.json();
      const token = json.csrfToken || json.token || '';
      if (token) {
        window.__CSRF_TOKEN__ = token;
      }
      return token;
    } catch {
      return '';
    }
  }

  /** fetch wrapper: cookies, CSRF on writes, JSON body, a timeout, and readable errors. */
  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      const token = await ensureCsrfToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res = null;
    try {
      res = await fetch(path, {
        method,
        headers,
        credentials: 'include',
        signal: controller.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new Error('We could not reach EventFlow. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        res.status === 401
          ? 'Your session has ended. Please log in again.'
          : json.error || json.message || 'Something went wrong. Please try again.';
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /**
   * Puts the picked plan in the address bar. A ?plan= in the link wins over the remembered plan,
   * so without this a reload after switching plans would jump back to the plan in the link.
   */
  function showPlanInUrl(id) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('plan', id);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* the address just stays as it was */
    }
  }

  /** URL of the plan endpoint for the given plan, with an optional suffix such as "/budget". */
  const planUrl = (plan, suffix = '') => `/api/me/plans/${encodeURIComponent(plan.id)}${suffix}`;

  /**
   * Formats a plan date as e.g. "19 Jun 2027", or an empty string when it is missing or invalid.
   * A plan's date is a calendar day, so 2027-06-19 is read as that day in the visitor's own time
   * zone; parsing it as a UTC instant would show 18 Jun anywhere west of Greenwich.
   */
  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(value || ''));
    const date = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Category names for dropdowns: the defaults plus any custom ones in use, "Other" last. */
  function categoryList() {
    const extras = [
      ...new Set(
        state.items
          .map(item => item.category)
          .filter(name => name && !Calc.DEFAULT_CATEGORIES.includes(name))
      ),
    ].sort((first, second) => first.localeCompare(second, 'en-GB'));
    return [...Calc.DEFAULT_CATEGORIES.filter(name => name !== 'Other'), ...extras, 'Other'];
  }

  /* ------------------------------------------------------------------ *
   * Loading and saving
   * ------------------------------------------------------------------ */

  /** Local midnight for a plan date string such as 2027-06-19, or null when it has none. */
  function planDay(plan) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(plan?.eventDate || plan?.date || ''));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }

  /**
   * The plan the customer dashboard summarises: the next upcoming date, else a plan with no date
   * yet, else the latest dated plan, so all three customer pages start on the same event.
   */
  function pickFocusPlan(plans) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dated = plans
      .map(plan => ({ plan, day: planDay(plan) }))
      .filter(item => item.day)
      .sort((left, right) => left.day - right.day);
    const upcoming = dated.find(item => item.day >= today);
    if (upcoming) {
      return upcoming.plan;
    }
    // A plan with no date yet is still being planned; one whose date has passed is over.
    const undated = plans.find(plan => !planDay(plan));
    return undated || (dated[dated.length - 1] || { plan: plans[0] }).plan;
  }

  /** Chooses which plan to show: the ?plan= id, the last one picked, else the dashboard's focus plan. */
  function pickPlan(plans) {
    const wanted =
      new URLSearchParams(window.location.search).get('plan') || readStorage(PLAN_PICK_KEY);
    return plans.find(plan => plan.id === wanted) || pickFocusPlan(plans);
  }

  /** Reads the old page's device data, converted to budget lines, or null when there is none to import. */
  function readLegacy() {
    if (readStorage(IMPORTED_KEY)) {
      return null;
    }
    const converted = Calc.fromLegacy(readJson(LEGACY_KEY));
    return converted.items.length || converted.total > 0 ? converted : null;
  }

  /** Loads a plan's total and budget items into the page state. */
  function applyPlan(plan) {
    state.plan = plan;
    state.items = (Array.isArray(plan.budgetItems) ? plan.budgetItems : []).map((raw, index) =>
      Calc.normaliseItem(raw, `item_${index}`)
    );
    const fromPlan = Calc.parsePlanBudget(plan.budget);
    // The dashboard falls back to the figure saved on this device only when no plan has a budget.
    // Every plan save writes that figure, so using it for a plan with no budget of its own while
    // another plan has one would show the other plan's total.
    const anyPlanHasBudget = state.plans.some(entry => Calc.parsePlanBudget(entry.budget) > 0);
    state.total =
      fromPlan || (anyPlanHasBudget ? 0 : Calc.parsePlanBudget(readStorage(DASHBOARD_BUDGET_KEY)));
    state.legacy = readLegacy();
  }

  /** Loads the device-only budget (or converted old data) into the page state for customers with no plan. */
  function applyDevice() {
    state.plan = null;
    const stored = readJson(LOCAL_KEY);
    if (stored && Array.isArray(stored.items)) {
      state.items = stored.items.map((raw, index) => Calc.normaliseItem(raw, `item_${index}`));
      state.total = Calc.toAmount(stored.total);
    } else {
      const converted = Calc.fromLegacy(readJson(LEGACY_KEY));
      state.items = converted.items;
      state.total = converted.total;
    }
    state.total = state.total || Calc.parsePlanBudget(readStorage(DASHBOARD_BUDGET_KEY));
    state.legacy = null;
  }

  /** Fetches the customer's plans and renders the page, or shows an error with a retry. */
  async function load() {
    state.status = 'loading';
    state.error = '';
    state.signedOut = false;
    render();
    let plans = [];
    try {
      const data = await api('/api/me/plans');
      plans = Array.isArray(data.plans) ? data.plans : [];
    } catch (err) {
      state.status = 'error';
      state.error = err.message;
      state.signedOut = err.status === 401 || err.status === 403;
      render();
      return;
    }
    state.plans = plans;
    if (plans.length) {
      state.mode = 'plan';
      applyPlan(pickPlan(plans));
    } else {
      state.mode = 'device';
      applyDevice();
    }
    state.status = 'ready';
    render();
  }

  /** Saves the budget on this device, and the total where the dashboard also looks for it. */
  function saveDevice(items, total) {
    const ok = writeStorage(LOCAL_KEY, JSON.stringify({ total, items }));
    if (!ok) {
      throw new Error(
        'Your browser would not save this on your device. Check your storage settings.'
      );
    }
    writeStorage(DASHBOARD_BUDGET_KEY, String(total || ''));
  }

  /** Writes the whole list of lines; resolves once the server (or device) has accepted it. */
  async function persistItems(items) {
    if (state.mode === 'device') {
      saveDevice(items, state.total);
      state.items = items;
      return;
    }
    const body = {
      budgetItems: items.map(line => ({
        id: line.id,
        category: line.category,
        item: line.item,
        estimated: line.estimated,
        actual: line.actual,
        paid: line.paid,
        notes: line.notes,
      })),
      // Lets the server refuse the save if another tab or device has changed the list since.
      baseVersion: state.plan.budgetUpdatedAt || '',
    };
    const data = await api(planUrl(state.plan, '/budget'), { method: 'POST', body });
    const saved = Array.isArray(data.budgetItems) ? data.budgetItems : items;
    state.items = saved.map((raw, index) => Calc.normaliseItem(raw, `item_${index}`));
    state.plan.budgetItems = state.items;
    state.plan.budgetUpdatedAt = data.budgetUpdatedAt || state.plan.budgetUpdatedAt || '';
  }

  /** Saves the total budget to the plan (or this device) and updates the state. */
  async function persistTotal(total) {
    if (state.mode === 'device') {
      saveDevice(state.items, total);
      state.total = total;
      return;
    }
    await api(planUrl(state.plan), { method: 'PATCH', body: { budget: total } });
    state.plan.budget = String(total);
    state.total = total;
    writeStorage(DASHBOARD_BUDGET_KEY, String(total));
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  /** Applies each data-w percentage inside root as an element width, so markup needs no inline styles. */
  function applyWidths(root) {
    root.querySelectorAll('[data-w]').forEach(el => {
      el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w) || 0))}%`;
    });
  }

  /** Renders the plan line, plan switcher and the enabled state of the header actions. */
  function renderHeader() {
    const line = byId('bp-plan-line');
    if (state.mode === 'device') {
      line.textContent = 'Saved on this device';
    } else if (state.plan) {
      const when = formatDate(state.plan.eventDate);
      line.textContent = [state.plan.name || 'Your event', when].filter(Boolean).join(' · ');
    } else {
      line.textContent = 'Your event';
    }
    const switcher = byId('bp-plan-switch');
    const select = byId('bp-plan-select');
    const multiple = state.mode === 'plan' && state.plans.length > 1;
    switcher.hidden = !multiple;
    if (multiple) {
      select.innerHTML = state.plans
        .map(
          plan =>
            `<option value="${esc(plan.id)}"${plan.id === state.plan.id ? ' selected' : ''}>${esc(
              plan.name || 'Untitled plan'
            )}</option>`
        )
        .join('');
    }
    const ready = state.status === 'ready';
    byId('bp-add-btn').disabled = !ready;
    byId('bp-export-menu').hidden = !(ready && state.items.length);
  }

  /** Renders the device-only and import notices above the summary. */
  function renderNotices() {
    const parts = [];
    if (state.status === 'ready' && state.mode === 'device') {
      parts.push(
        '<div class="bp-notice"><p><strong>Saved on this device only.</strong> Create an event plan to keep your budget in your account and see it on your dashboard.</p><a class="bp-btn bp-btn--secondary" href="/start">Create an event plan</a></div>'
      );
    }
    if (
      state.status === 'ready' &&
      state.mode === 'plan' &&
      state.legacy &&
      !state.importDismissed
    ) {
      const count = state.legacy.items.length;
      const what = count
        ? `${count} expense${count === 1 ? '' : 's'} from the old budget tool`
        : 'a budget total from the old budget tool';
      parts.push(
        `<div class="bp-notice"><p><strong>Found ${esc(what)} on this device.</strong> Move ${count === 1 ? 'it' : 'them'} into ${esc(
          state.plan.name || 'this plan'
        )} to keep ${count === 1 ? 'it' : 'them'} in your account.</p><div class="bp-notice__actions"><button type="button" class="bp-btn bp-btn--primary" data-action="import-legacy">Move to this plan</button><button type="button" class="bp-btn bp-btn--secondary" data-action="dismiss-import">Not now</button></div></div>`
      );
    }
    byId('bp-notices').innerHTML = parts.join('');
  }

  /** Markup for the progress bar: paid, still to pay and over-budget segments with a text label. */
  function metersHtml(figures) {
    const seg = Calc.meterSegments(figures);
    const label = `${money(figures.committed)} committed of ${money(figures.budget)} budget, ${figures.percentCommitted}%. ${money(
      figures.paid
    )} paid.`;
    /** Markup for one progress-bar segment; nothing when it has no width. */
    const part = (kind, width) =>
      width > 0
        ? `<span class="bp-meter__seg bp-meter__seg--${kind}" data-w="${width}"></span>`
        : '';
    return `<div class="bp-meter" role="img" aria-label="${esc(label)}">${part('paid', seg.paid)}${part('rest', seg.rest)}${part('over', seg.over)}</div>`;
  }

  /** Markup for the legend under the progress bar (paid, still to pay, remaining or over budget). */
  function legendHtml(figures) {
    const last = figures.hasBudget
      ? figures.isOver
        ? `<li><span class="bp-dot bp-dot--over" aria-hidden="true"></span>Over budget <strong>${money(figures.overBy)}</strong></li>`
        : `<li><span class="bp-dot bp-dot--free" aria-hidden="true"></span>Remaining <strong>${money(figures.remaining)}</strong></li>`
      : '';
    return `<ul class="bp-legend"><li><span class="bp-dot bp-dot--paid" aria-hidden="true"></span>Paid <strong>${money(
      figures.paid
    )}</strong></li><li><span class="bp-dot bp-dot--rest" aria-hidden="true"></span>Still to pay <strong>${money(
      figures.toPay
    )}</strong></li>${last}</ul>`;
  }

  /** Renders the summary card: loading, error, first-time empty state, or the budget figures. */
  function renderSummary() {
    const host = byId('bp-summary');
    if (state.status === 'loading') {
      host.innerHTML =
        '<h2 class="bp-sr" id="bp-summary-title">Budget summary</h2><div class="bp-skeleton" aria-hidden="true"><span></span><span></span><span></span></div><p class="bp-sr">Loading your budget.</p>';
      return;
    }
    if (state.status === 'error') {
      // A refused request means the session has ended; trying again cannot help, logging in can.
      const action = state.signedOut
        ? '<a class="bp-btn bp-btn--primary" href="/auth?redirect=%2Fbudget">Log in</a>'
        : '<button type="button" class="bp-btn bp-btn--primary" data-action="retry">Try again</button>';
      const title = state.signedOut ? 'Log in to see your budget' : 'We could not load your budget';
      host.innerHTML = `<div class="bp-state${state.signedOut ? '' : ' bp-state--error'}" role="alert"><h2 class="bp-h2" id="bp-summary-title">${title}</h2><p>${esc(
        state.error
      )}</p>${action}</div>`;
      return;
    }
    if (!state.items.length && !state.total) {
      host.innerHTML =
        '<div class="bp-state"><h2 class="bp-h2" id="bp-summary-title">Start your budget</h2><p>Set a total, then add what you expect to pay for, such as the venue, catering and photography. Add the real cost and what you have paid as things are confirmed, and your remaining budget updates as you go.</p><div class="bp-state__actions"><button type="button" class="bp-btn bp-btn--primary" data-action="add">Add your first item</button><button type="button" class="bp-btn bp-btn--secondary" data-action="set-budget">Set total budget</button></div></div>';
      return;
    }
    const figures = Calc.summarise(state.items, state.total);
    let remainingLabel = 'Remaining';
    let remainingValue = '—';
    let remainingSub = 'Set a budget to see what is left';
    if (figures.hasBudget) {
      remainingValue = money(figures.remaining);
      remainingSub =
        figures.percentCommitted >= 90 && !figures.isOver
          ? 'Nearly all committed'
          : 'Within budget';
      if (figures.isOver) {
        remainingLabel = 'Over budget by';
        remainingValue = money(figures.overBy);
        remainingSub = 'Committed is more than your budget';
      }
    }
    const packages =
      state.mode === 'plan' && state.plan && Array.isArray(state.plan.packages)
        ? state.plan.packages.length
        : 0;
    host.innerHTML = `<h2 class="bp-sr" id="bp-summary-title">Budget summary</h2>
      <div class="bp-stats">
        <div class="bp-stat">
          <span class="bp-stat__label">Total budget</span>
          <span class="bp-stat__value">${figures.hasBudget ? money(figures.budget) : 'Not set'}</span>
          <button type="button" class="bp-link" data-action="set-budget">${figures.hasBudget ? 'Edit budget' : 'Set budget'}</button>
        </div>
        <div class="bp-stat">
          <span class="bp-stat__label">Committed</span>
          <span class="bp-stat__value">${money(figures.committed)}</span>
          <span class="bp-stat__sub">${
            figures.hasBudget
              ? `${figures.percentCommitted}% of budget`
              : `${state.items.length} item${state.items.length === 1 ? '' : 's'}`
          }</span>
        </div>
        <div class="bp-stat bp-stat--result${figures.isOver ? ' is-over' : ''}">
          <span class="bp-stat__label">${remainingLabel}</span>
          <span class="bp-stat__value">${remainingValue}</span>
          <span class="bp-stat__sub">${esc(remainingSub)}</span>
        </div>
      </div>
      ${figures.hasBudget ? metersHtml(figures) : ''}
      ${state.items.length ? legendHtml(figures) : ''}
      ${
        packages
          ? `<p class="bp-fineprint">Your dashboard also adds the listed price of the ${packages} supplier package${
              packages === 1 ? '' : 's'
            } saved to this plan. They are not included here.</p>`
          : ''
      }`;
    applyWidths(host);
  }

  /** Markup for a category's difference from plan: over, under, on plan or no plan set. */
  function differenceHtml(row) {
    if (!(row.planned > 0)) {
      return '<span class="bp-muted">No plan set</span>';
    }
    if (row.diff > 0) {
      return `<span class="bp-diff bp-diff--over">${money(row.diff)} over</span>`;
    }
    if (row.diff < 0) {
      return `<span class="bp-diff">${money(-row.diff)} under</span>`;
    }
    return '<span class="bp-diff">On plan</span>';
  }

  /** Renders the planned-versus-committed table by category. */
  function renderCategories() {
    const section = byId('bp-categories-section');
    const show = state.status === 'ready' && state.items.length > 0;
    section.hidden = !show;
    if (!show) {
      return;
    }
    const rows = Calc.byCategory(state.items, categoryList());
    byId('bp-categories').innerHTML = `<table class="bp-table bp-table--categories" role="table">
      <thead><tr role="row"><th scope="col" role="columnheader">Category</th><th scope="col" role="columnheader" class="bp-num">Planned</th><th scope="col" role="columnheader" class="bp-num">Committed</th><th scope="col" role="columnheader" class="bp-num">Difference</th></tr></thead>
      <tbody>${rows
        .map(
          row => `<tr role="row" class="${row.isOver ? 'is-over' : ''}">
        <th scope="row" role="rowheader" class="bp-cell-name"><span class="bp-cat-name">${esc(row.category)}</span><span class="bp-cat-count">${row.count} item${row.count === 1 ? '' : 's'}</span>
          <span class="bp-bar" aria-hidden="true"><span class="bp-bar__fill${row.isOver ? ' bp-bar__fill--over' : ''}" data-w="${row.share}"></span></span></th>
        <td role="cell" class="bp-num" data-label="Planned">${money(row.planned)}</td>
        <td role="cell" class="bp-num" data-label="Committed">${money(row.committed)}</td>
        <td role="cell" class="bp-num" data-label="Difference">${differenceHtml(row)}</td></tr>`
        )
        .join('')}</tbody></table>`;
    applyWidths(byId('bp-categories'));
  }

  /** The items that pass the current category and payment filters. */
  function visibleItems() {
    return state.items.filter(
      item =>
        (!state.filterCategory || item.category === state.filterCategory) &&
        (!state.filterPayment || Calc.lineStatus(item) === state.filterPayment)
    );
  }

  /** Rebuilds the category filter options from the items and restores the current selections. */
  function renderFilters() {
    const select = byId('filter-category');
    const names = [...new Set(state.items.map(item => item.category))];
    if (state.filterCategory && !names.includes(state.filterCategory)) {
      state.filterCategory = '';
    }
    const ordered = categoryList().filter(name => names.includes(name));
    const options = ordered.map(
      name =>
        `<option value="${esc(name)}"${name === state.filterCategory ? ' selected' : ''}>${esc(name)}</option>`
    );
    select.innerHTML = `<option value="">All categories</option>${options.join('')}`;
    byId('filter-status').value = state.filterPayment;
  }

  /** Renders the items table (or an empty or no-match message) with totals. */
  function renderItems() {
    const section = byId('bp-items-section');
    const show = state.status === 'ready';
    section.hidden = !show || (!state.items.length && !state.total);
    if (section.hidden) {
      return;
    }
    byId('bp-filters').hidden = !state.items.length;
    renderFilters();
    const host = byId('bp-items');
    if (!state.items.length) {
      host.innerHTML =
        '<div class="bp-state bp-state--inline"><p>No items yet. Add the first thing you expect to pay for.</p><button type="button" class="bp-btn bp-btn--primary" data-action="add">Add item</button></div>';
      return;
    }
    const rows = visibleItems();
    if (!rows.length) {
      host.innerHTML =
        '<div class="bp-state bp-state--inline"><p>No items match these filters.</p><button type="button" class="bp-btn bp-btn--secondary" data-action="clear-filters">Clear filters</button></div>';
      return;
    }
    const totals = {
      planned: Calc.sumMoney(rows.map(row => row.estimated)),
      actual: Calc.sumMoney(rows.map(row => row.actual)),
      paid: Calc.sumMoney(rows.map(row => row.paid)),
    };
    const filtered = rows.length !== state.items.length;
    host.innerHTML = `<table class="bp-table bp-table--items" role="table">
      <thead><tr role="row"><th scope="col" role="columnheader">Item</th><th scope="col" role="columnheader">Category</th><th scope="col" role="columnheader" class="bp-num">Planned</th><th scope="col" role="columnheader" class="bp-num">Actual</th><th scope="col" role="columnheader" class="bp-num">Paid</th><th scope="col" role="columnheader">Payment</th><th scope="col" role="columnheader"><span class="bp-sr">Actions</span></th></tr></thead>
      <tbody>${rows
        .map(item => {
          const status = Calc.lineStatus(item);
          return `<tr role="row">
        <td role="cell" class="bp-cell-item"><span class="bp-item-name">${esc(item.item)}</span>${
          item.notes ? `<span class="bp-item-notes">${esc(item.notes)}</span>` : ''
        }</td>
        <td role="cell" class="bp-cell-cat">${esc(item.category)}</td>
        <td role="cell" class="bp-num" data-label="Planned">${money(item.estimated)}</td>
        <td role="cell" class="bp-num" data-label="Actual">${item.actual > 0 ? money(item.actual) : '<span class="bp-muted">—</span>'}</td>
        <td role="cell" class="bp-num" data-label="Paid">${item.paid > 0 ? money(item.paid) : '<span class="bp-muted">—</span>'}</td>
        <td role="cell" class="bp-cell-status">${
          status === 'none'
            ? ''
            : `<span class="bp-badge bp-badge--${status}">${STATUS_TEXT[status]}</span>`
        }</td>
        <td role="cell" class="bp-cell-actions"><button type="button" class="bp-btn bp-btn--quiet" data-action="edit" data-id="${esc(item.id)}" aria-label="Edit ${esc(item.item)}">Edit</button></td></tr>`;
        })
        .join('')}</tbody>
      <tfoot><tr role="row"><th scope="row" role="rowheader" colspan="2" class="bp-foot-label">${filtered ? 'Total of items shown' : 'Total'}</th><td role="cell" class="bp-num" data-label="Planned">${money(totals.planned)}</td><td role="cell" class="bp-num" data-label="Actual">${money(totals.actual)}</td><td role="cell" class="bp-num" data-label="Paid">${money(totals.paid)}</td><td role="cell" class="bp-foot-fill"></td><td role="cell" class="bp-foot-fill"></td></tr></tfoot></table>`;
  }

  /** Renders every part of the page from the current state. */
  function render() {
    byId('main-content').setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
    renderHeader();
    renderNotices();
    renderSummary();
    renderCategories();
    renderItems();
  }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  let toastTimer = null;
  /** Shows a short status message in the live region for a few seconds. */
  function toast(message) {
    const el = byId('bp-toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 4000);
  }

  /* ------------------------------------------------------------------ *
   * Dialogs
   * ------------------------------------------------------------------ */

  /** Opens a dialog as a modal (falls back to the open attribute in old browsers). */
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /** Closes a dialog. */
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /** Shows or clears the error text under a field and sets its aria-invalid state. */
  function setFieldError(input, message) {
    const err = input.closest('.bp-field').querySelector('.bp-field__err');
    err.textContent = message || '';
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  /** Clears every field and form-level error in a form. */
  function clearErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.bp-field__err, .bp-form__error').forEach(el => {
      el.textContent = '';
    });
  }

  /** Switches a submit button between its idle label and a disabled "Saving…" state. */
  function setSaving(button, saving, idleLabel) {
    state.saving = saving;
    button.disabled = saving;
    button.textContent = saving ? 'Saving…' : idleLabel;
  }

  /** Opens the item dialog for a new item, or for an existing one when an id is given. */
  function openItemDialog(id) {
    const item = id ? state.items.find(entry => entry.id === id) : null;
    if (id && !item) {
      return;
    }
    state.editingId = item ? item.id : null;
    const form = byId('bp-item-form');
    clearErrors(form);
    byId('bp-item-title').textContent = item ? 'Edit item' : 'Add item';
    byId('bp-item-delete').hidden = !item;
    byId('bp-f-item').value = item ? item.item : '';
    byId('bp-f-category').innerHTML = categoryList()
      .map(name => `<option value="${esc(name)}">${esc(name)}</option>`)
      .join('');
    byId('bp-f-category').value = item ? item.category : state.filterCategory || 'Venue';
    byId('bp-f-estimated').value = item?.estimated ? String(item.estimated) : '';
    byId('bp-f-actual').value = item?.actual ? String(item.actual) : '';
    byId('bp-f-paid').value = item?.paid ? String(item.paid) : '';
    byId('bp-f-notes').value = item ? item.notes : '';
    setSaving(byId('bp-item-save'), false, 'Save item');
    openDialog(byId('bp-item-dialog'));
    byId('bp-f-item').focus();
  }

  /** Validates the item form; returns the new item, or null after showing errors and focusing the first. */
  function readItemForm() {
    const form = byId('bp-item-form');
    clearErrors(form);
    const name = byId('bp-f-item').value.trim();
    const estimated = Calc.parseMoneyInput(byId('bp-f-estimated').value);
    const actual = Calc.parseMoneyInput(byId('bp-f-actual').value);
    const paid = Calc.parseMoneyInput(byId('bp-f-paid').value);
    const problems = [];
    /** Records a validation problem for a field. */
    const fail = (input, message) => problems.push({ input, message });

    if (!name) {
      fail(byId('bp-f-item'), 'Enter a name for this item.');
    }
    if (!estimated.ok) {
      fail(byId('bp-f-estimated'), 'Enter an amount such as 1200 or 1,200.50.');
    } else if (!(estimated.value > 0)) {
      fail(byId('bp-f-estimated'), 'Enter what you plan to spend, more than £0.');
    }
    if (!actual.ok) {
      fail(byId('bp-f-actual'), 'Enter an amount such as 1200 or 1,200.50, or leave it blank.');
    }
    if (!paid.ok) {
      fail(byId('bp-f-paid'), 'Enter an amount such as 500 or 500.50, or leave it blank.');
    }
    if (estimated.ok && actual.ok && paid.ok) {
      const cost = actual.value > 0 ? actual.value : estimated.value;
      if (paid.value > cost) {
        fail(byId('bp-f-paid'), `That is more than the cost (${money(cost)}).`);
      }
    }
    problems.forEach(problem => setFieldError(problem.input, problem.message));
    if (problems.length) {
      problems[0].input.focus();
      return null;
    }
    return {
      id: state.editingId || newId(),
      category: byId('bp-f-category').value || 'Other',
      item: name,
      estimated: estimated.value,
      actual: actual.value,
      paid: paid.value,
      notes: byId('bp-f-notes').value.trim(),
    };
  }

  /** Saves the item form: validates, writes the whole list, then closes or shows the server's message. */
  async function submitItem(event) {
    event.preventDefault();
    if (state.saving) {
      return;
    }
    const next = readItemForm();
    if (!next) {
      return;
    }
    const items = state.editingId
      ? state.items.map(item => (item.id === state.editingId ? next : item))
      : [...state.items, next];
    setSaving(byId('bp-item-save'), true, 'Save item');
    try {
      await persistItems(items);
      closeDialog(byId('bp-item-dialog'));
      render();
      toast(state.editingId ? 'Item updated' : 'Item added');
    } catch (err) {
      byId('bp-form-error').textContent = err.message;
      setSaving(byId('bp-item-save'), false, 'Save item');
    }
  }

  /** Opens the total-budget dialog with the current total filled in. */
  function openBudgetDialog() {
    clearErrors(byId('bp-budget-form'));
    byId('bp-f-total').value = state.total ? String(state.total) : '';
    setSaving(byId('bp-budget-save'), false, 'Save budget');
    openDialog(byId('bp-budget-dialog'));
    byId('bp-f-total').focus();
    byId('bp-f-total').select();
  }

  /** Validates and saves the total budget from its dialog. */
  async function submitBudget(event) {
    event.preventDefault();
    if (state.saving) {
      return;
    }
    const form = byId('bp-budget-form');
    clearErrors(form);
    const input = byId('bp-f-total');
    const parsed = Calc.parseMoneyInput(input.value);
    if (!parsed.ok || !(parsed.value > 0)) {
      setFieldError(input, 'Enter your total budget as an amount above £0, such as 15000.');
      input.focus();
      return;
    }
    setSaving(byId('bp-budget-save'), true, 'Save budget');
    try {
      await persistTotal(parsed.value);
      closeDialog(byId('bp-budget-dialog'));
      render();
      toast(`Budget set to ${money(parsed.value)}`);
    } catch (err) {
      byId('bp-budget-error').textContent = err.message;
      setSaving(byId('bp-budget-save'), false, 'Save budget');
    }
  }

  /** Opens the delete confirmation for an item. */
  function openDeleteDialog(id) {
    const item = state.items.find(entry => entry.id === id);
    if (!item) {
      return;
    }
    state.deletingId = id;
    byId('bp-confirm-text').textContent = `“${item.item}” will be removed from your budget.`;
    byId('bp-confirm-error').textContent = '';
    byId('bp-confirm-yes').disabled = false;
    byId('bp-confirm-yes').textContent = 'Delete';
    openDialog(byId('bp-confirm-dialog'));
  }

  /** Deletes the item chosen in the confirmation dialog. */
  async function confirmDelete() {
    if (state.saving || !state.deletingId) {
      return;
    }
    const button = byId('bp-confirm-yes');
    setSaving(button, true, 'Delete');
    try {
      await persistItems(state.items.filter(item => item.id !== state.deletingId));
      closeDialog(byId('bp-confirm-dialog'));
      state.deletingId = null;
      render();
      toast('Item deleted');
      byId('bp-items-title').focus();
    } catch (err) {
      byId('bp-confirm-error').textContent = err.message;
      setSaving(button, false, 'Delete');
    }
  }

  /* ------------------------------------------------------------------ *
   * Import and export
   * ------------------------------------------------------------------ */

  /** Moves the old page's device data into the current plan, then marks it as imported. */
  async function importLegacy() {
    if (!state.legacy || state.mode !== 'plan' || state.saving) {
      return;
    }
    const legacy = state.legacy;
    state.saving = true;
    try {
      const existing = new Set(state.items.map(item => item.id));
      const incoming = legacy.items.map(item =>
        existing.has(item.id) ? { ...item, id: newId() } : item
      );
      if (incoming.length) {
        await persistItems([...state.items, ...incoming]);
      }
      if (legacy.total > 0 && !Calc.parsePlanBudget(state.plan.budget)) {
        await persistTotal(legacy.total);
      }
      writeStorage(IMPORTED_KEY, state.plan.id);
      state.legacy = null;
      render();
      toast('Moved to your plan');
    } catch (err) {
      toast(err.message);
    } finally {
      state.saving = false;
    }
  }

  /** Downloads text as a file in the browser. */
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Today's date as YYYY-MM-DD, used in export file names. */
  const today = () => new Date().toISOString().slice(0, 10);

  /** Downloads the items as a CSV file. */
  function exportCsv() {
    // A leading byte-order mark makes Excel read the file as UTF-8.
    const bom = String.fromCharCode(0xfeff);
    download(`eventflow-budget-${today()}.csv`, `${bom}${Calc.toCsv(state.items)}`, 'text/csv');
    toast('Budget downloaded as CSV');
  }

  /** Downloads the budget as a PDF using the shared export utility. */
  async function exportPdf() {
    if (typeof exportUtility === 'undefined') {
      toast('The PDF tool did not load. Try again, or download the CSV.');
      return;
    }
    const figures = Calc.summarise(state.items, state.total);
    try {
      await exportUtility.exportBudgetToPDF(
        {
          totalBudget: figures.budget,
          totalSpent: figures.committed,
          remaining: figures.remaining,
          percentageUsed: figures.percentCommitted,
          expenses: state.items.map(item => ({
            category: item.category,
            description: item.item,
            amount: Calc.lineCost(item),
            status: STATUS_TEXT[Calc.lineStatus(item)] || 'Planned',
          })),
        },
        `eventflow-budget-${today()}.pdf`
      );
      toast('Budget downloaded as PDF');
    } catch {
      toast('We could not create the PDF. Try the CSV instead.');
    }
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  /** Closes the export menu if it is open. */
  function closeExportMenu() {
    const menu = byId('bp-export-menu');
    if (menu.open) {
      menu.open = false;
    }
  }

  /** Click handlers keyed by the data-action value on a button. */
  const ACTIONS = {
    /** Opens the dialog for a new item. */
    add: () => openItemDialog(null),
    /** Opens the dialog for the item whose id is on the clicked row. */
    edit: el => openItemDialog(el.dataset.id),
    'set-budget': openBudgetDialog,
    retry: load,
    'import-legacy': importLegacy,
    /** Hides the import notice until the next visit. */
    'dismiss-import': () => {
      state.importDismissed = true;
      renderNotices();
    },
    /** Resets both filters and redraws the items. */
    'clear-filters': () => {
      state.filterCategory = '';
      state.filterPayment = '';
      renderItems();
    },
    /** Closes the export menu and downloads the CSV. */
    'export-csv': () => {
      closeExportMenu();
      exportCsv();
    },
    /** Closes the export menu and downloads the PDF. */
    'export-pdf': () => {
      closeExportMenu();
      exportPdf();
    },
  };

  /** Attaches all click, keyboard, form and filter listeners once. */
  function bind() {
    document.addEventListener('click', event => {
      const closer = event.target.closest('[data-close]');
      if (closer) {
        closeDialog(closer.closest('dialog'));
        return;
      }
      const el = event.target.closest('[data-action]');
      if (el && ACTIONS[el.dataset.action] && byId('main-content').contains(el)) {
        ACTIONS[el.dataset.action](el);
        return;
      }
      if (!event.target.closest('#bp-export-menu')) {
        closeExportMenu();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeExportMenu();
      }
    });

    byId('bp-item-form').addEventListener('submit', submitItem);
    byId('bp-budget-form').addEventListener('submit', submitBudget);
    byId('bp-confirm-yes').addEventListener('click', confirmDelete);
    byId('bp-item-delete').addEventListener('click', () => {
      const id = state.editingId;
      closeDialog(byId('bp-item-dialog'));
      openDeleteDialog(id);
    });

    document
      .querySelectorAll('.bp-field input, .bp-field select, .bp-field textarea')
      .forEach(input => {
        input.addEventListener('input', () => {
          if (input.getAttribute('aria-invalid')) {
            setFieldError(input, '');
          }
        });
      });

    byId('filter-category').addEventListener('change', event => {
      state.filterCategory = event.target.value;
      renderItems();
    });
    byId('filter-status').addEventListener('change', event => {
      state.filterPayment = event.target.value;
      renderItems();
    });
    byId('bp-plan-select').addEventListener('change', event => {
      const plan = state.plans.find(candidate => candidate.id === event.target.value);
      if (plan) {
        writeStorage(PLAN_PICK_KEY, plan.id);
        showPlanInUrl(plan.id);
        state.filterCategory = '';
        state.filterPayment = '';
        applyPlan(plan);
        render();
      }
    });
  }

  // The header's notification bell is shown once the visitor is known to be signed in.
  document.addEventListener('DOMContentLoaded', () => {
    const authState = window.__authState || window.AuthStateManager;
    if (authState && typeof authState.onchange === 'function') {
      authState.onchange(user => {
        const bell =
          document.getElementById('ef-notification-btn') ||
          document.getElementById('notification-bell');
        if (bell) {
          bell.style.display = user ? 'block' : 'none';
        }
      });
    }
  });

  /** Binds the page and loads the data. */
  function start() {
    bind();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
