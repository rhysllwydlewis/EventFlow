/**
 * Admin Payment Analytics Initialization
 * Displays payment analytics and transaction history for administrators
 * Uses MongoDB API and integrates with live Stripe analytics
 */

let revenueChart = null;
let plansChart = null;

// Filter state
const currentFilters = {
  status: 'all',
  plan: 'all',
  days: 'all',
};

/**
 * Load live Stripe analytics data
 */
async function loadStripeAnalytics() {
  try {
    const response = await AdminShared.api('/api/admin/stripe-analytics');
    return response;
  } catch (error) {
    console.error('Error loading Stripe analytics:', error);
    return { available: false };
  }
}

/**
 * Load payments from the admin API. Each row already carries the customer, plan, amount after
 * refunds and status group; the headline numbers come with it.
 */
async function loadPayments() {
  try {
    const response = await AdminShared.api('/api/admin/payments');
    return { items: response.items || [], summary: response.summary || null };
  } catch (error) {
    console.error('Error loading payments:', error);
    AdminShared.showToast('Failed to load payments', 'error');
    return { items: [], summary: null };
  }
}

/**
 * Money as pounds and pence, with thousands separators.
 */
function formatPounds(value) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
    Number(value) || 0
  );
}

/**
 * Filter payments based on current filters
 */
function filterPayments(payments) {
  let filtered = [...payments];

  // Filter by status group (paid, pending, failed, refunded, disputed)
  if (currentFilters.status !== 'all') {
    filtered = filtered.filter(payment => payment.statusGroup === currentFilters.status);
  }

  // Filter by plan
  if (currentFilters.plan !== 'all') {
    filtered = filtered.filter(p => p.planId === currentFilters.plan);
  }

  // Filter by date
  if (currentFilters.days !== 'all') {
    const days = parseInt(currentFilters.days, 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    filtered = filtered.filter(payment => new Date(payment.createdAt) >= cutoffDate);
  }

  return filtered;
}

/**
 * Month key (YYYY-MM, UTC) for a payment date, matching the server's grouping.
 */
function monthKeyOf(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Render statistics cards.
 *
 * The headline numbers are for the whole business and come from the server: revenue is what
 * paid invoices brought in less refunds, active subscriptions are real subscriptions, and
 * neither moves with the table filters. Live Stripe data adds the last 30 days, net of refunds.
 */
function renderStats(summary, stripeAnalytics) {
  const stats = summary || {
    totalRevenue: 0,
    monthRevenue: 0,
    refundedTotal: 0,
    totalTransactions: 0,
    activeSubscriptions: 0,
  };
  const useStripe =
    stripeAnalytics &&
    stripeAnalytics.available &&
    typeof stripeAnalytics.netRevenueLast30Days === 'number';

  const setText = (elementId, text) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = text;
    }
  };

  setText('totalRevenue', formatPounds(stats.totalRevenue));
  setText('activeSubscriptions', String(stats.activeSubscriptions));
  setText('totalTransactions', String(stats.totalTransactions));
  setText('monthRevenue', formatPounds(stats.monthRevenue));

  const refunded = stats.refundedTotal > 0 ? `, ${formatPounds(stats.refundedTotal)} refunded` : '';
  setText('revenueChange', `All time, after refunds${refunded}`);
  setText('subscriptionChange', 'Active and trialing subscriptions');
  setText('transactionChange', 'All payment records');
  setText(
    'monthChange',
    useStripe
      ? `This month. Stripe, last 30 days: ${formatPounds(stripeAnalytics.netRevenueLast30Days)}`
      : 'This month, after refunds'
  );
}

/**
 * Render revenue chart
 */
function renderRevenueChart(summary) {
  const stats = summary || { revenueByMonth: {} };
  const ctx = document.getElementById('revenueChart');
  if (!ctx) {
    return;
  }

  // Destroy existing chart
  if (revenueChart) {
    revenueChart.destroy();
  }

  // Get last 12 months
  const months = [];
  const revenues = [];
  const now = new Date();

  for (let i = 11; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthKey = monthKeyOf(date);
    const monthLabel = date.toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    months.push(monthLabel);
    revenues.push(stats.revenueByMonth[monthKey] || 0);
  }

  revenueChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Revenue (£)',
          data: revenues,
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (value) {
              return `£${value.toFixed(0)}`;
            },
          },
        },
      },
    },
  });
}

/**
 * Render plans distribution chart
 */
function renderPlansChart(summary) {
  const stats = summary || { planDistribution: {} };
  const ctx = document.getElementById('plansChart');
  if (!ctx) {
    return;
  }

  // Destroy existing chart
  if (plansChart) {
    plansChart.destroy();
  }

  const planLabels = {
    pro_monthly: 'Pro Monthly',
    pro_plus_monthly: 'Pro+ Monthly',
    pro_yearly: 'Pro Yearly',
    pro_plus_yearly: 'Pro+ Yearly',
    other: 'Other',
  };

  const labels = [];
  const data = [];
  const colors = [
    'rgb(59, 130, 246)',
    'rgb(147, 51, 234)',
    'rgb(16, 185, 129)',
    'rgb(245, 158, 11)',
    'rgb(156, 163, 175)',
  ];

  Object.entries(stats.planDistribution).forEach(([planId, count]) => {
    labels.push(planLabels[planId] || planId);
    data.push(count);
  });

  plansChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

/**
 * Render payments table
 */
function renderPaymentsTable(payments) {
  const tbody = document.getElementById('paymentsTableBody');
  if (!tbody) {
    return;
  }

  if (payments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2rem; color: #6b7280;">
          No payments match these filters
        </td>
      </tr>
    `;
    return;
  }

  const statusLabels = {
    paid: 'Paid',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded',
    disputed: 'Disputed',
  };

  tbody.innerHTML = payments
    .map(payment => {
      const customer = payment.customerName || payment.customerEmail || 'Unknown customer';
      const email =
        payment.customerName && payment.customerEmail
          ? `<br><span class="small">${AdminShared.escapeHtml(payment.customerEmail)}</span>`
          : '';
      const planName = payment.planName || 'N/A';
      const date = new Date(payment.createdAt).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const group = payment.statusGroup in statusLabels ? payment.statusGroup : 'pending';
      // A subscription payment's money is recorded on its invoice, so some have no amount here
      const amountCell =
        payment.amount === null
          ? '<span class="small" title="The amount is recorded on the invoice">See invoice</span>'
          : formatPounds(payment.amount);
      const refundNote =
        payment.refundedAmount > 0
          ? `<br><span class="small">${formatPounds(payment.refundedAmount)} refunded</span>`
          : '';

      return `
        <tr>
          <td>${date}</td>
          <td>${AdminShared.escapeHtml(customer)}${email}</td>
          <td>${AdminShared.escapeHtml(planName)}</td>
          <td>${amountCell}${refundNote}</td>
          <td>
            <span class="payment-status payment-status--${group}" title="${AdminShared.escapeHtml(payment.status)}">
              ${statusLabels[group]}
            </span>
          </td>
          <td style="font-family: monospace; font-size: 0.875rem;">
            ${AdminShared.escapeHtml((payment.id || '').substring(0, 8))}...
          </td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Initialize the page
 */
async function init() {
  // Load data
  const [{ items: payments, summary }, stripeAnalytics] = await Promise.all([
    loadPayments(),
    loadStripeAnalytics(),
  ]);

  // Update Stripe status indicator
  const stripeStatusEl = document.getElementById('stripeStatus');
  if (stripeStatusEl) {
    if (stripeAnalytics && stripeAnalytics.available) {
      stripeStatusEl.textContent = '✓ Connected';
      stripeStatusEl.style.background = '#dcfce7';
      stripeStatusEl.style.color = '#166534';
      AdminShared.showToast('Live Stripe analytics loaded', 'success');
    } else {
      stripeStatusEl.textContent = '○ Not Configured';
      stripeStatusEl.style.background = '#fef3c7';
      stripeStatusEl.style.color = '#92400e';
    }
  }

  refreshData(payments, summary, stripeAnalytics);
  setupEventListeners(payments, summary, stripeAnalytics);
}

/**
 * Setup event listeners
 */
function setupEventListeners(payments, summary, stripeAnalytics) {
  // The filters always apply to the latest data, including after a refresh
  const latest = { payments, summary, stripeAnalytics };
  const redraw = () => refreshData(latest.payments, latest.summary, latest.stripeAnalytics);

  const filterBindings = [
    ['statusFilter', 'status'],
    ['planFilter', 'plan'],
    ['dateFilter', 'days'],
  ];
  filterBindings.forEach(([elementId, key]) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', event => {
        currentFilters[key] = event.target.value;
        redraw();
      });
    }
  });

  const reload = async () => {
    const [loaded, newStripeAnalytics] = await Promise.all([loadPayments(), loadStripeAnalytics()]);
    latest.payments = loaded.items;
    latest.summary = loaded.summary;
    latest.stripeAnalytics = newStripeAnalytics;
    redraw();
    AdminShared.showToast('Payment data refreshed', 'success');
  };

  // Make refresh function available globally for navbar refresh button
  window.refreshDashboardData = reload;
  const refreshButton = document.getElementById('refreshBtn');
  if (refreshButton) {
    refreshButton.addEventListener('click', reload);
  }
}

/**
 * Redraw everything for the current filters
 */
function refreshData(payments, summary, stripeAnalytics) {
  const filteredPayments = filterPayments(payments);

  renderStats(summary, stripeAnalytics);
  renderRevenueChart(summary);
  renderPlansChart(summary);
  renderPaymentsTable(filteredPayments);

  const countEl = document.getElementById('paymentsCount');
  if (countEl) {
    countEl.textContent = `Showing ${filteredPayments.length} of ${payments.length} payments`;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
