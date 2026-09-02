/**
 * Admin Analytics Page Initialization
 * Fetches and renders revenue, user growth, platform statistics and the
 * decision-focused analytics extension.
 */

'use strict';
(function () {
  const AUTO_REFRESH_INTERVAL_MS = 15 * 1000;
  const DECISION_STYLE = '/assets/css/admin-analytics-decision.css?v=1';
  const DECISION_SCRIPT = '/assets/js/pages/admin-analytics-decision.js?v=1';
  let autoRefreshTimer = null;
  let refreshInFlight = false;
  let refreshButton = null;

  function formatGBP(amount) {
    return `£${Number(amount || 0).toFixed(2)}`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function capitalise(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function loadDecisionAssets() {
    if (!document.querySelector('link[href^="/assets/css/admin-analytics-decision.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = DECISION_STYLE;
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[src^="/assets/js/pages/admin-analytics-decision.js"]')) {
      const script = document.createElement('script');
      script.src = DECISION_SCRIPT;
      script.defer = true;
      document.head.appendChild(script);
    }
  }

  function updateRevenueLabel() {
    const value = document.getElementById('an-totalRevenue');
    const card = value && value.closest('.stat-card');
    const label = card && card.querySelector('.stat-label');
    if (label) {
      label.textContent = 'Stripe Revenue (Latest Charges)';
    }
  }

  async function loadRevenue() {
    let stripeData = null;
    try {
      stripeData = await AdminShared.api('/api/admin/stripe-analytics');
    } catch (_error) {
      stripeData = { available: false };
    }

    const notice = document.getElementById('stripeNotice');
    const badge = document.getElementById('stripeStatusBadge');
    const message = document.getElementById('stripeStatusMsg');
    if (notice) {
      notice.style.display = '';
    }
    updateRevenueLabel();

    if (stripeData && stripeData.available === true) {
      if (badge) {
        badge.textContent = 'Connected';
        badge.style.background = '#dcfce7';
        badge.style.color = '#16a34a';
      }
      if (message) {
        message.textContent =
          'Live Stripe data is displayed below. The revenue total covers the latest returned charges, not guaranteed lifetime revenue.';
      }
      setText('an-totalRevenue', formatGBP(stripeData.totalRevenue));
      setText('an-monthRevenue', formatGBP(stripeData.monthRevenue));
      setText('an-activeSubs', String(stripeData.activeSubscriptions || 0));
      setText('an-availableBalance', formatGBP(stripeData.availableBalance));
      setText('an-totalRevenueNote', 'From Stripe · latest 100 charges');
    } else {
      if (badge) {
        badge.textContent = 'Not configured';
        badge.style.background = '#fef9c3';
        badge.style.color = '#92400e';
      }
      if (message) {
        message.textContent = 'Stripe is not configured. Showing subscription MRR data only.';
      }
      setText('an-totalRevenue', 'N/A');
      setText('an-monthRevenue', 'N/A');
      setText('an-availableBalance', 'N/A');
      setText('an-totalRevenueNote', 'Stripe connection required');
    }

    try {
      const data = await AdminShared.api('/api/v2/admin/revenue');
      if (data && data.revenue) {
        setText('an-mrr', formatGBP(data.revenue.mrr));
        if (!stripeData || !stripeData.available) {
          setText('an-activeSubs', String(data.revenue.activeSubscriptions || 0));
        }
      }
      if (data && data.churn) {
        setText('an-churnRate', `${Number(data.churn.churnRate || 0).toFixed(1)}%`);
      }
    } catch (_error) {
      setText('an-mrr', 'N/A');
      setText('an-churnRate', 'N/A');
    }
  }

  async function loadMetrics() {
    try {
      const data = await AdminShared.api('/api/admin/metrics');
      const counts = (data && data.counts) || {};
      setText('an-usersTotal', String(counts.usersTotal || 0));
      setText('an-suppliersTotal', String(counts.suppliersTotal || 0));
      setText('an-suppliersProTotal', String(counts.proSuppliers || 0));
      setText('an-packagesTotal', String(counts.packagesTotal || 0));
      setText('an-packagesFeatured', String(counts.featuredPackages || 0));
      setText('an-plansTotal', String(counts.plansTotal || 0));
      setText('an-messagesTotal', String(counts.messagesTotal || 0));

      const pendingSuppliers = counts.pendingSuppliers || 0;
      const pendingPackages = counts.pendingPackages || 0;
      const supplierPending = document.getElementById('an-suppliersPending');
      const packagePending = document.getElementById('an-packagesPending');
      if (supplierPending) {
        supplierPending.textContent =
          pendingSuppliers > 0 ? `${pendingSuppliers} pending approval` : 'No pending approvals';
        supplierPending.style.color =
          pendingSuppliers > 0 ? 'var(--color-warning,#d97706)' : 'var(--color-success,#16a34a)';
      }
      if (packagePending) {
        packagePending.textContent =
          pendingPackages > 0 ? `${pendingPackages} pending approval` : 'No pending approvals';
        packagePending.style.color =
          pendingPackages > 0 ? 'var(--color-warning,#d97706)' : 'var(--color-success,#16a34a)';
      }

      const roleBreakdown = document.getElementById('an-roleBreakdown');
      if (roleBreakdown) {
        const byRole = counts.usersByRole || {};
        const roles = Object.keys(byRole);
        roleBreakdown.innerHTML = roles.length
          ? roles
              .map(
                role =>
                  `<span style="background:var(--color-surface-2,#f3f4f6);padding:5px 14px;border-radius:999px;font-size:.875rem;border:1px solid #e5e7eb"><strong>${capitalise(role)}</strong>: ${byRole[role]}</span>`
              )
              .join('')
          : '<span style="color:#9ca3af;font-size:.875rem">No role data</span>';
      }
    } catch (_error) {
      AdminShared.showToast('Failed to load platform metrics', 'error');
    }
  }

  async function loadUserGrowth() {
    try {
      const usersData = await AdminShared.api('/api/admin/users');
      const users = (usersData && usersData.items) || [];
      const now = Date.now();
      const week = 7 * 24 * 60 * 60 * 1000;
      const month = 30 * 24 * 60 * 60 * 1000;
      const countSince = duration =>
        users.filter(user => {
          const createdAt = user.createdAt ? Date.parse(user.createdAt) : NaN;
          return Number.isFinite(createdAt) && createdAt >= now - duration;
        }).length;
      setText('an-signups7d', String(countSince(week)));
      setText('an-signups30d', String(countSince(month)));
    } catch (_error) {
      setText('an-signups7d', 'N/A');
      setText('an-signups30d', 'N/A');
    }

    try {
      const timeseriesData = await AdminShared.api('/api/admin/metrics/timeseries');
      const series = (timeseriesData && timeseriesData.series) || [];
      const body = document.getElementById('an-timeseriesBody');
      if (!body) {
        return;
      }
      body.innerHTML = series.length
        ? series
            .map(
              (row, index) => `<tr style="${index % 2 ? 'background:#f9fafb' : ''}">
                <td style="padding:.5rem 1rem;font-size:.875rem;color:#374151">${row.date}</td>
                <td style="padding:.5rem 1rem;text-align:center;font-size:.875rem">${row.signups || 0}</td>
                <td style="padding:.5rem 1rem;text-align:center;font-size:.875rem">${row.plans || 0}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="3" style="padding:1.5rem;text-align:center;color:#9ca3af">No data available</td></tr>';
    } catch (_error) {
      const body = document.getElementById('an-timeseriesBody');
      if (body) {
        body.innerHTML =
          '<tr><td colspan="3" style="padding:1.5rem;text-align:center;color:#9ca3af">Failed to load timeseries data</td></tr>';
      }
    }
  }

  function loadAll() {
    return Promise.all([
      loadRevenue().catch(error => console.error('[Analytics] Revenue load failed:', error)),
      loadMetrics().catch(error => console.error('[Analytics] Metrics load failed:', error)),
      loadUserGrowth().catch(error => console.error('[Analytics] User growth load failed:', error)),
    ]);
  }

  function ensureLiveRefreshStatus() {
    let status = document.getElementById('analyticsLiveRefreshStatus');
    if (status || !refreshButton || !refreshButton.parentElement) {
      return status;
    }
    status = document.createElement('span');
    status.id = 'analyticsLiveRefreshStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText =
      'display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid #bbf7d0;border-radius:999px;background:#f0fdf4;color:#166534;font-size:12px;font-weight:700';
    status.innerHTML =
      '<span data-live-dot aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.12)"></span><span data-live-text>Live · refreshes every 15s</span>';
    refreshButton.parentElement.insertBefore(status, refreshButton);
    return status;
  }

  function updateLiveRefreshStatus(state) {
    const status = ensureLiveRefreshStatus();
    if (!status) {
      return;
    }
    const dot = status.querySelector('[data-live-dot]');
    const text = status.querySelector('[data-live-text]');
    const settings = {
      paused: ['#e2e8f0', '#f8fafc', '#64748b', '#94a3b8', 'Paused while this tab is hidden'],
      refreshing: ['#bae6fd', '#f0f9ff', '#075985', '#0284c7', 'Refreshing live analytics…'],
      live: ['#bbf7d0', '#f0fdf4', '#166534', '#16a34a', 'Live · refreshes every 15s'],
    }[state] || ['#bbf7d0', '#f0fdf4', '#166534', '#16a34a', 'Live · refreshes every 15s'];
    status.style.borderColor = settings[0];
    status.style.background = settings[1];
    status.style.color = settings[2];
    if (dot) {
      dot.style.background = settings[3];
      dot.style.boxShadow = `0 0 0 4px ${state === 'paused' ? 'rgba(148,163,184,.12)' : state === 'refreshing' ? 'rgba(2,132,199,.12)' : 'rgba(22,163,74,.12)'}`;
    }
    if (text) {
      text.textContent = settings[4];
    }
  }

  function isSpecificPostHogDestination(value) {
    if (!value) {
      return false;
    }
    try {
      return /^\/project\/[^/]+(?:\/|$)/.test(new URL(value, window.location.href).pathname);
    } catch (_error) {
      return false;
    }
  }

  function ensurePostHogGuidance() {
    const link = document.getElementById('behaviourPosthogLink');
    if (!link || !link.parentElement) {
      return;
    }
    let guidance = document.getElementById('behaviourPosthogGuidance');
    if (!link.hidden && !isSpecificPostHogDestination(link.getAttribute('href') || '')) {
      link.hidden = true;
      if (!guidance) {
        guidance = document.createElement('span');
        guidance.id = 'behaviourPosthogGuidance';
        guidance.style.cssText =
          'display:block;padding:9px 11px;border:1px solid #fde68a;border-radius:10px;background:#fffbeb;color:#92400e;font-size:12px;font-weight:700';
        link.insertAdjacentElement('afterend', guidance);
      }
      guidance.textContent =
        'PostHog needs an exact project URL. Add POSTHOG_DASHBOARD_URL in Railway, then redeploy.';
      guidance.hidden = false;
    } else if (guidance) {
      guidance.hidden = true;
    }
  }

  async function runRefresh() {
    if (refreshInFlight) {
      return;
    }
    refreshInFlight = true;
    updateLiveRefreshStatus('refreshing');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.style.opacity = '0.6';
    }
    try {
      await loadAll();
    } finally {
      refreshInFlight = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.style.opacity = '';
      }
      window.setTimeout(ensurePostHogGuidance, 250);
      updateLiveRefreshStatus(document.visibilityState === 'visible' ? 'live' : 'paused');
    }
  }

  function clearAutoRefresh() {
    if (autoRefreshTimer) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function scheduleAutoRefresh() {
    clearAutoRefresh();
    if (document.visibilityState !== 'visible') {
      updateLiveRefreshStatus('paused');
      return;
    }
    updateLiveRefreshStatus('live');
    autoRefreshTimer = window.setTimeout(() => {
      if (refreshButton && !refreshButton.disabled) {
        refreshButton.click();
      }
      scheduleAutoRefresh();
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      clearAutoRefresh();
      updateLiveRefreshStatus('paused');
      return;
    }
    if (refreshButton && !refreshButton.disabled) {
      refreshButton.click();
    }
    scheduleAutoRefresh();
  }

  function init() {
    loadDecisionAssets();
    refreshButton = document.getElementById('analyticsRefreshBtn');
    ensureLiveRefreshStatus();
    if (refreshButton) {
      refreshButton.title = 'Refresh now · this page also refreshes automatically every 15 seconds';
      refreshButton.setAttribute(
        'aria-label',
        'Refresh analytics now. Analytics also refreshes automatically every 15 seconds.'
      );
      refreshButton.addEventListener('click', runRefresh);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', clearAutoRefresh);
    runRefresh().finally(() => {
      window.setTimeout(ensurePostHogGuidance, 500);
      scheduleAutoRefresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
