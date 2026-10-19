window.__EF_PAGE__ = 'dash_customer';

/** Debug logging — only emits when window.__EF_DEBUG__ is truthy. */
function dbg(...args) {
  if (window.__EF_DEBUG__) {
    console.log('[EF]', ...args); // eslint-disable-line no-console
  }
}

/** Plans the page last loaded; the budget form and the plan editor both work from this. */
let dashboardPlans = [];

/**
 * Draws the "Your plans" list (the page's own plans, or a fresh fetch when none are passed).
 * @param {Array} [preloadedPlans] - Plans already fetched by the caller
 */
async function loadCustomerPlans(preloadedPlans) {
  const container = document.getElementById('customer-plans-list');
  if (!container) {
    return;
  }

  try {
    let plans = [];
    if (preloadedPlans) {
      plans = preloadedPlans;
    } else {
      const response = await fetch('/api/me/plans', { credentials: 'include' });
      if (!response.ok) {
        container.innerHTML =
          '<p class="cdh-note">We could not load your plans. Please refresh to try again.</p>';
        return;
      }
      const data = await response.json();
      plans = data.plans || [];
    }
    dashboardPlans = plans;

    if (plans.length === 0) {
      container.innerHTML =
        '<div class="cdh-empty"><p class="cdh-empty__title">No plans yet</p><p class="cdh-empty__text">Start with the plan wizard and EventFlow will build your checklist.</p></div>';
      return;
    }

    const focus = window.CustomerDashboardHome
      ? window.CustomerDashboardHome.pickFocusPlan(plans)
      : null;

    container.innerHTML = plans
      .map(plan => {
        const packageCount = (plan.packages || []).length;
        const displayName = plan.name || plan.eventName || plan.eventType || 'Untitled Event';
        const eventDate = plan.eventDate || plan.date;
        const meta = [
          plan.eventType && plan.eventType !== displayName
            ? plan.eventType.charAt(0).toUpperCase() + plan.eventType.slice(1)
            : '',
          plan.location,
          eventDate ? formatPlanDate(eventDate) || eventDate : '',
          packageCount ? `${packageCount} package${packageCount === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .map(escapeHtml)
          .join(' · ');
        const inSummary =
          plans.length > 1 && focus && focus.id === plan.id
            ? '<span class="cdh-pill cdh-pill--accent">In your summary</span>'
            : '';
        return `
        <article class="customer-plan-item cdh-plan" data-plan-id="${escapeHtml(plan.id)}">
          <div class="cdh-plan__main">
            <h3 class="cdh-plan__name">${escapeHtml(displayName)} ${inSummary}</h3>
            ${meta ? `<p class="cdh-plan__meta">${meta}</p>` : '<p class="cdh-plan__meta">No details yet</p>'}
          </div>
          <div class="cdh-plan__actions">
            <button type="button" class="cdh-link plan-edit-btn" data-plan-id="${escapeHtml(plan.id)}" aria-label="Edit ${escapeHtml(displayName)}">Edit</button>
            <button type="button" class="cdh-link cdh-link--danger plan-delete-btn" data-plan-id="${escapeHtml(plan.id)}" aria-label="Delete ${escapeHtml(displayName)}">Delete</button>
          </div>
        </article>
      `;
      })
      .join('');

    // Attach event listeners for edit/delete
    container.querySelectorAll('.plan-edit-btn').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const plan = plans.find(candidate => candidate.id === btn.dataset.planId);
        if (plan) {
          showEditPlanModal(plan, reloadDashboard);
        }
      });
    });

    container.querySelectorAll('.plan-delete-btn').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const plan = plans.find(candidate => candidate.id === btn.dataset.planId);
        if (plan) {
          confirmDeletePlan(plan, reloadDashboard);
        }
      });
    });
  } catch (err) {
    console.error('Error loading plans:', err);
    container.innerHTML =
      '<p class="cdh-note">We could not load your plans. Please refresh to try again.</p>';
  }
}

/** Reloads the plans and redraws everything that depends on them. */
async function reloadDashboard() {
  let plans = dashboardPlans;
  try {
    const response = await fetch('/api/me/plans', { credentials: 'include' });
    if (response.ok) {
      plans = (await response.json()).plans || [];
    }
  } catch (err) {
    console.warn('Could not refresh plans:', err);
  }
  dashboardPlans = plans;
  await Promise.allSettled([
    loadCustomerPlans(plans),
    window.CustomerDashboardHome ? window.CustomerDashboardHome.render(plans) : Promise.resolve(),
    window.initWeddingWebsiteDashboard
      ? window.initWeddingWebsiteDashboard(plans)
      : Promise.resolve(),
  ]);
}

/**
 * Shows a native modal dialog: the browser traps focus inside it and closes it on Escape.
 * Focus goes back to the button that opened it when that button is still on the page.
 * @param {HTMLDialogElement} dialog - The dialog to show
 * @param {Element|null} opener - The element to return focus to
 */
function showDialog(dialog, opener) {
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener?.isConnected) {
      opener.focus();
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-dialog-close]')) {
      dialog.close();
    }
  });
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
}

/** Reads a JSON response body, or an empty object when the server sent something else. */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * Opens the Edit Plan dialog and PATCHes the plan on save.
 * @param {object} plan - The plan being edited
 * @param {Function} onSaved - Called after a successful save
 */
function showEditPlanModal(plan, onSaved) {
  document.getElementById('cdh-plan-edit-dialog')?.remove();
  const opener = document.activeElement;

  const dialog = document.createElement('dialog');
  dialog.id = 'cdh-plan-edit-dialog';
  dialog.className = 'cdh-dialog';
  dialog.setAttribute('aria-labelledby', 'cdh-plan-edit-title');
  dialog.innerHTML = `
    <form class="cdh-dialog__form" novalidate>
      <div class="cdh-dialog__head">
        <h2 class="cdh-dialog__title" id="cdh-plan-edit-title">Edit plan</h2>
        <button type="button" class="cdh-dialog__close" data-dialog-close aria-label="Close">&times;</button>
      </div>
      <div class="cdh-dialog__body">
        <div class="cdh-field">
          <label class="cdh-label" for="cdh-pf-name">Plan name</label>
          <input class="cdh-input" type="text" id="cdh-pf-name" value="${escapeHtml(plan.name || plan.eventType || '')}" maxlength="200" placeholder="e.g. Our wedding" autocomplete="off" required>
        </div>
        <div class="cdh-field">
          <label class="cdh-label" for="cdh-pf-date">Event date</label>
          <input class="cdh-input" type="date" id="cdh-pf-date" value="${escapeHtml((plan.eventDate || plan.date || '').split('T')[0])}">
        </div>
        <div class="cdh-field">
          <label class="cdh-label" for="cdh-pf-location">Location</label>
          <input class="cdh-input" type="text" id="cdh-pf-location" value="${escapeHtml(plan.location || '')}" maxlength="200" placeholder="e.g. London" autocomplete="off">
        </div>
        <div class="cdh-field">
          <label class="cdh-label" for="cdh-pf-notes">Notes</label>
          <textarea class="cdh-input cdh-input--area" id="cdh-pf-notes" rows="3" maxlength="2000" placeholder="Anything else worth keeping with this plan">${escapeHtml(plan.notes || '')}</textarea>
        </div>
        <p class="cdh-form-status" id="cdh-pf-status" role="status" aria-live="polite"></p>
      </div>
      <div class="cdh-dialog__foot">
        <button type="button" class="cdh-btn cdh-btn--quiet" data-dialog-close>Cancel</button>
        <button type="submit" class="cdh-btn cdh-btn--primary" id="cdh-pf-save">Save changes</button>
      </div>
    </form>
  `;

  const nameInput = dialog.querySelector('#cdh-pf-name');
  const statusEl = dialog.querySelector('#cdh-pf-status');
  const saveBtn = dialog.querySelector('#cdh-pf-save');
  nameInput.addEventListener('input', () => {
    statusEl.textContent = '';
    nameInput.removeAttribute('aria-invalid');
  });

  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = 'Enter a name for this plan.';
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    statusEl.textContent = '';
    try {
      const csrf = await ensureCsrfToken();
      const response = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({
          name,
          eventDate: dialog.querySelector('#cdh-pf-date').value || null,
          location: dialog.querySelector('#cdh-pf-location').value.trim() || null,
          notes: dialog.querySelector('#cdh-pf-notes').value.trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload.error || 'We could not save your changes. Please try again.');
      }
      dialog.close();
      if (typeof onSaved === 'function') {
        onSaved();
      }
    } catch (err) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  });

  showDialog(dialog, opener);
  nameInput.focus();
}

/**
 * Opens the Delete Plan confirmation and DELETEs the plan when confirmed.
 * @param {object} plan - The plan to delete
 * @param {Function} onDeleted - Called after a successful delete
 */
function confirmDeletePlan(plan, onDeleted) {
  document.getElementById('cdh-plan-delete-dialog')?.remove();
  const opener = document.activeElement;
  const displayName = escapeHtml(plan.name || plan.eventType || 'this plan');

  const dialog = document.createElement('dialog');
  dialog.id = 'cdh-plan-delete-dialog';
  dialog.className = 'cdh-dialog cdh-dialog--narrow';
  dialog.setAttribute('aria-labelledby', 'cdh-plan-delete-title');
  dialog.setAttribute('aria-describedby', 'cdh-plan-delete-text');
  dialog.innerHTML = `
    <div class="cdh-dialog__body">
      <h2 class="cdh-dialog__title" id="cdh-plan-delete-title">Delete ${displayName}?</h2>
      <p class="cdh-dialog__text" id="cdh-plan-delete-text">This removes the plan and everything saved on it, including its budget and guest list. It cannot be undone.</p>
      <p class="cdh-form-status" id="cdh-del-status" role="status" aria-live="polite"></p>
    </div>
    <div class="cdh-dialog__foot">
      <button type="button" class="cdh-btn cdh-btn--quiet" data-dialog-close autofocus>Cancel</button>
      <button type="button" class="cdh-btn cdh-btn--danger" id="cdh-del-confirm">Delete plan</button>
    </div>
  `;

  const confirmBtn = dialog.querySelector('#cdh-del-confirm');
  const statusEl = dialog.querySelector('#cdh-del-status');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    statusEl.textContent = '';
    try {
      const csrf = await ensureCsrfToken();
      const response = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload.error || 'We could not delete this plan. Please try again.');
      }
      dialog.close();
      if (typeof onDeleted === 'function') {
        onDeleted();
      }
    } catch (err) {
      statusEl.dataset.tone = 'error';
      statusEl.textContent = err.message;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete plan';
    }
  });

  showDialog(dialog, opener);
}

/** HTML-escapes a string for safe use in markup (non-strings become an empty string). */
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

/** Long British date in London time, or an empty string when the input is missing or invalid. */
function formatPlanDate(dateString) {
  if (!dateString) {
    return '';
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/London',
    });
  } catch {
    return '';
  }
}

/** Resolves to the signed-in user from /api/v1/auth/me, or null when signed out or on error. */
async function checkAuth() {
  try {
    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.user || null;
  } catch (error) {
    console.error('Auth check failed:', error);
    return null;
  }
}

/**
 * Scrolls to the section named in the URL hash (the guest list links to the wedding card, and
 * emails link to the calendar). The browser's own jump happens while the page is still hidden
 * by the sign-in guard and before the cards have their content, so it lands in the wrong place.
 * The budget form hash is handled by the home module, which opens the form.
 */
function scrollToHashTarget() {
  let id = '';
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return;
  }
  if (!id || id === 'budget-settings-form') {
    return;
  }
  const target = document.getElementById(id);
  if (target) {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
}

/** Page start-up: checks sign-in, then loads every dashboard section in parallel. */
async function initDashboard() {
  // Ensure a CSRF token is available before any state-changing requests
  await ensureCsrfToken();

  const user = await checkAuth();

  if (!user) {
    // Redirect to homepage if not authenticated
    window.location.href = '/';
    return;
  }

  // Personalise the greeting
  const welcomeHeading = document.getElementById('welcome-heading');
  if (welcomeHeading) {
    const firstName = user.firstName || (user.name ? user.name.split(' ')[0] : '');
    welcomeHeading.textContent = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
  }

  // Check for guest plan token and claim it
  await claimGuestPlanIfExists();

  // Show email verification banner if user is not yet verified
  if (!user.verified && !user.emailVerified) {
    showCustomerEmailVerificationBanner(user.email);
  }

  // Load all dashboard components IN PARALLEL
  // Fetch /api/me/plans once and share the result to avoid duplicate requests
  let sharedPlans = null;
  try {
    const plansResponse = await fetch('/api/me/plans', { credentials: 'include' });
    if (plansResponse.ok) {
      const plansData = await plansResponse.json();
      sharedPlans = plansData.plans || [];
    }
  } catch (err) {
    console.error('Error pre-fetching plans:', err);
  }
  dashboardPlans = sharedPlans || [];

  document.addEventListener('cdh:reload', reloadDashboard);
  document.addEventListener('cdh:edit-plan', event => {
    const plan = dashboardPlans.find(candidate => candidate.id === event.detail?.planId);
    if (plan) {
      showEditPlanModal(plan, reloadDashboard);
    }
  });

  const componentNames = [
    'loadCustomerPlans',
    'CustomerDashboardHome.render',
    'initCalendar',
    'initWeddingWebsiteDashboard',
    'populateSavedSupplierStatus',
  ];
  const settledResults = await Promise.allSettled([
    loadCustomerPlans(sharedPlans),
    window.CustomerDashboardHome
      ? window.CustomerDashboardHome.render(sharedPlans)
      : Promise.resolve(),
    initCalendar(),
    window.initWeddingWebsiteDashboard
      ? window.initWeddingWebsiteDashboard(sharedPlans || [], user)
      : Promise.resolve(),
    populateSavedSupplierStatus(),
  ]);

  settledResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `Dashboard initialization: ${componentNames[index]} failed to initialize:`,
        result.reason
      );
    }
  });

  // Setup event handlers
  setupEventHandlers();

  scrollToHashTarget();

  dbg('✅ Dashboard initialized successfully');
}

/**
 * Turns the HTML entities the shortlist API stores (it escapes names on the way in, so "Tom & Co"
 * is kept as "Tom &amp; Co") back into text, so escapeHtml does not escape them a second time.
 * A textarea only ever holds text, so nothing in the value is parsed as markup.
 * @param {*} value - A stored string
 * @returns {string} The plain text
 */
function decodeEntities(value) {
  const holder = document.createElement('textarea');
  holder.innerHTML = String(value ?? '');
  return holder.value;
}

/**
 * Where a saved supplier's row should go: its own canonical link when the shortlist kept one,
 * the supplier profile path when the item carries it, otherwise the saved list (shortlist items
 * saved from a profile page carry neither).
 * @param {object} item - A shortlist item
 * @returns {string} An internal path
 */
function savedSupplierHref(item) {
  const own = typeof item.href === 'string' ? item.href : '';
  if (
    /^\/(?!\/)[\w\-./~%?=&]*$/u.test(own) &&
    !own.includes('..') &&
    !own.startsWith('/supplier?id=') &&
    !own.startsWith('/category?slug=')
  ) {
    return own;
  }
  const profile = window.EventFlowSupplierLink?.supplierProfileHref
    ? window.EventFlowSupplierLink.supplierProfileHref(item)
    : '/suppliers';
  return profile === '/suppliers' ? '/suppliers?filter=saved' : profile;
}

/**
 * Populate the saved suppliers card from the server shortlist API.
 * The count is also written back to localStorage so other parts of the UI stay
 * in sync with the authoritative shortlist data.
 */
async function populateSavedSupplierStatus() {
  const MAX_LISTED = 4;
  let savedItems = [];
  let savedSupplierIds = [];
  let loaded = false;
  try {
    const response = await fetch('/api/v1/shortlist', { credentials: 'include' });
    if (response.ok) {
      const payload = await response.json();
      const items = payload.data?.items || [];
      // Count only supplier-type items
      savedItems = items.filter(item => {
        const kind = item.type || item.itemType;
        return kind === 'supplier' || !kind;
      });
      savedSupplierIds = savedItems
        .map(item => item.supplierId || item.id || item.itemId)
        .filter(Boolean);
      loaded = true;
      // Keep legacy localStorage key in sync so redirect logic still works
      try {
        localStorage.setItem('eventflow_saved_suppliers', JSON.stringify(savedSupplierIds));
      } catch {
        /* ignore */
      }
    }
  } catch {
    // Fallback to localStorage on network error
    try {
      savedSupplierIds = JSON.parse(localStorage.getItem('eventflow_saved_suppliers') || '[]');
    } catch {
      /* ignore */
    }
  }
  const savedCount = savedSupplierIds.length;

  const savedStatusEl = document.getElementById('saved-suppliers-status');
  const openPlanBtn = document.getElementById('openPlanBtn');
  if (!savedStatusEl) {
    return;
  }

  if (savedCount === 0) {
    savedStatusEl.innerHTML =
      '<div class="cdh-empty"><p class="cdh-empty__title">No saved suppliers yet</p><p class="cdh-empty__text">Save suppliers while you browse and they will be kept here for you to compare.</p><a href="/suppliers" class="cdh-btn cdh-btn--primary cdh-btn--sm">Browse suppliers</a></div>';
    // The empty state's own action replaces the "View saved suppliers" button
    if (openPlanBtn) {
      openPlanBtn.hidden = true;
    }
    return;
  }

  if (openPlanBtn) {
    openPlanBtn.hidden = false;
  }
  const rows = savedItems
    .slice(0, MAX_LISTED)
    .map(item => {
      const href = escapeHtml(savedSupplierHref(item));
      const name = escapeHtml(decodeEntities(item.name || 'Supplier'));
      const category = item.category ? escapeHtml(decodeEntities(item.category)) : '';
      return `<li><a class="cdh-list__link" href="${href}"><span class="cdh-list__name">${name}</span>${category ? `<span class="cdh-list__meta">${category}</span>` : ''}</a></li>`;
    })
    .join('');
  const more =
    savedCount > MAX_LISTED ? `<p class="cdh-note">and ${savedCount - MAX_LISTED} more</p>` : '';
  const heading = `${savedCount} saved supplier${savedCount === 1 ? '' : 's'}`;
  savedStatusEl.innerHTML = `<p class="cdh-note cdh-note--lead">${heading}</p>${rows ? `<ul class="cdh-list">${rows}</ul>` : ''}${rows ? more : ''}`;
  if (!loaded) {
    savedStatusEl.insertAdjacentHTML(
      'beforeend',
      '<p class="cdh-note">Showing your last saved list while we reconnect.</p>'
    );
  }
}

/** Starts the events calendar, resolving once it has been set up (or its fallback message shown). */
function initCalendar() {
  return new Promise(resolve => {
    const calendarEl = document.getElementById('events-calendar');
    if (window.CalendarView && calendarEl) {
      try {
        window.CalendarView.init('events-calendar', {
          initialView: 'dayGridMonth',
          height: 'auto',
        });
        dbg('✅ Calendar initialized');
      } catch (err) {
        console.error('Calendar init failed:', err);
        if (calendarEl) {
          calendarEl.innerHTML =
            '<p class="cdh-note customer-calendar-empty">Calendar could not be loaded. <a href="/start">Create an event</a> to see it here.</p>';
        }
      }
    } else if (calendarEl) {
      calendarEl.innerHTML =
        '<p class="cdh-note customer-calendar-empty">No events scheduled yet. <a href="/start">Create a plan</a> to see your calendar.</p>';
    }
    resolve();
  });
}

/** Shows a short message under the budget form. tone: success | warn | error */
function showBudgetStatus(message, tone) {
  const budgetStatus = document.getElementById('budget-status');
  if (!budgetStatus) {
    return;
  }
  budgetStatus.dataset.tone = tone;
  budgetStatus.textContent = message;
}

/** A brief non-blocking notice at the top of the page. */
function showPageNotice(title, message) {
  const notice = document.createElement('div');
  notice.className = 'cdh-toast';
  notice.setAttribute('role', 'status');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('span');
  text.textContent = message;
  notice.append(strong, text);
  document.body.appendChild(notice);
  return notice;
}

/** Wires the Open My Plan button and the budget form, and syncs the stored budget with the server. */
function setupEventHandlers() {
  /** The plan the summary row describes — the budget form must edit that same plan. */
  const focusPlan = () =>
    window.CustomerDashboardHome?.pickFocusPlan(dashboardPlans) || dashboardPlans[0] || null;

  // Setup Open My Plan button with auth-aware navigation
  document.getElementById('openPlanBtn')?.addEventListener('click', event => {
    event.preventDefault();

    // Collect ONLY supplier IDs (not package IDs) for the /suppliers?filter=saved redirect.
    // plan.suppliers holds supplier IDs; localStorage eventflow_saved_suppliers also holds
    // supplier IDs. plan.packages holds package IDs and must NOT be mixed in here.
    const savedSupplierIdSet = new Set();
    try {
      dashboardPlans.forEach(plan => {
        if (Array.isArray(plan.suppliers)) {
          plan.suppliers.forEach(id => savedSupplierIdSet.add(id));
        }
      });
    } catch (err) {
      console.error('Error reading supplier IDs from plans:', err);
    }

    // Fallback: localStorage saved suppliers
    if (savedSupplierIdSet.size === 0) {
      try {
        const lsSaved = JSON.parse(localStorage.getItem('eventflow_saved_suppliers') || '[]');
        lsSaved.forEach(id => savedSupplierIdSet.add(id));
      } catch (err) {
        console.error('Error reading saved suppliers from localStorage:', err);
      }
    }

    if (savedSupplierIdSet.size === 0) {
      const notice = showPageNotice(
        'No saved suppliers',
        "You haven't saved any suppliers yet. Taking you to browse suppliers."
      );
      // Remove notification after 3 seconds and redirect
      setTimeout(() => {
        notice.remove();
        window.location.href = '/suppliers';
      }, 3000);
    } else {
      // Redirect to suppliers page with saved filter
      window.location.href = '/suppliers?filter=saved';
    }
  });

  // Budget settings handler
  document.getElementById('budget-settings-form')?.addEventListener('submit', async event => {
    event.preventDefault();

    const input = document.getElementById('custom-budget-input');
    const budget = parseFloat(input.value);

    // Validate budget (also enforce in JS, not just HTML)
    // isFinite() guard rejects Infinity and -Infinity which pass isNaN/<=0
    if (isNaN(budget) || !isFinite(budget) || budget <= 0 || budget > 1_000_000_000) {
      showBudgetStatus('Please enter a budget between £1 and £1,000,000,000.', 'error');
      return;
    }

    // Save to localStorage with error handling (fast client-side access)
    try {
      localStorage.setItem('eventflow_custom_budget', budget.toString());
    } catch (err) {
      console.error('Failed to save budget to localStorage:', err);
      showBudgetStatus('Failed to save budget. Storage may be full.', 'error');
      return;
    }

    // Also persist to server on the focus plan (the one the summary row describes).
    // Always check response.ok — a CSRF/auth failure must not be silently swallowed.
    let serverSyncFailed = false;
    const primaryPlan = focusPlan();
    if (primaryPlan) {
      try {
        const patchResp = await fetch(`/api/me/plans/${encodeURIComponent(primaryPlan.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          credentials: 'include',
          body: JSON.stringify({ budget }),
        });
        if (!patchResp.ok) {
          console.warn('Budget PATCH failed with status:', patchResp.status);
          serverSyncFailed = true;
        } else {
          // Keep the in-memory plan current so the summary shows the new figure straight away
          primaryPlan.budget = budget;
        }
      } catch (err) {
        console.warn('Failed to persist budget to server (will use localStorage):', err);
        serverSyncFailed = true;
      }
    }

    // Show result — distinguish between full success and local-only save
    if (serverSyncFailed) {
      showBudgetStatus(
        `Budget saved locally (£${budget.toLocaleString()}) but couldn't sync to server. It will be retried on next visit.`,
        'warn'
      );
      // Show the figure the person just entered, not the stale server value
      if (primaryPlan) {
        primaryPlan.budget = budget;
      }
    } else {
      showBudgetStatus(`Budget set to £${budget.toLocaleString()}`, 'success');
    }

    // Redraw the summary with the new budget
    try {
      if (window.CustomerDashboardHome) {
        await window.CustomerDashboardHome.render(dashboardPlans);
      }
    } catch (err) {
      console.error('Failed to refresh the summary after budget update:', err);
      // Don't show error to user since budget was saved successfully
    }

    // Close the form shortly afterwards so the new figure is visible
    setTimeout(() => {
      document.getElementById('budget-settings-cancel')?.click();
      showBudgetStatus('', 'success');
    }, 2500);
  });

  // Load saved budget on page load — prefer server plan budget, fall back to localStorage
  const budgetFromPlan = dashboardPlans.length
    ? dashboardPlans.find(candidate => candidate.budget && parseFloat(candidate.budget) > 0)
    : null;

  try {
    const input = document.getElementById('custom-budget-input');
    if (input) {
      const focusBudget = window.CustomerDashboardHome
        ? window.CustomerDashboardHome.totalBudgetFor(focusPlan(), dashboardPlans)
        : 0;
      if (focusBudget > 0) {
        input.value = focusBudget;
      }
    }
    if (budgetFromPlan) {
      // Sync server value to localStorage for fast client-side access
      try {
        localStorage.setItem('eventflow_custom_budget', String(parseFloat(budgetFromPlan.budget)));
      } catch (storageErr) {
        console.warn('Could not sync server budget to localStorage:', storageErr);
      }
    }
  } catch (err) {
    console.error('Error loading saved budget:', err);
  }

  // Retry: if localStorage has a budget that didn't make it to the server (e.g. a
  // previous PATCH failed), silently attempt to sync it now.  This fulfils the
  // "will be retried on next visit" message shown when the initial save fails.
  if (!budgetFromPlan && dashboardPlans.length > 0) {
    let lsBudgetForRetry = null;
    try {
      lsBudgetForRetry = localStorage.getItem('eventflow_custom_budget');
    } catch {
      /* ignore */
    }
    const pendingBudget = lsBudgetForRetry ? parseFloat(lsBudgetForRetry) : NaN;
    if (!isNaN(pendingBudget) && pendingBudget > 0) {
      const primaryPlan = focusPlan();
      // Fire-and-forget: don't block page load; failures are non-fatal
      (async () => {
        try {
          const retryCsrf = await ensureCsrfToken();
          const retryResp = await fetch(`/api/me/plans/${encodeURIComponent(primaryPlan.id)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': retryCsrf,
            },
            credentials: 'include',
            body: JSON.stringify({ budget: pendingBudget }),
          });
          if (retryResp.ok) {
            dbg('✅ Budget synced to server on page load (retry after previous failed sync)');
          } else {
            console.warn('Budget server retry on load failed with status:', retryResp.status);
          }
        } catch (err) {
          console.warn('Budget server retry on load failed:', err);
        }
      })();
    }
  }
}

/**
 * Claim guest plan if token exists in localStorage
 */
async function claimGuestPlanIfExists() {
  const guestToken = localStorage.getItem('eventflow_guest_plan_token');

  if (!guestToken) {
    return; // No guest plan to claim
  }

  try {
    // Get CSRF token
    const csrfToken = getCsrfToken();

    const response = await fetch('/api/me/plans/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({ token: guestToken }),
    });

    if (response.ok) {
      // Successfully claimed
      localStorage.removeItem('eventflow_guest_plan_token');
      dbg('Guest plan claimed successfully');
    } else {
      const error = await response.json();
      console.warn('Failed to claim guest plan:', error.error);
      // Remove token even if claim failed (might be expired or already claimed)
      localStorage.removeItem('eventflow_guest_plan_token');
    }
  } catch (error) {
    console.error('Error claiming guest plan:', error);
    // Don't remove token on network error - try again next time
  }
}

/**
 * Get CSRF token — checks cached global, then meta tag, then cookie.
 * Call ensureCsrfToken() at init time to populate window.__CSRF_TOKEN__.
 */
function getCsrfToken() {
  if (window.__CSRF_TOKEN__) {
    return window.__CSRF_TOKEN__;
  }
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta?.getAttribute('content')) {
    return meta.getAttribute('content');
  }
  // Try cookies (both canonical and legacy names)
  const match = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/u);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return '';
}

/**
 * Fetch and cache a CSRF token from the server.
 * Also updates the meta tag and window.__CSRF_TOKEN__ for other callers.
 */
async function ensureCsrfToken() {
  if (window.__CSRF_TOKEN__) {
    return window.__CSRF_TOKEN__;
  }
  try {
    const resp = await fetch('/api/csrf-token', { credentials: 'include' });
    if (resp.ok) {
      const data = await resp.json();
      const token = data.csrfToken || data.token || '';
      if (token) {
        window.__CSRF_TOKEN__ = token;
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
          meta.setAttribute('content', token);
        }
      }
      return token;
    }
  } catch {
    /* network error — fall back to cookie/meta if available */
  }
  return getCsrfToken();
}

/**
 * Show a persistent email-verification reminder banner at the top of the customer dashboard.
 * Includes a "Resend" link that fires the resend API and shows inline feedback.
 * @param {string} email - The user's email address
 */
async function showCustomerEmailVerificationBanner(email) {
  if (document.getElementById('email-verify-banner')) {
    return;
  }

  const csrfToken = await ensureCsrfToken();

  const banner = document.createElement('div');
  banner.id = 'email-verify-banner';
  banner.className = 'cdh-banner';
  banner.setAttribute('role', 'alert');

  const msg = document.createElement('span');
  msg.className = 'cdh-banner__text';
  msg.textContent =
    'Please verify your email address to unlock all features. Check your inbox for a verification link.';

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.className = 'cdh-btn cdh-btn--secondary cdh-btn--sm';
  resendBtn.textContent = 'Resend email';

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    try {
      const token = csrfToken || getCsrfToken();
      const resp = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      if (resp.ok) {
        msg.textContent = 'Verification email sent. Please check your inbox.';
        resendBtn.remove();
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend email';
        msg.textContent = 'Could not resend the verification email. Please try again.';
      }
    } catch {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email';
    }
  });

  banner.appendChild(msg);
  banner.appendChild(resendBtn);

  // Sit above the greeting, inside the page column
  const hero = document.querySelector('.cdh-hero');
  if (hero?.parentNode) {
    hero.parentNode.insertBefore(banner, hero);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
  }
}

// Single initialization call - use readyState check for reliability
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}
