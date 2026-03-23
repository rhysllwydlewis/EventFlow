window.__EF_PAGE__ = 'dash_customer';

/** Debug logging — only emits when window.__EF_DEBUG__ is truthy. */
function dbg(...args) {
  if (window.__EF_DEBUG__) {
    console.log('[EF]', ...args); // eslint-disable-line no-console
  }
}

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
        return `
        <div class="customer-plan-item">
          <div class="customer-plan-item__header">
            <div>
              <strong class="customer-plan-item__name">${escapeHtml(displayName)}</strong>
              ${plan.eventType ? `<span class="small customer-plan-item__type">${escapeHtml(plan.eventType)}</span>` : ''}
            </div>
            <span class="small customer-plan-item__count">${packageCount} packages</span>
          </div>
          ${plan.location ? `<p class="small customer-plan-item__detail">📍 ${escapeHtml(plan.location)}</p>` : ''}
          ${plan.date ? `<p class="small customer-plan-item__detail">📅 ${escapeHtml(formatPlanDate(plan.date) || plan.date)}</p>` : ''}
        </div>
      `;
      })
      .join('');
  } catch (err) {
    console.error('Error loading plans:', err);
    container.innerHTML = '<p class="small" style="color:#667085;">Error loading plans.</p>';
  }
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
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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

  // Time-based greeting for hero section
  const heroGreeting = document.getElementById('customer-hero-greeting');
  if (heroGreeting) {
    const hour = new Date().getHours();
    const MORNING_START = 5;
    const AFTERNOON_START = 12;
    const EVENING_START = 17;
    let greeting = 'Good evening';
    if (hour >= MORNING_START && hour < AFTERNOON_START) {
      greeting = 'Good morning';
    } else if (hour >= AFTERNOON_START && hour < EVENING_START) {
      greeting = 'Good afternoon';
    }
    const firstName = user.firstName || (user.name ? user.name.split(' ')[0] : null);
    heroGreeting.textContent = firstName ? `${greeting}, ${firstName}!` : `${greeting}!`;
  }

  // Personalize welcome message
  const welcomeHeading = document.getElementById('welcome-heading');
  if (welcomeHeading) {
    if (user.firstName) {
      welcomeHeading.textContent = `Welcome ${user.firstName}!`;
    } else if (user.name) {
      const firstName = user.name.split(' ')[0];
      welcomeHeading.textContent = `Welcome ${firstName}!`;
    } else {
      welcomeHeading.textContent = `Welcome to EventFlow!`;
    }
  }

  // Check for guest plan token and claim it
  await claimGuestPlanIfExists();

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

  const componentNames = ['loadCustomerPlans', 'initCustomerDashboardWidgets', 'initCalendar'];
  const settledResults = await Promise.allSettled([
    loadCustomerPlans(sharedPlans),
    initCustomerDashboardWidgets(sharedPlans),
    initCalendar(),
  ]);

  settledResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(
        `Dashboard initialization: ${componentNames[index]} failed to initialize:`,
        result.reason
      );
    }
  });

  // Populate hero stats and make welcome section contextual
  populateHeroStats(sharedPlans || []);
  makeWelcomeContextual(sharedPlans || []);

  // Setup event handlers
  setupEventHandlers(sharedPlans);

  dbg('✅ Dashboard initialized successfully');
}

/**
 * Populate the hero section stats from loaded data
 */
function populateHeroStats(plans) {
  // Plans count
  const heroPlans = document.getElementById('hero-stat-plans');
  if (heroPlans) {
    heroPlans.textContent = plans.length;
  }

  // Saved suppliers (from localStorage with server-plan cross-reference)
  let savedCount = 0;
  try {
    const lsSaved = JSON.parse(localStorage.getItem('eventflow_saved_suppliers') || '[]');
    savedCount = lsSaved.length;
  } catch (_) {
    /* ignore */
  }
  const heroSuppliers = document.getElementById('hero-stat-suppliers');
  if (heroSuppliers) {
    heroSuppliers.textContent = savedCount;
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

  // Days to event (nearest upcoming plan with a date)
  const heroDays = document.getElementById('hero-stat-days');
  if (heroDays) {
    const planWithDate = plans.find(p => p.eventDate || p.date);
    if (planWithDate) {
      const eventDateObj = new Date(planWithDate.eventDate || planWithDate.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const days = Math.ceil((eventDateObj - today) / (1000 * 60 * 60 * 24));
      heroDays.textContent = days > 0 ? days : '–';
    } else {
      heroDays.textContent = '–';
    }
  }

  // Unread messages — start at 0; update live when UnreadBadgeManager fires.
  // Guard against adding multiple listeners if populateHeroStats is ever called again.
  const heroMessages = document.getElementById('hero-stat-messages');
  if (heroMessages) {
    heroMessages.textContent = '0';
    if (!window.__heroUnreadListenerAdded) {
      window.__heroUnreadListenerAdded = true;
      window.addEventListener('unreadCountUpdated', e => {
        const count = typeof e.detail?.count === 'number' ? e.detail.count : 0;
        heroMessages.textContent = count > 0 ? count : '0';
      });
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
      <div class="customer-welcome-prompt customer-welcome-prompt--budget">
        <span>💰</span>
        <span>Don't forget to <a href="#budget-settings-form" style="color:inherit;font-weight:600;text-decoration:underline;">set your budget</a> so we can track your spending accurately.</span>
      </div>`;
    return;
  }

  // Listen for unread count once it arrives from the messaging system (async)
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
          height: 500,
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
  document.getElementById('openPlanBtn')?.addEventListener('click', async e => {
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
            <p style="margin:0;color:#7F1D1D;font-size:0.9rem;">You haven't saved any suppliers yet. Browse suppliers to get started!</p>
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
          const retryResp = await fetch(`/api/me/plans/${encodeURIComponent(primaryPlan.id)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': getCsrfToken(),
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

// Single initialization call - use readyState check for reliability
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}
