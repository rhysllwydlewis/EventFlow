/**
 * Admin Analytics Page Initialization
 * Fetches and renders revenue, user growth, and platform statistics.
 */

(function () {
  'use strict';

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
    if (el) el.textContent = value;
  }

  /**
   * Load and render Stripe analytics data.
   * Falls back to /api/v2/admin/revenue if Stripe is not configured.
   */
  async function loadRevenue() {
    // Stripe analytics
    let stripeData = null;
    try {
      stripeData = await AdminShared.api('/api/admin/stripe-analytics');
    } catch (_) {
      stripeData = { available: false };
    }

    const noticeEl = document.getElementById('stripeNotice');
    const badgeEl = document.getElementById('stripeStatusBadge');
    const msgEl = document.getElementById('stripeStatusMsg');

    if (noticeEl) noticeEl.style.display = '';

    if (stripeData && stripeData.available === true) {
      if (badgeEl) {
        badgeEl.textContent = 'Connected';
        badgeEl.style.background = '#dcfce7';
        badgeEl.style.color = '#16a34a';
      }
      if (msgEl) msgEl.textContent = 'Live Stripe data is being displayed below.';

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
      if (msgEl) msgEl.textContent = 'Stripe is not configured. Showing subscription MRR data only.';

      setText('an-totalRevenue', 'N/A');
      setText('an-monthRevenue', 'N/A');
      setText('an-availableBalance', 'N/A');
    }

    // v2 revenue for MRR and churn (always loaded — independent of Stripe)
    try {
      const v2Data = await AdminShared.api('/api/v2/admin/revenue');
      if (v2Data && v2Data.revenue) {
        setText('an-mrr', formatGBP(v2Data.revenue.mrr));
        if (!stripeData || !stripeData.available) {
          setText('an-activeSubs', String(v2Data.revenue.activeSubscriptions || 0));
        }
      }
      if (v2Data && v2Data.churn) {
        const churnPct = Number(v2Data.churn.rate || 0).toFixed(1);
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
        suppPendingEl.textContent = pendingSuppliers > 0
          ? `${pendingSuppliers} pending approval`
          : 'All approved';
        suppPendingEl.style.color = pendingSuppliers > 0
          ? 'var(--color-warning, #d97706)'
          : 'var(--color-success, #16a34a)';
      }

      const pkgPendingEl = document.getElementById('an-packagesPending');
      if (pkgPendingEl) {
        pkgPendingEl.textContent = pendingPackages > 0
          ? `${pendingPackages} pending approval`
          : 'All approved';
        pkgPendingEl.style.color = pendingPackages > 0
          ? 'var(--color-warning, #d97706)'
          : 'var(--color-success, #16a34a)';
      }

      // Roles breakdown
      const roleEl = document.getElementById('an-roleBreakdown');
      if (roleEl) {
        const byRole = counts.usersByRole || {};
        const roleKeys = Object.keys(byRole);
        if (roleKeys.length === 0) {
          roleEl.innerHTML = '<span style="opacity:0.6">No data</span>';
        } else {
          roleEl.innerHTML = roleKeys.map(r =>
            `<span style="background:var(--color-surface-2,#f3f4f6);padding:4px 12px;border-radius:999px;font-size:0.875rem;">
              <strong>${r}</strong>: ${byRole[r]}
            </span>`
          ).join('');
        }
      }

      // Signups in last 7 / 30 days from timeseries data
      loadUserGrowth();
    } catch (_) {
      AdminShared.showToast('Failed to load platform metrics', 'error');
    }
  }

  /**
   * Load users list to compute recent signup counts, and load timeseries table.
   */
  async function loadUserGrowth() {
    // Compute 7d / 30d signups from users list
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

    // Timeseries table
    try {
      const tsData = await AdminShared.api('/api/admin/metrics/timeseries');
      const series = (tsData && tsData.series) || [];
      const tbody = document.getElementById('an-timeseriesBody');
      if (tbody) {
        if (series.length === 0) {
          tbody.innerHTML = '<tr><td colspan="3" style="padding:1rem;text-align:center;opacity:0.6">No data</td></tr>';
        } else {
          tbody.innerHTML = series.map(row =>
            `<tr>
              <td style="padding:0.4rem 0.75rem">${row.date}</td>
              <td style="padding:0.4rem 0.75rem;text-align:center">${row.signups || 0}</td>
              <td style="padding:0.4rem 0.75rem;text-align:center">${row.plans || 0}</td>
            </tr>`
          ).join('');
        }
      }
    } catch (_) {
      const tbody = document.getElementById('an-timeseriesBody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding:1rem;text-align:center;opacity:0.6">Failed to load timeseries</td></tr>';
      }
    }
  }

  /**
   * Main initialisation — runs after DOM ready.
   */
  function init() {
    // Run all fetches in parallel (best-effort, independent)
    Promise.all([
      loadRevenue().catch(err => console.error('[Analytics] Revenue load failed:', err)),
      loadMetrics().catch(err => console.error('[Analytics] Metrics load failed:', err)),
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
