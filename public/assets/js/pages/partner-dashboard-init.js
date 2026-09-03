/**
 * Partner Dashboard v2
 * Independent section loading, current-state sharing, resilient cashouts and accessible dialogs/tabs.
 */
'use strict';
(function () {
  const API_BASE = '/api/v1/partner';
  const state = {
    user: null,
    partner: null,
    profile: null,
    credits: null,
    config: null,
    stats: null,
    referrals: [],
    transactions: [],
    cashouts: [],
    tickets: [],
    codeHistory: [],
    disabled: false,
    referralFilter: 'all',
    referralSort: 'newest',
    cashoutKey: null,
  };

  const retryHandlers = {};
  let toastTimer = null;
  let activeDialog = null;
  let dialogTrigger = null;
  let confirmResolver = null;

  const byId = id => document.getElementById(id);

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  }

  function formatDate(value, options = {}) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: options.withYear === false ? undefined : 'numeric',
    });
  }

  function formatPoints(value) {
    return Number(value || 0).toLocaleString('en-GB');
  }

  function toPounds(points) {
    const rate = Number(state.config?.pointsPerGbp || 100);
    return `£${(Number(points || 0) / rate).toFixed(2)}`;
  }

  function typeLabel(type) {
    return (
      {
        REFERRAL_SIGNUP_BONUS: 'Supplier signup',
        PACKAGE_BONUS: 'First package',
        FIRST_REVIEW_BONUS: 'First customer review',
        SUBSCRIPTION_BONUS: 'First paid subscription',
        ADJUSTMENT: 'Account adjustment',
        CASHOUT_HOLD: 'Redemption hold',
        CASHOUT_RELEASE: 'Hold returned',
        REDEEM: 'Reward delivered',
      }[type] || String(type || 'Activity')
    );
  }

  function methodLabel(method) {
    return method === 'amazon_voucher'
      ? 'Amazon Voucher'
      : method === 'prepaid_debit_card'
        ? 'Pre-Paid Debit Card'
        : method || 'Reward';
  }

  function showToast(message, type = 'success') {
    const toast = byId('partner-toast');
    if (!toast) {
      return;
    }
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `partner-toast-v2 is-visible${type === 'error' ? ' is-error' : ''}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toastTimer = setTimeout(() => {
      toast.className = 'partner-toast-v2';
    }, 3500);
  }

  async function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!response.ok) {
      return '';
    }
    const body = await response.json().catch(() => ({}));
    return body.csrfToken || '';
  }

  async function api(path, options = {}) {
    const request = { credentials: 'include', ...options };
    request.headers = { ...(options.headers || {}) };
    if (options.body && !request.headers['Content-Type']) {
      request.headers['Content-Type'] = 'application/json';
    }
    if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
      request.headers['X-CSRF-Token'] = await getCsrfToken();
    }
    const response = await fetch(`${API_BASE}${path}`, request);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function loadingMarkup(message) {
    return `<span class="partner-spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p>`;
  }

  function setLoading(containerId, message) {
    const container = byId(containerId);
    if (container) {
      container.innerHTML = loadingMarkup(message);
    }
  }

  function renderEmpty(containerId, title, message, actionHtml = '') {
    const container = byId(containerId);
    if (!container) {
      return;
    }
    container.innerHTML = `<div class="partner-empty-v2"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>${actionHtml}</div>`;
  }

  function renderSectionError(containerId, retryKey, message) {
    const container = byId(containerId);
    if (!container) {
      return;
    }
    container.innerHTML = `<div class="partner-section-error"><strong>Unable to load this section</strong><p>${escapeHtml(message || 'Please try again.')}</p><button type="button" class="partner-secondary-btn" data-retry="${escapeHtml(retryKey)}">Retry</button></div>`;
  }

  async function ensureAuth() {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const body = await response.json().catch(() => ({}));
      const user = body.user || (body.id ? body : null);
      if (!response.ok || !user?.id || user.role !== 'partner') {
        window.location.replace('/partner');
        return null;
      }
      state.user = user;
      return user;
    } catch (_) {
      window.location.replace('/partner');
      return null;
    }
  }

  function setGreeting(profile) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    if (byId('partner-greeting-time')) {
      byId('partner-greeting-time').textContent = greeting;
    }
    const firstName = profile?.firstName || String(profile?.name || '').split(' ')[0] || 'Partner';
    if (byId('partner-name-heading')) {
      byId('partner-name-heading').textContent = firstName;
    }
    if (byId('partner-user-name')) {
      byId('partner-user-name').textContent = profile?.name || state.user?.email || '';
    }
  }

  function selectPanel(panelName, focusTab = false) {
    const tabs = [...document.querySelectorAll('#partner-dashboard-tabs [role="tab"]')];
    const panels = [...document.querySelectorAll('[data-dashboard-panel]')];
    for (const tab of tabs) {
      const selected = tab.dataset.panel === panelName;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) {
        tab.focus();
      }
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.dashboardPanel !== panelName;
    }
    history.replaceState(null, '', `#${panelName}`);
  }

  function initTabs() {
    const tabs = [...document.querySelectorAll('#partner-dashboard-tabs [role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectPanel(tab.dataset.panel));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowRight') {
          nextIndex = (index + 1) % tabs.length;
        }
        if (event.key === 'ArrowLeft') {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        }
        if (event.key === 'Home') {
          nextIndex = 0;
        }
        if (event.key === 'End') {
          nextIndex = tabs.length - 1;
        }
        selectPanel(tabs[nextIndex].dataset.panel, true);
      });
    });
    document.querySelectorAll('[data-open-panel]').forEach(button => {
      button.addEventListener('click', () => selectPanel(button.dataset.openPanel, true));
    });
    const hashPanel = location.hash.replace('#', '');
    if (tabs.some(tab => tab.dataset.panel === hashPanel)) {
      selectPanel(hashPanel);
    }
  }

  function focusableElements(dialog) {
    return [
      ...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter(element => !element.hidden && element.offsetParent !== null);
  }

  function handleDialogKeydown(event) {
    if (!activeDialog) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(activeDialog);
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const dialog = activeDialog.querySelector('[role="dialog"], [role="alertdialog"]');
    const focusable = dialog ? focusableElements(dialog) : [];
    if (!focusable.length) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog(overlay, trigger = document.activeElement) {
    if (!overlay) {
      return;
    }
    if (activeDialog && activeDialog !== overlay) {
      closeDialog(activeDialog, false);
    }
    activeDialog = overlay;
    dialogTrigger = trigger;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleDialogKeydown);
    const dialog = overlay.querySelector('[role="dialog"], [role="alertdialog"]');
    const focusable = dialog ? focusableElements(dialog) : [];
    (focusable[0] || dialog)?.focus();
  }

  function closeDialog(overlay, restoreFocus = true) {
    if (!overlay) {
      return;
    }
    overlay.hidden = true;
    if (activeDialog === overlay) {
      activeDialog = null;
    }
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleDialogKeydown);
    if (restoreFocus && dialogTrigger?.focus) {
      dialogTrigger.focus();
    }
    dialogTrigger = null;
  }

  function initDialogs() {
    document.querySelectorAll('.partner-dialog-overlay').forEach(overlay => {
      overlay.addEventListener('click', event => {
        if (event.target === overlay) {
          closeDialog(overlay);
        }
      });
      overlay.querySelectorAll('[data-close-dialog]').forEach(button => {
        button.addEventListener('click', () => closeDialog(overlay));
      });
    });
  }

  function confirmAction(message) {
    const overlay = byId('partner-confirm-overlay');
    byId('partner-confirm-message').textContent = message;
    openDialog(overlay);
    return new Promise(resolve => {
      confirmResolver = resolve;
    });
  }

  function finishConfirm(result) {
    if (confirmResolver) {
      confirmResolver(result);
    }
    confirmResolver = null;
    closeDialog(byId('partner-confirm-overlay'));
  }

  function renderDisabled(error) {
    state.disabled = true;
    const panel = byId('partner-disabled-panel');
    panel.hidden = false;
    byId('partner-disabled-msg').textContent =
      error?.body?.error || error?.message || 'Your partner account is currently disabled.';
    byId('partner-status-line').textContent = 'Account support remains available.';
    byId('partner-status-line').style.color = 'var(--partner-danger)';
    byId('partner-balance-grid').hidden = true;
    document.querySelectorAll('#partner-dashboard-tabs [role="tab"]').forEach(tab => {
      tab.hidden = tab.dataset.panel !== 'support';
    });
    document.querySelectorAll('[data-dashboard-panel]').forEach(panelElement => {
      panelElement.hidden = panelElement.dataset.dashboardPanel !== 'support';
    });
    selectPanel('support');
    const supportTitle = byId('support-modal-title');
    if (supportTitle) {
      supportTitle.textContent = 'Contact account support';
    }
  }

  function renderCore() {
    const credits = state.credits || {};
    setGreeting(state.profile);
    byId('partner-status-line').textContent = nextActionMessage();
    byId('partner-status-line').style.color = '';
    byId('partner-balance-grid').removeAttribute('data-loading');
    byId('partner-balance-grid').hidden = false;

    byId('stat-balance').textContent = formatPoints(credits.availableBalance);
    byId('stat-balance-gbp').textContent = toPounds(credits.availableBalance);
    byId('stat-pending').textContent = formatPoints(credits.maturingBalance);
    byId('stat-pending-gbp').textContent = toPounds(credits.maturingBalance);
    byId('stat-potential').textContent = formatPoints(credits.pendingPoints);
    byId('stat-potential-gbp').textContent = toPounds(credits.pendingPoints);
    byId('stat-earned').textContent = formatPoints(credits.totalEarned);
    byId('stat-earned-gbp').textContent = toPounds(credits.totalEarned);

    byId('partner-ref-link').textContent = state.partner.refLink;
    byId('partner-ref-code-badge').textContent = state.partner.refCode;
    byId('partner-code-display').textContent = state.partner.refCode;
    byId('cashout-rule-summary').textContent =
      `${state.config.pointsPerGbp} points = £1. Minimum redemption £${state.config.minimumCashoutGbp}.`;

    const firstName = byId('settings-firstname');
    const lastName = byId('settings-lastname');
    const company = byId('settings-company');
    if (firstName && document.activeElement !== firstName) {
      firstName.value = state.profile.firstName || '';
    }
    if (lastName && document.activeElement !== lastName) {
      lastName.value = state.profile.lastName || '';
    }
    if (company && document.activeElement !== company) {
      company.value = state.profile.company || '';
    }
    renderCashoutForm();
  }

  function nextActionMessage() {
    if (!state.config || !state.credits) {
      return 'Your partner account is active.';
    }
    const minimumPoints = state.config.minimumCashoutGbp * state.config.pointsPerGbp;
    if (state.credits.availableBalance >= minimumPoints) {
      return 'Your rewards are ready to redeem.';
    }
    if (state.stats?.referralActivity?.active) {
      return `${state.stats.referralActivity.active} active referral${state.stats.referralActivity.active === 1 ? '' : 's'} can still complete milestones.`;
    }
    const remaining = Math.max(0, minimumPoints - Number(state.credits.availableBalance || 0));
    return `${formatPoints(remaining)} more points will unlock your next reward.`;
  }

  async function loadCore() {
    try {
      const body = await api('/me');
      state.disabled = false;
      state.partner = body.partner;
      state.profile = body.userProfile || {};
      state.credits = body.credits || {};
      state.config = body.config || {
        pointsPerGbp: body.pointsPerGbp || 100,
        maturityDays: 30,
        attributionDays: 30,
        minimumCashoutGbp: 15,
        cashoutDenominations: [],
        cashoutMethods: ['amazon_voucher', 'prepaid_debit_card'],
      };
      renderCore();
      return body;
    } catch (error) {
      if (error.status === 403 && error.body?.disabled) {
        renderDisabled(error);
        return null;
      }
      byId('partner-status-line').textContent =
        'Unable to load your account. Refresh the page to try again.';
      byId('partner-status-line').style.color = 'var(--partner-danger)';
      byId('partner-balance-grid').removeAttribute('data-loading');
      throw error;
    }
  }

  function renderStats() {
    const stats = state.stats || {};
    const progress = stats.cashoutProgress || {};
    const activity = stats.referralActivity || {};
    const percentage = Math.max(0, Math.min(100, Number(progress.percentToNextCashout || 0)));
    byId('milestone-fill').style.width = `${percentage}%`;
    byId('milestone-track').setAttribute('aria-valuenow', String(percentage));
    byId('milestone-percent').textContent = `${percentage}%`;
    byId('milestone-value-label').textContent =
      `${formatPoints(progress.availablePoints)} / ${formatPoints(progress.minCashoutPoints)} points`;
    byId('milestone-hint').textContent =
      Number(progress.pointsToNextCashout || 0) > 0
        ? `${formatPoints(progress.pointsToNextCashout)} points (${toPounds(progress.pointsToNextCashout)}) to your next redemption.`
        : 'You have enough available points to redeem a reward.';

    byId('performance-total').textContent = formatPoints(activity.total);
    byId('performance-active').textContent = formatPoints(activity.active);
    byId('performance-completed').textContent = formatPoints(activity.completed);
    byId('performance-paid').textContent = formatPoints(activity.paidConversions);

    const breakdown = stats.breakdown || {};
    const rows = [
      ['Supplier signups', breakdown.signup || 0],
      ['First packages', breakdown.package || 0],
      ['First customer reviews', breakdown.review || 0],
      ['First paid subscriptions', breakdown.subscription || 0],
      ['Account adjustments', breakdown.adjustment || 0],
    ];
    byId('breakdown-container').innerHTML = `<div class="partner-breakdown-v2">${rows
      .map(
        ([label, points]) =>
          `<div class="partner-breakdown-row"><span>${escapeHtml(label)}</span><strong>${formatPoints(points)} points<small>${toPounds(points)}</small></strong></div>`
      )
      .join('')}</div>`;
    byId('partner-status-line').textContent = nextActionMessage();
  }

  async function loadStats() {
    setLoading('breakdown-container', 'Loading breakdown…');
    try {
      const body = await api('/stats');
      state.stats = body;
      if (body.config) {
        state.config = body.config;
      }
      renderStats();
    } catch (error) {
      renderSectionError('breakdown-container', 'stats', error.message);
      byId('milestone-value-label').textContent = 'Unavailable';
      byId('milestone-hint').textContent = 'Reward progress could not be loaded.';
    }
  }

  function referralStage(label, complete, completeText, pendingText, expired = false) {
    const className = complete
      ? 'partner-stage-v2 partner-stage-v2--done'
      : expired
        ? 'partner-stage-v2 partner-stage-v2--expired'
        : 'partner-stage-v2';
    return `<div class="${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(complete ? completeText : pendingText)}</strong></div>`;
  }

  function referralCard(referral, compact = false) {
    const packageExpired = !referral.withinWindow && !referral.packageQualified;
    const subscriptionExpired = !referral.withinWindow && !referral.subscriptionQualified;
    const timing = referral.withinWindow
      ? `${referral.daysRemaining} day${referral.daysRemaining === 1 ? '' : 's'} left for time-limited milestones`
      : 'Package and subscription window closed';
    const stages = compact
      ? ''
      : `<div class="partner-stage-grid">
          ${referralStage('Signup', true, 'Completed · +5', '')}
          ${referralStage('First package', referral.packageQualified, 'Completed · +10', packageExpired ? 'Window expired' : 'Still available · +10', packageExpired)}
          ${referralStage('First review', referral.reviewQualified, 'Completed · +15', 'Still available · +15')}
          ${referralStage('Paid subscription', referral.subscriptionQualified, 'Completed · +100', subscriptionExpired ? 'Window expired' : 'Still available · +100', subscriptionExpired)}
        </div>`;
    return `<article class="partner-referral-card-v2">
      <div class="partner-referral-card-v2__top">
        <div><div class="partner-referral-card-v2__name">${escapeHtml(referral.supplierName)}</div><div class="partner-referral-card-v2__meta">Joined ${formatDate(referral.signedUpAt)} · ${escapeHtml(timing)}</div></div>
        <div class="partner-referral-card-v2__value"><strong>${formatPoints(referral.pointsEarned)} earned</strong>${formatPoints(referral.potentialPoints)} potential</div>
      </div>
      ${stages}
      <span class="partner-state-pill partner-state-pill--${escapeHtml(referral.state)}">${escapeHtml(referral.state.charAt(0).toUpperCase() + referral.state.slice(1))}</span>
    </article>`;
  }

  function sortedFilteredReferrals() {
    let items = [...state.referrals];
    if (state.referralFilter !== 'all') {
      items = items.filter(item => item.state === state.referralFilter);
    }
    if (state.referralSort === 'expiring') {
      items.sort(
        (a, b) =>
          (a.withinWindow ? a.daysRemaining : Number.MAX_SAFE_INTEGER) -
          (b.withinWindow ? b.daysRemaining : Number.MAX_SAFE_INTEGER)
      );
    } else if (state.referralSort === 'potential') {
      items.sort((a, b) => b.potentialPoints - a.potentialPoints);
    } else {
      items.sort((a, b) => new Date(b.signedUpAt) - new Date(a.signedUpAt));
    }
    return items;
  }

  function renderReferrals() {
    const items = sortedFilteredReferrals();
    if (!items.length) {
      renderEmpty(
        'referrals-container',
        state.referrals.length ? 'No matching referrals' : 'No referred suppliers yet',
        state.referrals.length
          ? 'Choose another filter to see your referrals.'
          : 'Share your referral link with genuine event suppliers to begin.'
      );
    } else {
      byId('referrals-container').innerHTML =
        `<div class="partner-referral-list">${items.map(item => referralCard(item)).join('')}</div>`;
    }

    const recent = state.referrals.slice(0, 3);
    if (!recent.length) {
      renderEmpty(
        'overview-referrals-container',
        'No referrals yet',
        'Your latest referred suppliers will appear here.'
      );
    } else {
      byId('overview-referrals-container').innerHTML =
        `<div class="partner-referral-list">${recent.map(item => referralCard(item, true)).join('')}</div>`;
    }
  }

  async function loadReferrals() {
    setLoading('referrals-container', 'Loading referrals…');
    setLoading('overview-referrals-container', 'Loading recent referrals…');
    try {
      const body = await api('/referrals');
      state.referrals = body.items || [];
      renderReferrals();
    } catch (error) {
      renderSectionError('referrals-container', 'referrals', error.message);
      renderSectionError('overview-referrals-container', 'referrals', error.message);
    }
  }

  function renderTransactions() {
    if (!state.transactions.length) {
      renderEmpty(
        'transactions-container',
        'No points activity yet',
        'Reward activity and redemptions will appear here.'
      );
      byId('transaction-count-label').textContent = 'No points activity yet.';
      return;
    }
    const visible = state.transactions.slice(0, 50);
    byId('transaction-count-label').textContent =
      state.transactions.length > visible.length
        ? `Showing the latest ${visible.length} of ${state.transactions.length} entries.`
        : `${state.transactions.length} ${state.transactions.length === 1 ? 'entry' : 'entries'} in your history.`;
    const rows = visible
      .map(transaction => {
        const amountClass = transaction.amount >= 0 ? 'partner-positive' : 'partner-negative';
        const amount = `${transaction.amount >= 0 ? '+' : ''}${formatPoints(transaction.amount)}`;
        const availability = transaction.availability || 'available';
        const maturity =
          availability === 'maturing' && transaction.maturesAt
            ? `Available ${formatDate(transaction.maturesAt)}`
            : availability.charAt(0).toUpperCase() + availability.slice(1);
        return `<tr>
          <td data-label="Activity"><strong>${escapeHtml(typeLabel(transaction.type))}</strong>${transaction.supplierName ? `<br><small>${escapeHtml(transaction.supplierName)}</small>` : ''}</td>
          <td data-label="Points" class="${amountClass}">${escapeHtml(amount)}</td>
          <td data-label="Value">${toPounds(Math.abs(transaction.amount))}</td>
          <td data-label="Status">${escapeHtml(maturity)}</td>
          <td data-label="Date">${formatDate(transaction.createdAt)}</td>
          <td data-label="Reference">${escapeHtml(transaction.externalRef || transaction.notes || '—')}</td>
        </tr>`;
      })
      .join('');
    byId('transactions-container').innerHTML =
      `<div class="partner-table-v2-wrap"><table class="partner-table-v2"><thead><tr><th>Activity</th><th>Points</th><th>Value</th><th>Status</th><th>Date</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  async function loadTransactions() {
    setLoading('transactions-container', 'Loading points activity…');
    try {
      const body = await api('/transactions');
      state.transactions = body.items || [];
      renderTransactions();
    } catch (error) {
      renderSectionError('transactions-container', 'transactions', error.message);
    }
  }

  function renderCashoutForm() {
    const container = byId('cashout-container');
    if (!container || !state.credits || !state.config) {
      return;
    }
    const availablePoints = Number(state.credits.availableBalance || 0);
    const availableGbp = availablePoints / Number(state.config.pointsPerGbp || 100);
    const denominations = (state.config.cashoutDenominations || []).filter(
      value => value <= availableGbp
    );
    if (!denominations.length) {
      container.innerHTML = `<div class="partner-empty-v2"><strong>Redemption not yet available</strong><p>You have ${toPounds(availablePoints)} available. The minimum redemption is £${escapeHtml(state.config.minimumCashoutGbp)}.</p></div>`;
      return;
    }
    container.innerHTML = `<form id="cashout-form" class="partner-form-v2 partner-cashout-form" novalidate>
      <label>Reward method<select name="method" required><option value="">Select a method</option>${(state.config.cashoutMethods || []).map(method => `<option value="${escapeHtml(method)}">${escapeHtml(methodLabel(method))}</option>`).join('')}</select></label>
      <label>Amount<select name="denominationGbp" required><option value="">Select an amount</option>${denominations.map(value => `<option value="${value}">£${value}</option>`).join('')}</select></label>
      <label>Message <small>Optional</small><textarea name="partnerMessage" maxlength="1000" rows="3" placeholder="Any information our team should know"></textarea></label>
      <p class="partner-card-note">Available now: ${formatPoints(availablePoints)} points (${toPounds(availablePoints)}).</p>
      <div class="partner-form-actions"><button type="submit" class="partner-primary-btn">Submit redemption request</button><span id="cashout-status" role="alert" aria-live="polite"></span></div>
    </form>`;
    const form = byId('cashout-form');
    form.addEventListener('change', () => {
      state.cashoutKey = null;
    });
    form.addEventListener('submit', submitCashout);
  }

  function newCashoutKey() {
    if (window.crypto?.randomUUID) {
      return `cashout_${window.crypto.randomUUID()}`;
    }
    return `cashout_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }

  async function submitCashout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const status = byId('cashout-status');
    const method = form.elements.method.value;
    const denominationGbp = Number(form.elements.denominationGbp.value);
    const partnerMessage = form.elements.partnerMessage.value.trim();
    if (!method || !Number.isInteger(denominationGbp)) {
      status.textContent = 'Select a reward method and amount.';
      status.style.color = 'var(--partner-danger)';
      return;
    }
    const confirmed = await confirmAction(
      `Submit a £${denominationGbp} ${methodLabel(method)} redemption request? The matching points will be held immediately.`
    );
    if (!confirmed) {
      return;
    }
    if (!state.cashoutKey) {
      state.cashoutKey = newCashoutKey();
    }
    submit.disabled = true;
    status.textContent = 'Submitting securely…';
    status.style.color = '';
    try {
      const body = await api('/cashout-requests', {
        method: 'POST',
        headers: { 'Idempotency-Key': state.cashoutKey },
        body: JSON.stringify({
          method,
          denominationGbp,
          partnerMessage,
          idempotencyKey: state.cashoutKey,
        }),
      });
      state.cashoutKey = null;
      showToast(
        body.idempotentReplay
          ? 'This request was already submitted.'
          : 'Redemption request submitted.'
      );
      await Promise.allSettled([loadCore(), loadStats(), loadTransactions(), loadCashouts()]);
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--partner-danger)';
      if (error.status && error.status < 500) {
        state.cashoutKey = null;
      }
      if (error.body?.reconciliationRequired) {
        selectPanel('support', true);
      }
    } finally {
      submit.disabled = false;
    }
  }

  function cashoutStatusPill(status) {
    const label = String(status || 'submitted').replace(/_/g, ' ');
    return `<span class="partner-status-pill partner-status-pill--${escapeHtml(status || 'submitted')}">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</span>`;
  }

  function renderCashouts() {
    if (!state.cashouts.length) {
      renderEmpty(
        'cashout-history-container',
        'No redemptions yet',
        'Submitted reward requests will appear here.'
      );
      return;
    }
    byId('cashout-history-container').innerHTML =
      `<div class="partner-history-list">${state.cashouts
        .map(
          request =>
            `<article class="partner-history-row"><div><strong>£${escapeHtml(request.denominationGbp)} ${escapeHtml(methodLabel(request.method))}</strong><p>Submitted ${formatDate(request.createdAt)} · ${formatPoints(request.pointsHeld)} points held${request.adminResponseMessage ? ` · ${escapeHtml(request.adminResponseMessage)}` : ''}</p></div>${cashoutStatusPill(request.status)}</article>`
        )
        .join('')}</div>`;
  }

  async function loadCashouts() {
    setLoading('cashout-history-container', 'Loading redemption history…');
    try {
      const body = await api('/cashout-requests');
      state.cashouts = body.items || [];
      renderCashouts();
    } catch (error) {
      renderSectionError('cashout-history-container', 'cashouts', error.message);
    }
  }

  function renderCodeHistory() {
    if (!state.codeHistory.length) {
      renderEmpty(
        'code-history-container',
        'No previous codes',
        'Your current partner code has never been regenerated.'
      );
      return;
    }
    byId('code-history-container').innerHTML =
      `<div class="partner-history-list">${state.codeHistory
        .map(
          item =>
            `<div class="partner-history-row"><div><strong><code>${escapeHtml(item.refCode)}</code></strong><p>Replaced ${formatDate(item.archivedAt)} · Existing links remain valid</p></div><span class="partner-status-pill">Historical</span></div>`
        )
        .join('')}</div>`;
  }

  async function loadCodeHistory() {
    setLoading('code-history-container', 'Loading code history…');
    try {
      const body = await api('/code-history');
      state.codeHistory = body.items || [];
      renderCodeHistory();
    } catch (error) {
      renderSectionError('code-history-container', 'codeHistory', error.message);
    }
  }

  async function regenerateCode() {
    const confirmed = await confirmAction(
      'Generate a new partner code? Previous links will remain valid, but all dashboard sharing actions will switch to the new code.'
    );
    if (!confirmed) {
      return;
    }
    const button = byId('partner-regen-btn');
    button.disabled = true;
    button.textContent = 'Generating…';
    try {
      const body = await api('/regenerate-code', { method: 'POST', body: '{}' });
      state.partner.refCode = body.newCode;
      state.partner.refLink = body.refLink;
      byId('partner-ref-code-badge').textContent = body.newCode;
      byId('partner-code-display').textContent = body.newCode;
      byId('partner-ref-link').textContent = body.refLink;
      await loadCodeHistory();
      showToast('New partner code created. Previous links still work.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Generate a new code';
    }
  }

  function renderTickets() {
    if (!state.tickets.length) {
      renderEmpty(
        'partner-tickets-container',
        'No support tickets yet',
        'Use the button above whenever you need help.',
        '<button type="button" class="partner-primary-btn" data-open-support>Raise a support ticket</button>'
      );
      byId('partner-tickets-container')
        .querySelector('[data-open-support]')
        ?.addEventListener('click', openSupportModal);
      return;
    }
    byId('partner-tickets-container').innerHTML = `<div class="partner-ticket-list">${state.tickets
      .map(
        ticket =>
          `<button type="button" class="partner-ticket-row-v2" data-ticket-id="${escapeHtml(ticket.id)}"><div><strong>${escapeHtml(ticket.subject)}</strong><p>Opened ${formatDate(ticket.createdAt)} · ${ticket.responseCount || 0} ${ticket.responseCount === 1 ? 'reply' : 'replies'}</p></div>${cashoutStatusPill(ticket.status)}</button>`
      )
      .join('')}</div>`;
    byId('partner-tickets-container')
      .querySelectorAll('[data-ticket-id]')
      .forEach(button => {
        button.addEventListener('click', () => openTicket(button.dataset.ticketId, button));
      });
  }

  async function loadTickets() {
    setLoading('partner-tickets-container', 'Loading support tickets…');
    try {
      const body = await api('/support-tickets');
      state.tickets = body.items || [];
      renderTickets();
    } catch (error) {
      renderSectionError('partner-tickets-container', 'tickets', error.message);
    }
  }

  function openSupportModal(event) {
    const form = byId('support-ticket-form');
    form.reset();
    byId('support-modal-status').textContent = '';
    byId('support-modal-title').textContent = state.disabled
      ? 'Contact account support'
      : 'Raise a support ticket';
    openDialog(byId('support-modal-overlay'), event?.currentTarget || document.activeElement);
  }

  async function submitSupportTicket(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const subject = byId('support-subject').value.trim();
    const message = byId('support-message').value.trim();
    const status = byId('support-modal-status');
    const button = byId('support-modal-submit');
    if (!subject || !message) {
      status.textContent = 'Enter a subject and message.';
      status.style.color = 'var(--partner-danger)';
      return;
    }
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await api('/support-ticket', {
        method: 'POST',
        body: JSON.stringify({ subject, message }),
      });
      closeDialog(byId('support-modal-overlay'));
      showToast('Support ticket submitted.');
      await loadTickets();
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--partner-danger)';
    } finally {
      button.disabled = false;
      button.textContent = 'Send ticket';
    }
  }

  async function openTicket(ticketId, trigger) {
    const overlay = byId('partner-ticket-detail-overlay');
    const body = byId('partner-ticket-detail-body');
    body.innerHTML = loadingMarkup('Loading ticket…');
    openDialog(overlay, trigger);
    try {
      const response = await api(`/support-tickets/${encodeURIComponent(ticketId)}`);
      const ticket = response.ticket;
      byId('partner-ticket-detail-title').textContent = ticket.subject || 'Support ticket';
      const replies = ticket.responses || [];
      body.innerHTML = `<div class="partner-ticket-message"><small>Opened ${formatDate(ticket.createdAt)}</small>${escapeHtml(ticket.message || '')}</div>
        ${replies.length ? `<div class="partner-ticket-thread">${replies.map(reply => `<div class="partner-ticket-reply ${reply.isStaff || reply.authorRole === 'admin' ? 'partner-ticket-reply--staff' : ''}"><small>${reply.isStaff || reply.authorRole === 'admin' ? 'EventFlow Support' : 'You'} · ${formatDate(reply.createdAt)}</small>${escapeHtml(reply.message || reply.content || '')}</div>`).join('')}</div>` : ''}
        ${ticket.status === 'closed' ? '<p class="partner-card-note">This ticket is closed.</p>' : `<form class="partner-form-v2" id="ticket-reply-form"><label>Add a reply<textarea name="message" maxlength="5000" rows="4" required></textarea></label><div class="partner-form-actions"><button type="submit" class="partner-primary-btn">Send reply</button><span id="ticket-reply-status" role="alert" aria-live="polite"></span></div></form>`}`;
      byId('ticket-reply-form')?.addEventListener('submit', event =>
        submitTicketReply(event, ticketId)
      );
    } catch (error) {
      renderSectionError('partner-ticket-detail-body', 'ticketDetail', error.message);
      retryHandlers.ticketDetail = () => openTicket(ticketId, trigger);
    }
  }

  async function submitTicketReply(event, ticketId) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.elements.message.value.trim();
    const status = byId('ticket-reply-status');
    const button = form.querySelector('button[type="submit"]');
    if (!message) {
      status.textContent = 'Enter a reply.';
      status.style.color = 'var(--partner-danger)';
      return;
    }
    button.disabled = true;
    try {
      await api(`/support-tickets/${encodeURIComponent(ticketId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      showToast('Reply sent.');
      await Promise.allSettled([loadTickets(), openTicket(ticketId, dialogTrigger)]);
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--partner-danger)';
    } finally {
      button.disabled = false;
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const button = byId('profile-save-btn');
    const status = byId('profile-status');
    const payload = {
      firstName: byId('settings-firstname').value.trim(),
      lastName: byId('settings-lastname').value.trim(),
      company: byId('settings-company').value.trim() || null,
    };
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      await api('/me', { method: 'PATCH', body: JSON.stringify(payload) });
      state.profile = {
        ...state.profile,
        ...payload,
        name: `${payload.firstName} ${payload.lastName}`.trim(),
      };
      setGreeting(state.profile);
      status.textContent = 'Profile saved.';
      status.style.color = 'var(--partner-accent)';
      showToast('Profile updated.');
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--partner-danger)';
    } finally {
      button.disabled = false;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = byId('password-save-btn');
    const status = byId('password-status');
    const currentPassword = byId('settings-current-pw').value;
    const newPassword = byId('settings-new-pw').value;
    if (!currentPassword || !newPassword) {
      status.textContent = 'Enter both passwords.';
      status.style.color = 'var(--partner-danger)';
      return;
    }
    button.disabled = true;
    status.textContent = 'Updating…';
    try {
      await api('/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      form.reset();
      status.textContent = 'Password changed.';
      status.style.color = 'var(--partner-accent)';
      showToast('Password changed.');
    } catch (error) {
      status.textContent = error.message;
      status.style.color = 'var(--partner-danger)';
    } finally {
      button.disabled = false;
    }
  }

  async function copyText(value, message) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast(message);
  }

  function shareWhatsApp() {
    if (!state.partner?.refLink) {
      return;
    }
    const text = encodeURIComponent(
      `I thought your event business might be a good fit for EventFlow. You can create a supplier profile here: ${state.partner.refLink}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  function shareEmail() {
    if (!state.partner?.refLink) {
      return;
    }
    const subject = encodeURIComponent('Invitation to join EventFlow as an event supplier');
    const body = encodeURIComponent(
      `Hi,\n\nI thought EventFlow might be useful for your event business. You can create a supplier profile here:\n${state.partner.refLink}\n\nBest wishes`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  async function logout() {
    try {
      const csrf = await getCsrfToken();
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf },
      });
    } catch (_) {
      // Navigation still clears the session client-side.
    }
    try {
      window.AuthStateManager?.logout();
      localStorage.removeItem('user');
      sessionStorage.clear();
    } catch (_) {
      // Storage can be unavailable in privacy modes; the server session remains authoritative.
    }
    window.location.replace('/partner');
  }

  function initStaticActions() {
    byId('partner-logout-btn')?.addEventListener('click', logout);
    byId('partner-copy-btn')?.addEventListener('click', () =>
      copyText(state.partner?.refLink, 'Referral link copied.')
    );
    byId('partner-ref-code-badge')?.addEventListener('click', () =>
      copyText(state.partner?.refCode, 'Partner code copied.')
    );
    byId('partner-ref-code-badge')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        copyText(state.partner?.refCode, 'Partner code copied.');
      }
    });
    byId('partner-share-whatsapp')?.addEventListener('click', shareWhatsApp);
    byId('partner-share-email')?.addEventListener('click', shareEmail);
    byId('share-panel-copy')?.addEventListener('click', () =>
      copyText(state.partner?.refLink, 'Referral link copied.')
    );
    byId('share-panel-whatsapp')?.addEventListener('click', shareWhatsApp);
    byId('partner-regen-btn')?.addEventListener('click', regenerateCode);
    byId('partner-support-btn')?.addEventListener('click', openSupportModal);
    byId('partner-disabled-support-btn')?.addEventListener('click', openSupportModal);
    byId('support-ticket-form')?.addEventListener('submit', submitSupportTicket);
    byId('partner-profile-form')?.addEventListener('submit', saveProfile);
    byId('partner-password-form')?.addEventListener('submit', changePassword);
    byId('partner-confirm-cancel')?.addEventListener('click', () => finishConfirm(false));
    byId('partner-confirm-ok')?.addEventListener('click', () => finishConfirm(true));
    byId('referral-filter')?.addEventListener('change', event => {
      state.referralFilter = event.target.value;
      renderReferrals();
    });
    byId('referral-sort')?.addEventListener('change', event => {
      state.referralSort = event.target.value;
      renderReferrals();
    });
    document.querySelectorAll('[data-password-target]').forEach(button => {
      button.addEventListener('click', () => {
        const input = byId(button.dataset.passwordTarget);
        if (!input) {
          return;
        }
        input.type = input.type === 'password' ? 'text' : 'password';
        button.textContent = input.type === 'password' ? 'Show' : 'Hide';
        button.setAttribute(
          'aria-label',
          `${input.type === 'password' ? 'Show' : 'Hide'} password`
        );
      });
    });
    document.addEventListener('click', event => {
      const retry = event.target.closest('[data-retry]');
      if (retry && retryHandlers[retry.dataset.retry]) {
        retryHandlers[retry.dataset.retry]();
      }
    });
  }

  function registerRetryHandlers() {
    retryHandlers.stats = loadStats;
    retryHandlers.referrals = loadReferrals;
    retryHandlers.transactions = loadTransactions;
    retryHandlers.cashouts = loadCashouts;
    retryHandlers.codeHistory = loadCodeHistory;
    retryHandlers.tickets = loadTickets;
  }

  async function init() {
    initTabs();
    initDialogs();
    initStaticActions();
    registerRetryHandlers();

    const user = await ensureAuth();
    if (!user) {
      return;
    }
    byId('partner-user-name').textContent = user.name || user.email || '';

    try {
      const core = await loadCore();
      if (!core && state.disabled) {
        await loadTickets();
        return;
      }
    } catch (_) {
      return;
    }

    await Promise.allSettled([
      loadStats(),
      loadReferrals(),
      loadTransactions(),
      loadCashouts(),
      loadCodeHistory(),
      loadTickets(),
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
