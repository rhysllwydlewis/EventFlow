/**
 * Admin Analytics Page Initialization
 * Fetches and renders revenue, user growth, and platform statistics.
 */

(function () {
  'use strict';

  const AUTO_REFRESH_INTERVAL_MS = 15 * 1000;
  let autoRefreshTimer = null;
  let refreshInFlight = false;
  let refreshButton = null;

  /**
   * Format a number as GBP currency string (£X.XX)
   */
  function formatGBP(amount) {
    return `£${Number(amount || 0).toFixed(2)}`;
  }

  /**
   * Set text content of an element by ID (no-op if element not found)
   */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  /**
   * Capitalise the first letter of a string
   */
  function capitalise(str) {
    if (!str) {
      return str;
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Load and render Stripe analytics data.
   * Falls back to /api/v2/admin/revenue if Stripe is not configured.
   */
  async function loadRevenue() {
    let stripeData = null;
    try {
      stripeData = await AdminShared.api('/api/admin/stripe-analytics');
    } catch (_) {
      stripeData = { available: false };
    }

    const noticeEl = document.getElementById('stripeNotice');
    const badgeEl = document.getElementById('stripeStatusBadge');
    const msgEl = document.getElementById('stripeStatusMsg');

    if (noticeEl) {
      noticeEl.style.display = '';
    }

    if (stripeData && stripeData.available === true) {
      if (badgeEl) {
        badgeEl.textContent = 'Connected';
        badgeEl.style.background = '#dcfce7';
        badgeEl.style.color = '#16a34a';
      }
      if (msgEl) {
        msgEl.textContent = 'Live Stripe data is being displayed below.';
      }

      setText('an-totalRevenue', formatGBP(stripeData.totalRevenue));
      setText('an-monthRevenue', formatGBP(stripeData.monthRevenue));
      setText('an-activeSubs', String(stripeData.activeSubscriptions || 0));
      setText('an-availableBalance', formatGBP(stripeData.availableBalance));
      setText('an-totalRevenueNote', 'From Stripe (last 100 charges)');
    } else {
      if (badgeEl) {
        badgeEl.textContent = 'Not configured';
        badgeEl.style.background = '#fef9c3';
        badgeEl.style.color = '#92400e';
      }
      if (msgEl) {
        msgEl.textContent = 'Stripe is not configured. Showing subscription MRR data only.';
      }

      setText('an-totalRevenue', 'N/A');
      setText('an-monthRevenue', 'N/A');
      setText('an-availableBalance', 'N/A');
    }

    try {
      const v2Data = await AdminShared.api('/api/v2/admin/revenue');
      if (v2Data && v2Data.revenue) {
        setText('an-mrr', formatGBP(v2Data.revenue.mrr));
        if (!stripeData || !stripeData.available) {
          setText('an-activeSubs', String(v2Data.revenue.activeSubscriptions || 0));
        }
      }
      if (v2Data && v2Data.churn) {
        const churnPct = Number(v2Data.churn.churnRate || 0).toFixed(1);
        setText('an-churnRate', `${churnPct}%`);
      }
    } catch (_) {
      setText('an-mrr', 'N/A');
      setText('an-churnRate', 'N/A');
    }
  }

  /**
   * Load and render platform metrics (users, suppliers, packages, etc.)
   */
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

      const suppPendingEl = document.getElementById('an-suppliersPending');
      if (suppPendingEl) {
        suppPendingEl.textContent =
          pendingSuppliers > 0 ? `${pendingSuppliers} pending approval` : 'All approved';
        suppPendingEl.style.color =
          pendingSuppliers > 0 ? 'var(--color-warning, #d97706)' : 'var(--color-success, #16a34a)';
      }

      const pkgPendingEl = document.getElementById('an-packagesPending');
      if (pkgPendingEl) {
        pkgPendingEl.textContent =
          pendingPackages > 0 ? `${pendingPackages} pending approval` : 'All approved';
        pkgPendingEl.style.color =
          pendingPackages > 0 ? 'var(--color-warning, #d97706)' : 'var(--color-success, #16a34a)';
      }

      const roleEl = document.getElementById('an-roleBreakdown');
      if (roleEl) {
        const byRole = counts.usersByRole || {};
        const roleKeys = Object.keys(byRole);
        if (roleKeys.length === 0) {
          roleEl.innerHTML = '<span style="color:#9ca3af;font-size:0.875rem;">No data</span>';
        } else {
          roleEl.innerHTML = roleKeys
            .map(
              r =>
                `<span style="background:var(--color-surface-2,#f3f4f6);padding:5px 14px;border-radius:999px;font-size:0.875rem;border:1px solid #e5e7eb;">
              <strong>${capitalise(r)}</strong>: ${byRole[r]}
            </span>`
            )
            .join('');
        }
      }
    } catch (_) {
      AdminShared.showToast('Failed to load platform metrics', 'error');
    }
  }

  /**
   * Load users list to compute recent signup counts, and load timeseries table.
   */
  async function loadUserGrowth() {
    try {
      const usersData = await AdminShared.api('/api/admin/users');
      const users = (usersData && usersData.items) || [];
      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      const oneMonth = 30 * 24 * 60 * 60 * 1000;

      const signups7d = users.filter(u => {
        const t = u.createdAt ? Date.parse(u.createdAt) : NaN;
        return !isNaN(t) && t >= now - oneWeek;
      }).length;

      const signups30d = users.filter(u => {
        const t = u.createdAt ? Date.parse(u.createdAt) : NaN;
        return !isNaN(t) && t >= now - oneMonth;
      }).length;

      setText('an-signups7d', String(signups7d));
      setText('an-signups30d', String(signups30d));
    } catch (_) {
      setText('an-signups7d', 'N/A');
      setText('an-signups30d', 'N/A');
    }

    try {
      const tsData = await AdminShared.api('/api/admin/metrics/timeseries');
      const series = (tsData && tsData.series) || [];
      const tbody = document.getElementById('an-timeseriesBody');
      if (tbody) {
        if (series.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="3" style="padding:1.5rem;text-align:center;color:#9ca3af;">No data available</td></tr>';
        } else {
          tbody.innerHTML = series
            .map(
              (row, i) =>
                `<tr style="${i % 2 === 0 ? '' : 'background:#f9fafb;'}">
              <td style="padding:0.5rem 1rem;font-size:0.875rem;color:#374151;">${row.date}</td>
              <td style="padding:0.5rem 1rem;text-align:center;font-size:0.875rem;font-weight:${row.signups > 0 ? '600' : '400'};color:${row.signups > 0 ? '#0B8073' : '#9ca3af'};">${row.signups || 0}</td>
              <td style="padding:0.5rem 1rem;text-align:center;font-size:0.875rem;font-weight:${row.plans > 0 ? '600' : '400'};color:${row.plans > 0 ? '#7c3aed' : '#9ca3af'};">${row.plans || 0}</td>
            </tr>`
            )
            .join('');
        }
      }
    } catch (_) {
      const tbody = document.getElementById('an-timeseriesBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="3" style="padding:1.5rem;text-align:center;color:#9ca3af;">Failed to load timeseries data</td></tr>';
      }
    }
  }

  function loadAll() {
    return Promise.all([
      loadRevenue().catch(err => console.error('[Analytics] Revenue load failed:', err)),
      loadMetrics().catch(err => console.error('[Analytics] Metrics load failed:', err)),
      loadUserGrowth().catch(err => console.error('[Analytics] User growth load failed:', err)),
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
    status.style.display = 'inline-flex';
    status.style.alignItems = 'center';
    status.style.gap = '7px';
    status.style.padding = '7px 11px';
    status.style.border = '1px solid #bbf7d0';
    status.style.borderRadius = '999px';
    status.style.background = '#f0fdf4';
    status.style.color = '#166534';
    status.style.fontSize = '12px';
    status.style.fontWeight = '700';
    status.innerHTML =
      '<span data-live-dot aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.12);"></span><span data-live-text>Live · refreshes every 15s</span>';
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
    if (state === 'paused') {
      status.style.borderColor = '#e2e8f0';
      status.style.background = '#f8fafc';
      status.style.color = '#64748b';
      if (dot) {
        dot.style.background = '#94a3b8';
        dot.style.boxShadow = '0 0 0 4px rgba(148,163,184,.12)';
      }
      if (text) {
        text.textContent = 'Paused while this tab is hidden';
      }
      return;
    }

    if (state === 'refreshing') {
      status.style.borderColor = '#bae6fd';
      status.style.background = '#f0f9ff';
      status.style.color = '#075985';
      if (dot) {
        dot.style.background = '#0284c7';
        dot.style.boxShadow = '0 0 0 4px rgba(2,132,199,.12)';
      }
      if (text) {
        text.textContent = 'Refreshing live analytics…';
      }
      return;
    }

    status.style.borderColor = '#bbf7d0';
    status.style.background = '#f0fdf4';
    status.style.color = '#166534';
    if (dot) {
      dot.style.background = '#16a34a';
      dot.style.boxShadow = '0 0 0 4px rgba(22,163,74,.12)';
    }
    if (text) {
      text.textContent = 'Live · refreshes every 15s';
    }
  }

  function isSpecificPostHogDestination(value) {
    if (!value) {
      return false;
    }
    try {
      const parsed = new URL(value, window.location.href);
      return /^\/project\/[^/]+(?:\/|$)/.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  }

  function ensurePostHogGuidance() {
    const link = document.getElementById('behaviourPosthogLink');
    if (!link || !link.parentElement) {
      return;
    }

    let guidance = document.getElementById('behaviourPosthogGuidance');
    const destination = link.getAttribute('href') || '';
    const hasSpecificDestination = isSpecificPostHogDestination(destination);

    if (!link.hidden && !hasSpecificDestination) {
      link.hidden = true;
      if (!guidance) {
        guidance = document.createElement('span');
        guidance.id = 'behaviourPosthogGuidance';
        guidance.style.display = 'block';
        guidance.style.padding = '9px 11px';
        guidance.style.border = '1px solid #fde68a';
        guidance.style.borderRadius = '10px';
        guidance.style.background = '#fffbeb';
        guidance.style.color = '#92400e';
        guidance.style.fontSize = '12px';
        guidance.style.fontWeight = '700';
        link.insertAdjacentElement('afterend', guidance);
      }
      guidance.textContent =
        'PostHog needs an exact project URL. Add POSTHOG_DASHBOARD_URL in Railway, then redeploy.';
      guidance.hidden = false;
      return;
    }

    if (guidance) {
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
      if (refreshButton && !refreshButton.disabled && document.visibilityState === 'visible') {
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
