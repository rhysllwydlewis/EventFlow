window.__EF_PAGE__ = 'dash_customer';

/** Debug logging — only emits when window.__EF_DEBUG__ is truthy. */
function dbg(...args) {
  if (window.__EF_DEBUG__) {
    console.log('[EF]', ...args); // eslint-disable-line no-console
  }
}

// --- Customer welcome overlay dismiss logic ---
(function initCustomerWelcomeOverlayDismiss() {
  const DISMISS_KEY = 'ef_customer_welcome_dismissed';

  function dismissCustomerWelcomeOverlay() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
      localStorage.setItem('ef_customer_welcome_dismissed', '1');
    } catch (_) {
      /* Ignore localStorage errors */
    }

    // Target the actual welcome section element used in the current HTML
    const section = document.getElementById('welcome-section');
    if (section) {
      const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
      section.style.transition = `opacity 0.3s ${ease}, transform 0.3s ${ease}`;
      section.style.opacity = '0';
      section.style.transform = 'scale(0.97)';
      setTimeout(() => {
        section.style.display = 'none';
      }, 300);
    }
  }

  window.dismissCustomerWelcome = dismissCustomerWelcomeOverlay;
})();

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
        container.innerHTML = '<p class="small" style="color:#667085;">Unable to load plans.</p>';
        return;
      }
      const data = await response.json();
      plans = data.plans || [];
    }

    if (plans.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">No plans yet</div>
          <div class="empty-state-description">Start planning your perfect event with our wizard.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = plans
      .map(plan => {
        const packageCount = (plan.packages || []).length;
        const displayName = plan.name || plan.eventName || plan.eventType || 'Untitled Event';
        const eventDate = plan.eventDate || plan.date;
        return `
        <div class="customer-plan-item" data-plan-id="${escapeHtml(plan.id)}">
          <div class="customer-plan-item__header">
            <div>
              <strong class="customer-plan-item__name">${escapeHtml(displayName)}</strong>
              ${plan.eventType ? `<span class="small customer-plan-item__type">${escapeHtml(plan.eventType)}</span>` : ''}
            </div>
            <span class="small customer-plan-item__count">${packageCount} packages</span>
          </div>
          ${plan.location ? `<p class="small customer-plan-item__detail">📍 ${escapeHtml(plan.location)}</p>` : ''}
          ${eventDate ? `<p class="small customer-plan-item__detail">📅 ${escapeHtml(formatPlanDate(eventDate) || eventDate)}</p>` : ''}
          <div class="customer-plan-item__actions" style="margin-top:0.75rem;display:flex;gap:0.5rem;padding-top:0.625rem;border-top:1px solid #f3f4f6;">
            <button class="cta secondary plan-edit-btn" data-plan-id="${escapeHtml(plan.id)}" style="padding:0.3rem 0.875rem;font-size: 0.75rem;border-radius:6px;" aria-label="Edit ${escapeHtml(displayName)}">✏️ Edit</button>
            <button class="plan-delete-btn" data-plan-id="${escapeHtml(plan.id)}" style="padding:0.3rem 0.875rem;font-size: 0.75rem;border-radius:6px;background:none;border:1px solid #fecaca;color:#dc2626;cursor:pointer;font-family:inherit;font-weight:600;font-size: 0.75rem;transition:background 0.15s,border-color 0.15s;" aria-label="Delete ${escapeHtml(displayName)}">🗑 Delete</button>
          </div>
        </div>
      `;
      })
      .join('');

    // Attach event listeners for edit/delete
    container.querySelectorAll('.plan-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const planId = btn.dataset.planId;
        const plan = plans.find(p => p.id === planId);
        if (plan) {
          showEditPlanModal(plan, () => loadCustomerPlans(null));
        }
      });
    });

    container.querySelectorAll('.plan-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const planId = btn.dataset.planId;
        const plan = plans.find(p => p.id === planId);
        if (plan) {
          confirmDeletePlan(plan, () => loadCustomerPlans(null));
        }
      });
    });
  } catch (err) {
    console.error('Error loading plans:', err);
    container.innerHTML = '<p class="small" style="color:#667085;">Error loading plans.</p>';
  }
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
        <button id="_pf_cancel" type="button" class="cta secondary">Cancel</button>
        <button id="_pf_save" type="button" class="cta">Save Changes</button>
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
        <button id="_del_cancel" type="button" class="cta secondary">Cancel</button>
        <button id="_del_confirm" type="button" class="cta" style="background:#ef4444;border-color:#ef4444;">Delete</button>
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

  // Personalize welcome message
  const welcomeHeading = document.getElementById('welcome-heading');
  if (welcomeHeading) {
    if (user.firstName) {
      welcomeHeading.textContent = `Welcome back, ${user.firstName}!`;
    } else if (user.name) {
      const firstName = user.name.split(' ')[0];
      welcomeHeading.textContent = `Welcome back, ${firstName}!`;
    } else {
      welcomeHeading.textContent = 'Welcome back!';
    }
  }

  // Welcome card dismiss logic (persisted in localStorage)
  const WELCOME_DISMISS_KEY = 'ef_welcome_dismissed';
  const welcomeSection = document.getElementById('welcome-section');
  if (welcomeSection) {
    let dismissed = false;
    try {
      dismissed =
        localStorage.getItem(WELCOME_DISMISS_KEY) === '1' ||
        localStorage.getItem('ef_customer_welcome_dismissed') === '1';
    } catch (_) {
      /* ignore storage errors */
    }
    if (dismissed) {
      welcomeSection.style.display = 'none';
    } else {
      const dismissBtn = document.getElementById('welcome-dismiss-btn');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          welcomeSection.style.display = 'none';
          try {
            localStorage.setItem(WELCOME_DISMISS_KEY, '1');
          } catch (_) {
            /* ignore storage errors */
          }
        });
      }
    }
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

  const componentNames = [
    'loadCustomerPlans',
    'initCustomerDashboardWidgets',
    'initCalendar',
    'initWeddingWebsiteDashboard',
  ];
  const settledResults = await Promise.allSettled([
    loadCustomerPlans(sharedPlans),
    initCustomerDashboardWidgets(sharedPlans),
    initCalendar(),
    window.initWeddingWebsiteDashboard
      ? window.initWeddingWebsiteDashboard(sharedPlans || [], user)
      : Promise.resolve(),
  ]);

  settledResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `Dashboard initialization: ${componentNames[index]} failed to initialize:`,
        result.reason
      );
    }
  });

  // Populate saved supplier status and make welcome section contextual
  populateSavedSupplierStatus();
  makeWelcomeContextual(sharedPlans || []);

  // Setup event handlers
  setupEventHandlers(sharedPlans);

  dbg('✅ Dashboard initialized successfully');
}

/**
 * Populate the saved suppliers dashboard status from the server shortlist API.
 * The count is also written back to localStorage so other parts of the UI stay
 * in sync with the authoritative shortlist data.
 */
async function populateSavedSupplierStatus() {
  let savedCount = 0;
  let savedSupplierIds = [];
  try {
    const r = await fetch('/api/v1/shortlist', { credentials: 'include' });
    if (r.ok) {
      const d = await r.json();
      const items = (d.data && d.data.items) || [];
      // Count only supplier-type items
      savedSupplierIds = items
        .filter(item => item.itemType === 'supplier' || !item.itemType)
        .map(item => item.supplierId || item.id || item.itemId)
        .filter(Boolean);
      savedCount = savedSupplierIds.length;
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
      savedCount = savedSupplierIds.length;
    } catch (__) {
      /* ignore */
    }
  }

  // Populate saved suppliers card status
  const savedStatusEl = document.getElementById('saved-suppliers-status');
  const openPlanBtn = document.getElementById('openPlanBtn');
  if (savedStatusEl) {
    if (savedCount === 0) {
      savedStatusEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⭐</div>
          <div class="empty-state-title">No saved suppliers yet</div>
          <div class="empty-state-description">Save your favorites while browsing to build your supplier shortlist.</div>
          <a href="/suppliers" class="empty-state-action">Browse Suppliers</a>
        </div>
      `;
      // Hide the "View Saved Items" button — the empty-state action above replaces it
      if (openPlanBtn) {
        openPlanBtn.style.display = 'none';
      }
    } else {
      savedStatusEl.innerHTML = `<p class="small" style="color:var(--ef-text-muted);margin:0 0 0.75rem;">${savedCount} saved supplier${savedCount !== 1 ? 's' : ''} in your list.</p>`;
      // Ensure the button is visible when there are saved suppliers
      if (openPlanBtn) {
        openPlanBtn.style.display = '';
      }
    }
  }
}

/**
 * Make welcome section contextual based on user data
 */
function makeWelcomeContextual(plans) {
  const promptContainer = document.getElementById('welcome-contextual-prompt');
  if (!promptContainer) {
    return;
  }

  if (plans.length === 0) {
    promptContainer.innerHTML = `
      <div class="customer-welcome-prompt">
        <span>🚀</span>
        <span>Ready to get started? <a href="/start" style="color:inherit;font-weight:600;text-decoration:underline;">Create your first event plan</a> to kick things off!</span>
      </div>`;
    return;
  }

  // Check if budget is set (server plan is authoritative)
  const hasBudget = plans.some(p => p.budget && parseFloat(p.budget) > 0);
  let lsBudget = null;
  try {
    lsBudget = localStorage.getItem('eventflow_custom_budget');
  } catch (_) {
    /* ignore */
  }

  if (!hasBudget && !lsBudget) {
    promptContainer.innerHTML = `
      <div class="customer-welcome-prompt customer-welcome-prompt--budget" role="link" tabindex="0" aria-label="Set your budget">
        <span>💰</span>
        <span>Don't forget to <a href="#budget-settings-form" style="color:inherit;font-weight:600;text-decoration:underline;">set your budget</a> so we can track your spending accurately.</span>
      </div>`;

    const budgetPrompt = promptContainer.querySelector('.customer-welcome-prompt--budget');
    const scrollToBudget = () => {
      const budgetForm = document.getElementById('budget-settings-form');
      if (budgetForm) {
        budgetForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const firstInput = budgetForm.querySelector('input, select, textarea, button');
        if (firstInput && typeof firstInput.focus === 'function') {
          firstInput.focus({ preventScroll: true });
        }
      } else {
        window.location.hash = 'budget-settings-form';
      }
    };

    if (budgetPrompt) {
      budgetPrompt.addEventListener('click', event => {
        if (event.target.closest('a')) {
          return;
        }
        scrollToBudget();
      });
      budgetPrompt.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          scrollToBudget();
        }
      });
    }
    return;
  }

  // Listen for unread count once it arrives from the messaging system (async).
  // makeWelcomeContextual can run more than once after dashboard refreshes, so guard
  // the window listener to avoid duplicate prompts and repeated DOM work.
  if (window.__heroUnreadListenerAdded) {
    return;
  }
  window.__heroUnreadListenerAdded = true;
  window.addEventListener('unreadCountUpdated', function onUnreadForPrompt(e) {
    window.removeEventListener('unreadCountUpdated', onUnreadForPrompt);
    const unreadCount =
      typeof e.detail?.count === 'number' ? Math.max(0, Math.floor(e.detail.count)) : 0;
    if (unreadCount > 0 && !promptContainer.querySelector('.customer-welcome-prompt--messages')) {
      const prompt = document.createElement('div');
      prompt.className = 'customer-welcome-prompt customer-welcome-prompt--messages';
      const icon = document.createElement('span');
      icon.textContent = '💬';
      const text = document.createElement('span');
      text.textContent = `You have ${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}. `;
      const link = document.createElement('a');
      link.href = '/messenger/';
      link.style.cssText = 'color:inherit;font-weight:600;text-decoration:underline;';
      link.textContent = 'Check your inbox';
      text.appendChild(link);
      prompt.appendChild(icon);
      prompt.appendChild(text);
      promptContainer.replaceChildren(prompt);
    }
  });
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
            '<p class="small customer-calendar-empty" style="text-align:center;color:#667085;padding:2rem 0;">📅 Calendar could not be loaded. <a href="/start">Create an event</a> to see it here.</p>';
        }
      }
    } else if (calendarEl) {
      calendarEl.innerHTML =
        '<p class="small customer-calendar-empty" style="text-align:center;color:#667085;padding:2rem 0;">📅 No events scheduled yet. <a href="/start">Create a plan</a> to see your calendar.</p>';
    }
    resolve();
  });
}

// Setup all event handlers
function setupEventHandlers(latestPlans) {
  // Setup Open My Plan button with auth-aware navigation
  document.getElementById('openPlanBtn')?.addEventListener('click', e => {
    e.preventDefault();

    // Collect ONLY supplier IDs (not package IDs) for the /suppliers?filter=saved redirect.
    // plan.suppliers holds supplier IDs; localStorage eventflow_saved_suppliers also holds
    // supplier IDs. plan.packages holds package IDs and must NOT be mixed in here.
    const savedSupplierIdSet = new Set();
    try {
      if (latestPlans && latestPlans.length > 0) {
        latestPlans.forEach(plan => {
          if (Array.isArray(plan.suppliers)) {
            plan.suppliers.forEach(id => savedSupplierIdSet.add(id));
          }
        });
      }
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
      // Show styled notification instead of alert
      const notification = document.createElement('div');
      notification.style.cssText =
        'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#FEF2F2;border:1px solid #FCA5A5;padding:1rem 1.5rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);z-index:10000;max-width:400px;';
      notification.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span style="font-size:1.5rem;">ℹ️</span>
          <div>
            <strong style="display:block;color:#991B1B;margin-bottom:0.25rem;">No Saved Suppliers</strong>
            <p style="margin:0;color:#7F1D1D;font-size: 0.875rem;">You haven't saved any suppliers yet. Browse suppliers to get started!</p>
          </div>
        </div>
      `;
      document.body.appendChild(notification);

      // Remove notification after 3 seconds and redirect
      setTimeout(() => {
        notification.remove();
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
    const budgetStatus = document.getElementById('budget-status');
    const budget = parseFloat(input.value);

    // Validate budget (also enforce in JS, not just HTML)
    // isFinite() guard rejects Infinity and -Infinity which pass isNaN/<=0
    if (isNaN(budget) || !isFinite(budget) || budget <= 0 || budget > 1_000_000_000) {
      budgetStatus.style.display = 'block';
      budgetStatus.style.background = '#FEF2F2';
      budgetStatus.innerHTML =
        '<p class="small" style="margin:0;color:#DC2626;">❌ Please enter a valid budget between £1 and £1,000,000,000</p>';
      return;
    }

    // Save to localStorage with error handling (fast client-side access)
    try {
      localStorage.setItem('eventflow_custom_budget', budget.toString());
    } catch (err) {
      console.error('Failed to save budget to localStorage:', err);
      budgetStatus.style.display = 'block';
      budgetStatus.style.background = '#FEF2F2';
      budgetStatus.innerHTML =
        '<p class="small" style="margin:0;color:#DC2626;">❌ Failed to save budget. Storage may be full.</p>';
      return;
    }

    // Also persist to server on the user's first/primary plan.
    // Always check response.ok — a CSRF/auth failure must not be silently swallowed.
    let serverSyncFailed = false;
    if (latestPlans && latestPlans.length > 0) {
      const primaryPlan = latestPlans[0];
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
        }
      } catch (err) {
        console.warn('Failed to persist budget to server (will use localStorage):', err);
        serverSyncFailed = true;
      }
    }

    // Show result — distinguish between full success and local-only save
    budgetStatus.style.display = 'block';
    if (serverSyncFailed) {
      budgetStatus.style.background = '#FFFBEB';
      const budgetP = document.createElement('p');
      budgetP.className = 'small';
      budgetP.style.cssText = 'margin:0;color:#92400E;';
      budgetP.textContent = `⚠️ Budget saved locally (£${budget.toLocaleString()}) but couldn't sync to server. It will be retried on next visit.`;
      budgetStatus.replaceChildren(budgetP);
    } else {
      budgetStatus.style.background = '#F0FDF4';
      const budgetP = document.createElement('p');
      budgetP.className = 'small';
      budgetP.style.cssText = 'margin:0;color:#059669;';
      budgetP.textContent = `✅ Budget set to £${budget.toLocaleString()}`;
      budgetStatus.replaceChildren(budgetP);
    }

    // Reload widgets with new budget - with error handling
    try {
      await initCustomerDashboardWidgets(latestPlans);
    } catch (err) {
      console.error('Failed to reload widgets after budget update:', err);
      // Don't show error to user since budget was saved successfully
      // Widgets will reload on next page visit
    }

    // Hide status message after 3 seconds
    setTimeout(() => {
      budgetStatus.style.display = 'none';
    }, 3000);
  });

  // Load saved budget on page load — prefer server plan budget, fall back to localStorage
  const budgetFromPlan =
    latestPlans && latestPlans.length > 0
      ? latestPlans.find(p => p.budget && parseFloat(p.budget) > 0)
      : null;

  try {
    const input = document.getElementById('custom-budget-input');
    if (input) {
      if (budgetFromPlan) {
        input.value = parseFloat(budgetFromPlan.budget);
        // Sync server value to localStorage for fast client-side access
        try {
          localStorage.setItem(
            'eventflow_custom_budget',
            String(parseFloat(budgetFromPlan.budget))
          );
        } catch (storageErr) {
          console.warn('Could not sync server budget to localStorage:', storageErr);
        }
      } else {
        const savedBudget = localStorage.getItem('eventflow_custom_budget');
        if (savedBudget) {
          input.value = savedBudget;
        }
      }
    }
  } catch (err) {
    console.error('Error loading saved budget:', err);
  }

  // Retry: if localStorage has a budget that didn't make it to the server (e.g. a
  // previous PATCH failed), silently attempt to sync it now.  This fulfils the
  // "will be retried on next visit" message shown when the initial save fails.
  if (!budgetFromPlan && latestPlans && latestPlans.length > 0) {
    let lsBudgetForRetry = null;
    try {
      lsBudgetForRetry = localStorage.getItem('eventflow_custom_budget');
    } catch (_) {
      /* ignore */
    }
    const pendingBudget = lsBudgetForRetry ? parseFloat(lsBudgetForRetry) : NaN;
    if (!isNaN(pendingBudget) && pendingBudget > 0) {
      const primaryPlan = latestPlans[0];
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
  banner.setAttribute('role', 'alert');
  banner.style.cssText =
    'background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:0.75rem 1rem;' +
    'margin-bottom:1rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;font-size:0.875rem;';

  const msg = document.createElement('span');
  msg.textContent =
    '⚠️ Please verify your email address to unlock all features. Check your inbox for a verification link.';
  msg.style.flex = '1';

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.textContent = 'Resend email';
  resendBtn.style.cssText =
    'background:none;border:1px solid #d97706;border-radius:6px;padding:0.25rem 0.75rem;' +
    'cursor:pointer;color:#92400e;font-size: 0.75rem;white-space:nowrap;';

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
        msg.textContent = '✓ Verification email sent! Please check your inbox.';
        resendBtn.remove();
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend email';
        msg.textContent = '⚠️ Could not resend verification email. Please try again.';
      }
    } catch (err) {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email';
    }
  });

  banner.appendChild(msg);
  banner.appendChild(resendBtn);

  const firstSection =
    document.querySelector('main > *:first-child, .cd-section, .dashboard-hero') ||
    document.body.firstElementChild;
  if (firstSection && firstSection.parentNode) {
    firstSection.parentNode.insertBefore(banner, firstSection);
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
