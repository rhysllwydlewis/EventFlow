window.__EF_PAGE__ = 'dash_customer';

/** Debug logging — only emits when window.__EF_DEBUG__ is truthy. */
function dbg(...args) {
  if (window.__EF_DEBUG__) {
    console.log('[EF]', ...args); // eslint-disable-line no-console
  }
}

/** Plans the page last loaded; the budget form and the plan editor both work from this. */
let dashboardPlans = [];

// Load customer plans
async function loadCustomerPlans(preloadedPlans) {
  const container = document.getElementById('customer-plans-list');
  if (!container) {
    return;
  }

  try {
    let plans;
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
      container.innerHTML = `
        <div class="cdh-empty">
          <p class="cdh-empty__title">No plans yet</p>
          <p class="cdh-empty__text">Start with the plan wizard and EventFlow will build your checklist.</p>
        </div>
      `;
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
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const plan = plans.find(p => p.id === btn.dataset.planId);
        if (plan) {
          showEditPlanModal(plan, reloadDashboard);
        }
      });
    });

    container.querySelectorAll('.plan-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const plan = plans.find(p => p.id === btn.dataset.planId);
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

function showEditPlanModal(plan, onSaved) {
  // Inject animation keyframes once
  if (!document.getElementById('_dash_modal_styles')) {
    const s = document.createElement('style');
    s.id = '_dash_modal_styles';
    s.textContent =
      '@keyframes ef-modal-in{from{opacity:0;transform:translateY(10px) scale(0.98)}to{opacity:1;transform:none}}';
    document.head.appendChild(s);
  }

  const titleId = '_dash_plan_edit_title';
  const existing = document.getElementById('_dash_plan_edit_modal');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = '_dash_plan_edit_modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', titleId);
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.2);max-height:90vh;overflow-y:auto;animation:ef-modal-in 0.2s ease both;">
      <div style="padding:1.25rem 1.5rem;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;">
        <h3 id="${titleId}" style="margin:0;font-size: 1.125rem;font-weight:700;">Edit Plan</h3>
        <button id="_dash_plan_edit_close" type="button" aria-label="Close" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size: 1.5rem;line-height:1;padding:0.25rem;">&times;</button>
      </div>
      <div style="padding:1.5rem;">
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.35rem;">Plan Name</label>
          <input type="text" id="_pf_name" value="${escapeHtml(plan.name || plan.eventType || '')}" style="width:100%;box-sizing:border-box;padding:0.625rem 0.75rem;border:1.5px solid #e5e7eb;border-radius:6px;font-size: 0.875rem;font-family:inherit;" maxlength="200" placeholder="e.g. Our Wedding 2025">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.35rem;">Event Date</label>
          <input type="date" id="_pf_date" value="${escapeHtml((plan.eventDate || plan.date || '').split('T')[0])}" style="width:100%;box-sizing:border-box;padding:0.625rem 0.75rem;border:1.5px solid #e5e7eb;border-radius:6px;font-size: 0.875rem;font-family:inherit;">
        </div>
        <div style="margin-bottom:1rem;">
          <label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.35rem;">Location</label>
          <input type="text" id="_pf_location" value="${escapeHtml(plan.location || '')}" style="width:100%;box-sizing:border-box;padding:0.625rem 0.75rem;border:1.5px solid #e5e7eb;border-radius:6px;font-size: 0.875rem;font-family:inherit;" maxlength="200" placeholder="e.g. London">
        </div>
        <div>
          <label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:0.35rem;">Notes</label>
          <textarea id="_pf_notes" rows="3" style="width:100%;box-sizing:border-box;padding:0.625rem 0.75rem;border:1.5px solid #e5e7eb;border-radius:6px;font-size: 0.875rem;font-family:inherit;" maxlength="2000" placeholder="Any additional notes…">${escapeHtml(plan.notes || '')}</textarea>
        </div>
        <p id="_pf_status" style="font-size:0.875rem;margin:0.75rem 0 0;" role="status" aria-live="polite"></p>
      </div>
      <div style="padding:1rem 1.5rem;border-top:1px solid #f3f4f6;display:flex;justify-content:flex-end;gap:0.75rem;">
        <button id="_pf_cancel" type="button" class="cdh-btn cdh-btn--secondary">Cancel</button>
        <button id="_pf_save" type="button" class="cdh-btn cdh-btn--primary">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleEscEdit);
  };
  function handleEscEdit(e) {
    if (e.key === 'Escape') {
      close();
    }
  }
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleEscEdit);
  overlay.querySelector('#_dash_plan_edit_close').addEventListener('click', close);
  overlay.querySelector('#_pf_cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      close();
    }
  });

  overlay.querySelector('#_pf_save').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('#_pf_save');
    const statusEl = overlay.querySelector('#_pf_status');
    const name = overlay.querySelector('#_pf_name').value.trim();
    if (!name) {
      statusEl.textContent = '✗ Plan name is required';
      statusEl.style.color = '#ef4444';
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    statusEl.textContent = '';
    try {
      const csrf = await getCsrfToken();
      const r = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: JSON.stringify({
          name,
          eventDate: overlay.querySelector('#_pf_date').value || null,
          location: overlay.querySelector('#_pf_location').value.trim() || null,
          notes: overlay.querySelector('#_pf_notes').value.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.error || 'Failed to save');
      }
      close();
      if (typeof onSaved === 'function') {
        onSaved();
      }
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.style.color = '#ef4444';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
}

function confirmDeletePlan(plan, onDeleted) {
  const displayName = escapeHtml(plan.name || plan.eventType || 'this plan');
  const existing = document.getElementById('_dash_plan_delete_modal');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = '_dash_plan_delete_modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.2);padding:1.5rem;animation:ef-modal-in 0.2s ease both;">
      <h3 style="margin:0 0 0.75rem;font-size: 1.125rem;font-weight:700;">Delete Plan</h3>
      <p style="margin:0 0 1.5rem;font-size: 0.875rem;color:#374151;">Are you sure you want to delete <strong>${displayName}</strong>? This cannot be undone.</p>
      <p id="_del_status" style="font-size:0.875rem;margin:0 0 0.75rem;color:#ef4444;" role="status" aria-live="polite"></p>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button id="_del_cancel" type="button" class="cdh-btn cdh-btn--secondary">Cancel</button>
        <button id="_del_confirm" type="button" class="cdh-btn cdh-btn--danger">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleEscDel);
  };
  function handleEscDel(e) {
    if (e.key === 'Escape') {
      close();
    }
  }
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleEscDel);
  overlay.querySelector('#_del_cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      close();
    }
  });

  overlay.querySelector('#_del_confirm').addEventListener('click', async () => {
    const delBtn = overlay.querySelector('#_del_confirm');
    const statusEl = overlay.querySelector('#_del_status');
    delBtn.disabled = true;
    delBtn.textContent = 'Deleting…';
    try {
      const csrf = await getCsrfToken();
      const r = await fetch(`/api/me/plans/${encodeURIComponent(plan.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.error || 'Failed to delete');
      }
      close();
      if (typeof onDeleted === 'function') {
        onDeleted();
      }
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      delBtn.disabled = false;
      delBtn.textContent = 'Delete';
    }
  });
}

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

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
  } catch (_) {
    return '';
  }
}

// Check authentication on page load
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

// Setup navigation with auth check and consolidated initialization
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
  let sharedPlans;
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
    const plan = dashboardPlans.find(p => p.id === event.detail?.planId);
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

  dbg('✅ Dashboard initialized successfully');
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
    const r = await fetch('/api/v1/shortlist', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      const items = (d.data && d.data.items) || [];
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
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    // Fallback to localStorage on network error
    try {
      savedSupplierIds = JSON.parse(localStorage.getItem('eventflow_saved_suppliers') || '[]');
    } catch (__) {
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
    savedStatusEl.innerHTML = `
      <div class="cdh-empty">
        <p class="cdh-empty__title">No saved suppliers yet</p>
        <p class="cdh-empty__text">Save suppliers while you browse and they will be kept here for you to compare.</p>
        <a href="/suppliers" class="cdh-btn cdh-btn--primary cdh-btn--sm">Browse suppliers</a>
      </div>
    `;
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
      const href =
        window.EventFlowSupplierLink && window.EventFlowSupplierLink.supplierProfileHref
          ? window.EventFlowSupplierLink.supplierProfileHref(item)
          : '/suppliers';
      const name = escapeHtml(String(item.name || 'Supplier'));
      const category = item.category ? escapeHtml(String(item.category)) : '';
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

// Initialize calendar
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

// Setup all event handlers
function setupEventHandlers() {
  // The plan the summary row describes — the budget form must edit that same plan.
  const focusPlan = () =>
    (window.CustomerDashboardHome && window.CustomerDashboardHome.pickFocusPlan(dashboardPlans)) ||
    dashboardPlans[0] ||
    null;

  // Setup Open My Plan button with auth-aware navigation
  document.getElementById('openPlanBtn')?.addEventListener('click', e => {
    e.preventDefault();

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
  document.getElementById('budget-settings-form')?.addEventListener('submit', async e => {
    e.preventDefault();

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
    ? dashboardPlans.find(p => p.budget && parseFloat(p.budget) > 0)
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
    } catch (_) {
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
  if (meta && meta.getAttribute('content')) {
    return meta.getAttribute('content');
  }
  // Try cookies (both canonical and legacy names)
  const match = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
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
  } catch (_) {
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
    } catch (err) {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email';
    }
  });

  banner.appendChild(msg);
  banner.appendChild(resendBtn);

  // Sit above the greeting, inside the page column
  const hero = document.querySelector('.cdh-hero');
  if (hero && hero.parentNode) {
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
