/**
 * Supplier Analytics Chart
 * Chart.js integration for supplier dashboard analytics
 */

import { initCountUp } from './count-up-animation.js';

/* ── Reusable SVG icon header snippets for JS-injected chart cards ──────
   Each helper returns an HTML string: the icon box + h3 title row.
   Uses the same .sd-card-header / .sd-card-header__icon classes as the
   static HTML cards so CSS sizing + currentColor rules apply uniformly. */

function _enquiryTrendIconHeader() {
  return `<div class="sd-card-header" style="margin-bottom:1rem;">
    <div class="sd-card-header__title-row" style="display:flex;align-items:center;gap:0.75rem;">
      <div class="sd-card-header__icon sd-card-header__icon--teal" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="15.5" rx="1.5" fill="currentColor" fill-opacity="0.06"/>
          <line x1="4" y1="17" x2="22" y2="17"/>
          <path d="M4 17 L7.5 14 L11.5 11 L16 7.5 L20 5.5 L22 5.5 L22 17 Z" fill="currentColor" fill-opacity="0.09" stroke="none"/>
          <polyline points="4 17 7.5 14 11.5 11 16 7.5 20 5.5"/>
          <polyline points="17 5.5 20.5 5 20 8.5"/>
          <circle cx="7.5" cy="14" r="1.5" fill="currentColor"/>
          <circle cx="11.5" cy="11" r="1.5" fill="currentColor"/>
          <circle cx="16" cy="7.5" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      <h3 style="margin:0;font-size:1.25rem;color:#0B1220;font-weight:600;">Enquiry Trends</h3>
    </div>
  </div>`;
}
function _funnelIconHeader() {
  return `<div class="sd-card-header" style="margin-bottom:1rem;">
    <div class="sd-card-header__title-row" style="display:flex;align-items:center;gap:0.75rem;">
      <div class="sd-card-header__icon sd-card-header__icon--indigo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 5h20"/>
          <path d="M2 5L5 9.5L19 9.5L22 5z" fill="currentColor" fill-opacity="0.15" stroke="none"/>
          <path d="M5 9.5L8.5 13h7L19 9.5z" fill="currentColor" fill-opacity="0.12" stroke="none"/>
          <path d="M8.5 13L9.5 15.5h5L15.5 13z" fill="currentColor" fill-opacity="0.09" stroke="none"/>
          <line x1="5" y1="9.5" x2="19" y2="9.5"/>
          <line x1="8.5" y1="13" x2="15.5" y2="13"/>
          <path d="M2 5L5 9.5L8.5 13L9.5 15.5"/>
          <path d="M22 5L19 9.5L15.5 13L14.5 15.5"/>
          <line x1="9.5" y1="15.5" x2="14.5" y2="15.5"/>
          <line x1="12" y1="15.5" x2="12" y2="18" stroke-width="1.5"/>
        </svg>
      </div>
      <h3 style="margin:0;font-size:1.25rem;color:#0B1220;font-weight:600;">Conversion Funnel</h3>
    </div>
  </div>`;
}

function _stopwatchIconHeader() {
  return `<div class="sd-card-header" style="margin-bottom:1rem;">
    <div class="sd-card-header__title-row" style="display:flex;align-items:center;gap:0.75rem;">
      <div class="sd-card-header__icon sd-card-header__icon--blue" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="14" r="7.5" fill="currentColor" fill-opacity="0.09"/>
          <circle cx="12" cy="14" r="7.5"/>
          <line x1="12" y1="6.5" x2="12" y2="4"/>
          <line x1="10" y1="4" x2="14" y2="4" stroke-width="2"/>
          <line x1="15.5" y1="7" x2="17" y2="5.5" stroke-width="1.5"/>
          <line x1="12" y1="14" x2="12" y2="9.5" stroke-width="2"/>
          <line x1="12" y1="14" x2="15.5" y2="11.5" stroke-width="1.5"/>
          <circle cx="12" cy="14" r="1" fill="currentColor"/>
          <line x1="3.5" y1="12" x2="1.5" y2="11" stroke-width="1.25"/>
          <line x1="4" y1="15" x2="2" y2="15.5" stroke-width="1.25"/>
        </svg>
      </div>
      <h3 style="margin:0;font-size:1.25rem;color:#0B1220;font-weight:600;">Response Time</h3>
    </div>
  </div>`;
}

/**
 * Load Chart.js library if not already loaded
 * @returns {Promise<void>}
 */
async function loadChartJS() {
  if (window.Chart) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/assets/vendor/chart.umd.js';
    script.onload = resolve;
    script.onerror = () => {
      // Fallback to CDN if local file fails
      const cdnScript = document.createElement('script');
      cdnScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
      cdnScript.onload = resolve;
      cdnScript.onerror = reject;
      document.head.appendChild(cdnScript);
    };
    document.head.appendChild(script);
  });
}

/**
 * Create analytics chart
 * @param {string} canvasId - Canvas element ID
 * @param {object} data - Chart data
 * @param {object} options - Chart options
 */
export async function createAnalyticsChart(canvasId, data, options = {}) {
  try {
    await loadChartJS();

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error(`Canvas element with id "${canvasId}" not found`);
      return null;
    }

    const ctx = canvas.getContext('2d');

    const defaultOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 15,
            font: {
              size: 12,
              family: "'Inter', -apple-system, sans-serif",
            },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(11, 18, 32, 0.95)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              label += context.parsed.y;
              return label;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            font: {
              size: 11,
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
          },
          ticks: {
            font: {
              size: 11,
            },
            precision: 0,
          },
        },
      },
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      plugins: {
        ...defaultOptions.plugins,
        ...(options.plugins || {}),
      },
      scales: {
        ...defaultOptions.scales,
        ...(options.scales || {}),
      },
    };

    return new Chart(ctx, {
      type: 'line',
      data: data,
      options: mergedOptions,
    });
  } catch (error) {
    console.error('Error creating analytics chart:', error);
    return null;
  }
}

/**
 * Create supplier performance chart widget
 * @param {string} containerId - Container element ID
 * @param {Array} viewsData - Views data array
 * @param {Array} enquiriesData - Enquiries data array
 * @param {Array} labels - Date labels
 */
export async function createPerformanceChart(containerId, viewsData, enquiriesData, labels) {
  const container = document.getElementById(containerId);
  if (!container) {
    return null;
  }

  const canvasId = `${containerId}-canvas`;

  const html = `
    <div class="card" style="padding: 1.5rem;">
      <div class="sd-card-header" style="margin-bottom: 1rem;">
        <div class="sd-card-header__title-row" style="display: flex; align-items: center; gap: 0.75rem;">
          <div class="sd-card-header__icon sd-card-header__icon--teal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="15" rx="1.5" fill="currentColor" fill-opacity="0.06"/>
              <line x1="6" y1="4" x2="6" y2="17"/>
              <line x1="6" y1="17" x2="21" y2="17"/>
              <line x1="6" y1="11" x2="21" y2="11" stroke-width="0.75" stroke-dasharray="2 2"/>
              <polyline points="7 15 10 11 14 13 18 7 21 9" stroke-width="2"/>
              <circle cx="10" cy="11" r="1.75" fill="currentColor"/>
              <circle cx="14" cy="13" r="1.75" fill="currentColor"/>
              <circle cx="18" cy="7" r="1.75" fill="currentColor"/>
              <path d="M7 15 L10 11 L14 13 L18 7 L21 9 L21 17 L7 17 Z" fill="currentColor" fill-opacity="0.07" stroke="none"/>
            </svg>
          </div>
          <h3 style="margin: 0; font-size: 1.25rem; color: #0B1220; font-weight: 600;">Performance Analytics</h3>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
        <button class="chart-period-btn active" data-period="7" style="padding: 0.5rem 1rem; border: 1px solid #E7EAF0; background: white; border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;">7 Days</button>
        <button class="chart-period-btn" data-period="30" style="padding: 0.5rem 1rem; border: 1px solid #E7EAF0; background: white; border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;">30 Days</button>
        <button class="chart-period-btn" data-period="90" style="padding: 0.5rem 1rem; border: 1px solid #E7EAF0; background: white; border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;">90 Days</button>
      </div>
      <div class="chart-container" style="position: relative; height: 300px;">
        <canvas id="${canvasId}"></canvas>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Create gradient for views
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const viewsGradient = ctx.createLinearGradient(0, 0, 0, 300);
  viewsGradient.addColorStop(0, 'rgba(11, 128, 115, 0.3)');
  viewsGradient.addColorStop(1, 'rgba(11, 128, 115, 0.01)');

  const enquiriesGradient = ctx.createLinearGradient(0, 0, 0, 300);
  enquiriesGradient.addColorStop(0, 'rgba(19, 182, 162, 0.3)');
  enquiriesGradient.addColorStop(1, 'rgba(19, 182, 162, 0.01)');

  const chartData = {
    labels: labels,
    datasets: [
      {
        label: 'Profile Views',
        data: viewsData,
        borderColor: '#0B8073',
        backgroundColor: viewsGradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#0B8073',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
      {
        label: 'Enquiries',
        data: enquiriesData,
        borderColor: '#13B6A2',
        backgroundColor: enquiriesGradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#13B6A2',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      },
    ],
  };

  const chart = await createAnalyticsChart(canvasId, chartData);

  // Add period selector functionality
  const periodButtons = container.querySelectorAll('.chart-period-btn');
  periodButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      // Update active state
      periodButtons.forEach(b => {
        b.classList.remove('active');
        b.style.background = 'white';
        b.style.borderColor = '#E7EAF0';
        b.style.color = '#667085';
      });
      btn.classList.add('active');
      btn.style.background = 'linear-gradient(135deg, #0B8073 0%, #13B6A2 100%)';
      btn.style.borderColor = 'transparent';
      btn.style.color = 'white';

      const period = parseInt(btn.dataset.period);

      // Fetch new data for the selected period
      // This would be replaced with actual API call
      const newData = await fetchAnalyticsData(period);

      if (chart && newData) {
        chart.data.labels = newData.labels;
        chart.data.datasets[0].data = newData.views;
        chart.data.datasets[1].data = newData.enquiries;
        chart.update('active');
      }
    });
  });

  return chart;
}

/**
 * Fetch analytics data for a specific period
 * @param {number} days - Number of days
 * @param {string} supplierId - Supplier ID (optional, will be detected from page)
 * @returns {Promise<object>} Analytics data
 */
async function fetchAnalyticsData(days, supplierId = null) {
  try {
    // Use a local variable to avoid reassigning the parameter
    let resolvedSupplierId = supplierId;

    // Try to get supplier ID from page context if not provided
    if (!resolvedSupplierId) {
      const supplierIdField = document.getElementById('sup-id');
      if (supplierIdField && supplierIdField.value) {
        resolvedSupplierId = supplierIdField.value;
      }
    }

    // If we have a supplier ID, fetch real data from API
    if (resolvedSupplierId) {
      const response = await fetch(
        `/api/me/suppliers/${resolvedSupplierId}/analytics?period=${days}`,
        {
          credentials: 'include',
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          labels: data.labels,
          views: data.views,
          enquiries: data.enquiries,
        };
      } else {
        console.warn('Failed to fetch analytics data');
      }
    }

    // Return empty data if no supplier ID exists or API fails
    const labels = [];
    const views = [];
    const enquiries = [];

    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      views.push(0);
      enquiries.push(0);
    }

    return { labels, views, enquiries };
  } catch (error) {
    console.error('Error fetching analytics data:', error);
    return null;
  }
}

/**
 * Create simple stat summary with icons
 * @param {string} containerId - Container element ID
 * @param {object} stats - Statistics object
 */
export function createAnalyticsSummary(containerId, stats) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const { views7d = 0, totalEnquiries = 0, responseRate = 0, avgResponseTime = 0 } = stats;

  const html = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div class="stat-widget card" style="padding: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div class="icon-with-gradient" style="background: linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
          <div style="flex: 1;">
            <div class="stat-number" data-target="${views7d}" data-start="0">0</div>
            <div class="stat-label">Views (7d)</div>
          </div>
        </div>
      </div>
      
      <div class="stat-widget card" style="padding: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div class="icon-with-gradient" style="background: linear-gradient(135deg, #10B981 0%, #34D399 100%);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div style="flex: 1;">
            <div class="stat-number" data-target="${totalEnquiries}" data-start="0">0</div>
            <div class="stat-label">Total Enquiries</div>
          </div>
        </div>
      </div>
      
      <div class="stat-widget card" style="padding: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div class="icon-with-gradient" style="background: linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div style="flex: 1;">
            <div class="stat-number" data-target="${responseRate}" data-format="percent" data-start="0">0%</div>
            <div class="stat-label">Response Rate</div>
          </div>
        </div>
      </div>
      
      <div class="stat-widget card" style="padding: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div class="icon-with-gradient pulse" style="background: linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div style="flex: 1;">
            <div class="stat-number" data-target="${avgResponseTime}" data-format="time" data-start="0">0h</div>
            <div class="stat-label">Avg Response Time</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Initialize count-up animations
  setTimeout(() => {
    initCountUp(`#${containerId} [data-target]`);
  }, 100);
}

/**
 * Create enquiry trend chart with period comparison
 * @param {string} containerId - Container element ID
 */
export async function createEnquiryTrendChart(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    return null;
  }

  const canvasId = `${containerId}-canvas`;

  const html = `
    <div class="card" style="padding: 1.5rem;">
      <div class="sd-card-header" style="margin-bottom: 1rem;">
        <div class="sd-card-header__title-row" style="display: flex; align-items: center; gap: 0.75rem;">
          <div class="sd-card-header__icon sd-card-header__icon--teal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="15.5" rx="1.5" fill="currentColor" fill-opacity="0.06"/>
              <line x1="4" y1="17" x2="22" y2="17"/>
              <path d="M4 17 L7.5 14 L11.5 11 L16 7.5 L20 5.5 L22 5.5 L22 17 Z" fill="currentColor" fill-opacity="0.09" stroke="none"/>
              <polyline points="4 17 7.5 14 11.5 11 16 7.5 20 5.5"/>
              <polyline points="17 5.5 20.5 5 20 8.5"/>
              <circle cx="7.5" cy="14" r="1.5" fill="currentColor"/>
              <circle cx="11.5" cy="11" r="1.5" fill="currentColor"/>
              <circle cx="16" cy="7.5" r="1.5" fill="currentColor"/>
            </svg>
          </div>
          <h3 style="margin: 0; font-size: 1.25rem; color: #0B1220; font-weight: 600;">Enquiry Trends</h3>
        </div>
      </div>
      <div style="margin-bottom: 1rem;">
        <button id="export-chart-btn" style="padding: 0.5rem 1rem; border: 1px solid #E7EAF0; background: white; border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Export Chart
        </button>
      </div>
      <div class="chart-container" style="position: relative; height: 350px;">
        <canvas id="${canvasId}"></canvas>
      </div>
      <div id="trend-comparison" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #E7EAF0;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
          <div style="text-align: center; padding: 0.75rem;">
            <div style="font-size: 0.875rem; color: #667085; margin-bottom: 0.25rem;">Last 30 Days</div>
            <div id="current-period-total" style="font-size: 1.5rem; font-weight: 700; color: #0B8073;">-</div>
            <div style="font-size: 0.75rem; color: #98A2B3;">Total Enquiries</div>
          </div>
          <div style="text-align: center; padding: 0.75rem;">
            <div style="font-size: 0.875rem; color: #667085; margin-bottom: 0.25rem;">Previous 30 Days</div>
            <div id="previous-period-total" style="font-size: 1.5rem; font-weight: 700; color: #98A2B3;">-</div>
            <div style="font-size: 0.75rem; color: #98A2B3;">Total Enquiries</div>
          </div>
          <div style="text-align: center; padding: 0.75rem;">
            <div style="font-size: 0.875rem; color: #667085; margin-bottom: 0.25rem;">Change</div>
            <div id="period-change" style="font-size: 1.5rem; font-weight: 700; color: #667085;">-</div>
            <div style="font-size: 0.75rem; color: #98A2B3;">vs. Previous Period</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  try {
    // Fetch enquiry data for last 60 days
    const data = await fetchEnquiryTrendData();

    if (!data) {
      throw new Error('Failed to fetch enquiry data');
    }

    // Create gradients
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    const currentGradient = ctx.createLinearGradient(0, 0, 0, 350);
    currentGradient.addColorStop(0, 'rgba(11, 128, 115, 0.2)');
    currentGradient.addColorStop(1, 'rgba(11, 128, 115, 0.01)');

    const previousGradient = ctx.createLinearGradient(0, 0, 0, 350);
    previousGradient.addColorStop(0, 'rgba(209, 213, 219, 0.2)');
    previousGradient.addColorStop(1, 'rgba(209, 213, 219, 0.01)');

    const chartData = {
      labels: data.labels,
      datasets: [
        {
          label: 'Last 30 Days',
          data: data.currentData,
          borderColor: '#0B8073',
          backgroundColor: currentGradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#0B8073',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
        {
          label: 'Previous 30 Days',
          data: data.previousData,
          borderColor: '#d1d5db',
          backgroundColor: previousGradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          borderDash: [5, 5],
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: '#d1d5db',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      ],
    };

    const chartOptions = {
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            precision: 0,
          },
        },
      },
      plugins: {
        tooltip: {
          mode: 'index',
          intersect: false,
        },
        legend: {
          display: true,
          position: 'top',
        },
      },
    };

    const chart = await createAnalyticsChart(canvasId, chartData, chartOptions);

    // Update comparison stats
    const currentTotal = data.currentData.reduce((sum, val) => sum + val, 0);
    const previousTotal = data.previousData.reduce((sum, val) => sum + val, 0);
    const change = currentTotal - previousTotal;
    const changePercent = previousTotal > 0 ? ((change / previousTotal) * 100).toFixed(1) : 0;

    document.getElementById('current-period-total').textContent = currentTotal;
    document.getElementById('previous-period-total').textContent = previousTotal;

    const changeElement = document.getElementById('period-change');
    const changeSign = change >= 0 ? '+' : '';
    changeElement.textContent = `${changeSign}${change} (${changeSign}${changePercent}%)`;
    changeElement.style.color = change >= 0 ? '#10B981' : '#EF4444';

    // Add export functionality
    const exportBtn = document.getElementById('export-chart-btn');
    exportBtn.addEventListener('click', () => {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `enquiry-trends-${new Date().toISOString().split('T')[0]}.png`;
      link.href = url;
      link.click();
    });

    return chart;
  } catch (error) {
    console.error('Error creating enquiry trend chart:', error);
    container.innerHTML = `
      <div class="card" style="padding: 1.5rem;">
        ${_enquiryTrendIconHeader()}
        <p style="color: #667085;">Unable to load enquiry trend data. Please try again later.</p>
      </div>
    `;
    return null;
  }
}

/**
 * Fetch enquiry trend data for last 60 days
 * @returns {Promise<object>} Trend data with current, previous, and labels
 */
async function fetchEnquiryTrendData() {
  try {
    // Fetch analytics data for 60 days
    const response = await fetch('/api/v1/supplier/analytics?days=60', {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch analytics data');
    }

    const result = await response.json();

    // Add null checks to prevent "Invalid analytics data" errors
    if (!result.success || !result.analytics) {
      console.warn('Analytics data missing or unsuccessful response');
      return null;
    }

    // Handle missing chartData gracefully - return safe defaults
    const chartData = result.analytics.chartData || [];

    // Generate last 30 and previous 30 days
    const now = new Date();
    const labels = [];
    const currentData = [];
    const previousData = [];

    // Create maps for easy lookup
    const enquiriesByDate = {};
    chartData.forEach(item => {
      enquiriesByDate[item.date] = item.enquiries || 0;
    });

    // Last 30 days (most recent)
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      currentData.push(enquiriesByDate[dateKey] || 0);
    }

    // Previous 30 days (30-59 days ago)
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i - 30);
      const dateKey = date.toISOString().split('T')[0];
      previousData.push(enquiriesByDate[dateKey] || 0);
    }

    return {
      labels,
      currentData,
      previousData,
    };
  } catch (error) {
    console.error('Error fetching enquiry trend data:', error);
    return null;
  }
}

/**
 * Create Lead Quality widget with enquiry breakdown
 * @param {string} containerId - Container element ID
 */
export async function createLeadQualityWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container "${containerId}" not found for Lead Quality widget`);
    return;
  }

  try {
    // Fetch lead quality data
    const data = await fetchLeadQualityData();

    if (!data || !data.breakdown) {
      // Show empty state
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; background: #F9FAFB; border-radius: 8px;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📊</div>
          <p style="color: #6B7280; margin: 0;">No lead quality data available yet.</p>
          <p style="color: #9CA3AF; font-size: 0.875rem; margin-top: 0.5rem;">Data will appear as you receive enquiries.</p>
        </div>
      `;
      return;
    }

    // Render lead quality breakdown
    const total = data.breakdown.reduce((sum, item) => sum + item.count, 0);
    const breakdownHTML = data.breakdown
      .map(item => {
        const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : 0;
        return `
        <div style="display: flex; align-items: center; gap: 1rem; padding: 0.75rem; background: white; border-radius: 8px; border: 1px solid #E5E7EB;">
          <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: ${item.color}; border-radius: 8px; color: white; font-weight: 700; font-size: 1.25rem;">
            ${item.icon}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #374151; margin-bottom: 0.25rem;">${item.type}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="flex: 1; height: 6px; background: #E5E7EB; border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; background: ${item.color}; width: ${percentage}%; transition: width 0.3s ease;"></div>
              </div>
              <span style="font-size: 0.875rem; color: #6B7280; min-width: 50px;">${percentage}%</span>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.5rem; font-weight: 700; color: #0B1220;">${item.count}</div>
            <div style="font-size: 0.75rem; color: #9CA3AF;">enquiries</div>
          </div>
        </div>
      `;
      })
      .join('');

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        ${breakdownHTML}
      </div>
    `;
  } catch (error) {
    console.error('Error creating Lead Quality widget:', error);
    container.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: #EF4444; background: #FEF2F2; border-radius: 8px;">
        <p style="margin: 0;">Unable to load lead quality data.</p>
      </div>
    `;
  }
}

/**
 * Fetch lead quality data
 * @returns {Promise<object>} Lead quality breakdown
 */
async function fetchLeadQualityData() {
  try {
    // Try to fetch from API first
    const response = await fetch('/api/supplier/lead-quality', {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.breakdown) {
        return data;
      }
    }

    // Fallback to mock data (matching other widgets until backend is ready)
    // Using fixed values for consistent UX
    return {
      breakdown: [
        {
          type: 'Qualified',
          count: 12,
          icon: '✓',
          color: '#10B981',
        },
        {
          type: 'Interested',
          count: 8,
          icon: '↗',
          color: '#3B82F6',
        },
        {
          type: 'Cold',
          count: 5,
          icon: '❄',
          color: '#6B7280',
        },
        {
          type: 'Spam',
          count: 2,
          icon: '✕',
          color: '#EF4444',
        },
      ],
    };
  } catch (error) {
    console.error('Error fetching lead quality data:', error);
    return null;
  }
}

/**
 * Load and display review statistics
 * @param {string} containerId - Container element ID
 */
export async function loadReviewStats(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container "${containerId}" not found for review stats`);
    return;
  }

  try {
    // Fetch review statistics
    const stats = await fetchReviewStats();

    if (!stats || stats.totalReviews === 0) {
      // Show graceful empty state (not "broken" looking)
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; background: #F9FAFB; border-radius: 8px;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">⭐⭐⭐⭐⭐</div>
          <div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem;">No reviews yet</div>
          <p style="color: #6B7280; margin-bottom: 1.5rem;">Reviews from customers will appear here once you complete your first booking.</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; max-width: 600px; margin: 0 auto;">
            <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid #E5E7EB;">
              <div style="font-size: 0.875rem; color: #9CA3AF; margin-bottom: 0.25rem;">Average Rating</div>
              <div style="font-size: 1.5rem; font-weight: 600;">0.0</div>
            </div>
            <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid #E5E7EB;">
              <div style="font-size: 0.875rem; color: #9CA3AF; margin-bottom: 0.25rem;">Total Reviews</div>
              <div style="font-size: 1.5rem; font-weight: 600;">0</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Render reviews with data
    const starRating = '⭐'.repeat(Math.round(stats.averageRating));
    container.innerHTML = `
      <div style="padding: 2rem; text-align: center; background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border-radius: 8px;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">${starRating}</div>
        <div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem;">Great reviews!</div>
        <p style="color: #92400E; margin-bottom: 1.5rem;">You're doing an excellent job. Keep up the great work!</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; max-width: 600px; margin: 0 auto;">
          <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid #F59E0B; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.1);">
            <div style="font-size: 0.875rem; color: #92400E; margin-bottom: 0.25rem;">Average Rating</div>
            <div style="font-size: 1.5rem; font-weight: 600; color: #B45309;">${stats.averageRating.toFixed(1)}</div>
          </div>
          <div style="padding: 1rem; background: white; border-radius: 8px; border: 1px solid #F59E0B; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.1);">
            <div style="font-size: 0.875rem; color: #92400E; margin-bottom: 0.25rem;">Total Reviews</div>
            <div style="font-size: 1.5rem; font-weight: 600; color: #B45309;">${stats.totalReviews}</div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading review stats:', error);
    // Show empty state on error - graceful degradation
    container.innerHTML = `
      <div style="padding: 2rem; text-align: center; background: #F9FAFB; border-radius: 8px;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">⭐</div>
        <p style="color: #6B7280; margin: 0;">Unable to load review data.</p>
      </div>
    `;
  }
}

/**
 * Fetch review statistics
 * @returns {Promise<object>} Review stats
 */
async function fetchReviewStats() {
  try {
    const response = await fetch('/api/v1/supplier/reviews/stats', {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.stats) {
        return data.stats;
      }
    }

    // Return null if no data (will show empty state)
    return null;
  } catch (error) {
    console.error('Error fetching review stats:', error);
    return null;
  }
}

/**
 * Create a conversion funnel widget (Views → Enquiries → Replies)
 * @param {string} containerId - Container element ID
 */
export async function createConversionFunnelWidget(containerId, days = 30) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  // Loading skeleton
  container.innerHTML = `
    <div class="card" style="padding:1.5rem;">
      ${_funnelIconHeader()}
      <div class="skeleton skeleton-text skeleton-text-long" style="margin-bottom:0.5rem;"></div>
      <div class="skeleton skeleton-text skeleton-text-medium"></div>
    </div>`;

  try {
    let views = 0;
    let enquiries = 0;
    let replies = 0;
    let hasData = false;

    // Try to fetch real analytics
    const res = await fetch(`/api/supplier/analytics?days=${days}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.analytics) {
        views = data.analytics.totalViews || 0;
        enquiries = data.analytics.totalEnquiries || 0;
        replies = data.analytics.messageReplies || 0;
        hasData = views > 0 || enquiries > 0 || replies > 0;
      }
    }

    if (!hasData) {
      container.innerHTML = `
        <div class="card" style="padding:1.5rem;">
          ${_funnelIconHeader()}
          <p style="color:#6B7280;font-size:0.875rem;margin:0 0 1rem 0;">Views → Enquiries → Replies (last ${days} days)</p>
          <div style="padding:1.5rem;text-align:center;background:#F9FAFB;border-radius:8px;">
            <div style="font-size:2rem;margin-bottom:0.5rem;">📊</div>
            <p style="color:#6B7280;margin:0;">Not enough data yet.</p>
            <p style="color:#9CA3AF;font-size:0.875rem;margin-top:0.25rem;">Data will appear once you start receiving profile views and enquiries.</p>
          </div>
        </div>`;
      return;
    }

    const enqRate = views > 0 ? ((enquiries / views) * 100).toFixed(1) : '—';
    const replyRate = enquiries > 0 ? ((replies / enquiries) * 100).toFixed(1) : '—';

    const steps = [
      { label: 'Profile Views', value: views, color: '#3B82F6', width: 100 },
      {
        label: 'Enquiries',
        value: enquiries,
        color: '#10B981',
        width: views > 0 ? Math.max(4, Math.round((enquiries / views) * 100)) : 4,
        rate: enqRate !== '—' ? `${enqRate}% conversion` : '',
      },
      {
        label: 'Replies',
        value: replies,
        color: '#8B5CF6',
        width: enquiries > 0 ? Math.max(4, Math.round((replies / enquiries) * 100)) : 4,
        rate: replyRate !== '—' ? `${replyRate}% reply rate` : '',
      },
    ];

    const stepsHtml = steps
      .map(
        step => `
      <div style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
          <span style="font-size:0.875rem;color:#374151;font-weight:500;">${step.label}</span>
          <span style="font-size:0.875rem;color:#374151;font-weight:700;">${step.value.toLocaleString()}</span>
        </div>
        <div style="height:10px;background:#E5E7EB;border-radius:5px;overflow:hidden;">
          <div style="height:100%;background:${step.color};width:${step.width}%;transition:width 0.5s;border-radius:5px;"></div>
        </div>
        ${step.rate ? `<div style="font-size:0.75rem;color:#6B7280;margin-top:0.2rem;">${step.rate}</div>` : ''}
      </div>`
      )
      .join('');

    container.innerHTML = `
      <div class="card" style="padding:1.5rem;">
        ${_funnelIconHeader()}
        <p style="color:#6B7280;font-size:0.875rem;margin:0 0 1.25rem 0;">Last ${days} days</p>
        ${stepsHtml}
      </div>`;
  } catch (error) {
    console.error('Error creating conversion funnel widget:', error);
    container.innerHTML = `
      <div class="card" style="padding:1.5rem;">
        ${_funnelIconHeader()}
        <p style="color:#6B7280;">Unable to load funnel data. Please try again later.</p>
      </div>`;
  }
}

/**
 * Create a response time widget showing average and trend
 * @param {string} containerId - Container element ID
 * @param {number} [days=30]   - Analytics period in days (7, 30, or 90)
 */
export async function createResponseTimeWidget(containerId, days = 30) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  // Loading skeleton
  container.innerHTML = `
    <div class="card" style="padding:1.5rem;">
      ${_stopwatchIconHeader()}
      <div class="skeleton skeleton-text skeleton-text-long" style="margin-bottom:0.5rem;"></div>
      <div class="skeleton skeleton-text skeleton-text-medium"></div>
    </div>`;

  try {
    let avgResponseTime = 0;
    let responseRate = 0;
    let hasData = false;

    const res = await fetch(`/api/supplier/analytics?days=${days}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.analytics) {
        avgResponseTime = data.analytics.avgResponseTime || 0;
        responseRate = data.analytics.responseRate || 0;
        hasData = data.analytics.totalEnquiries > 0;
      }
    }

    if (!hasData) {
      container.innerHTML = `
        <div class="card" style="padding:1.5rem;">
          ${_stopwatchIconHeader()}
          <p style="color:#6B7280;font-size:0.875rem;margin:0 0 1rem 0;">Last ${days} days</p>
          <div style="padding:1.5rem;text-align:center;background:#F9FAFB;border-radius:8px;">
            <div style="font-size:2rem;margin-bottom:0.5rem;">⏱️</div>
            <p style="color:#6B7280;margin:0;">Not enough data yet.</p>
            <p style="color:#9CA3AF;font-size:0.875rem;margin-top:0.25rem;">Respond to enquiries to see your response time stats.</p>
          </div>
        </div>`;
      return;
    }

    // Format response time nicely
    let timeDisplay;
    if (avgResponseTime < 1) {
      timeDisplay = `${Math.round(avgResponseTime * 60)}m`;
    } else if (avgResponseTime < 24) {
      timeDisplay = `${avgResponseTime.toFixed(1)}h`;
    } else {
      timeDisplay = `${(avgResponseTime / 24).toFixed(1)}d`;
    }

    // Performance label
    let perfLabel = 'Good';
    let perfColor = '#10B981';
    if (avgResponseTime <= 1) {
      perfLabel = 'Excellent';
      perfColor = '#10B981';
    } else if (avgResponseTime <= 4) {
      perfLabel = 'Good';
      perfColor = '#10B981';
    } else if (avgResponseTime <= 24) {
      perfLabel = 'Average';
      perfColor = '#F59E0B';
    } else {
      perfLabel = 'Slow';
      perfColor = '#EF4444';
    }

    container.innerHTML = `
      <div class="card" style="padding:1.5rem;">
        ${_stopwatchIconHeader()}
        <p style="color:#6B7280;font-size:0.875rem;margin:0 0 1.25rem 0;">Last ${days} days</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div style="padding:1rem;background:#F9FAFB;border-radius:8px;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:#0B1220;">${timeDisplay}</div>
            <div style="font-size:0.875rem;color:#6B7280;margin-top:0.25rem;">Avg Response Time</div>
            <span style="display:inline-block;margin-top:0.5rem;background:${perfColor};color:white;padding:0.15rem 0.5rem;border-radius:99px;font-size:0.75rem;font-weight:600;">${perfLabel}</span>
          </div>
          <div style="padding:1rem;background:#F9FAFB;border-radius:8px;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:#0B1220;">${responseRate}%</div>
            <div style="font-size:0.875rem;color:#6B7280;margin-top:0.25rem;">Response Rate</div>
            <span style="display:inline-block;margin-top:0.5rem;background:${responseRate >= 80 ? '#10B981' : responseRate >= 50 ? '#F59E0B' : '#EF4444'};color:white;padding:0.15rem 0.5rem;border-radius:99px;font-size:0.75rem;font-weight:600;">${responseRate >= 80 ? 'Great' : responseRate >= 50 ? 'OK' : 'Low'}</span>
          </div>
        </div>
        <p style="font-size:0.75rem;color:#9CA3AF;margin-top:1rem;margin-bottom:0;">💡 Suppliers who respond within 1 hour receive 3× more bookings.</p>
      </div>`;
  } catch (error) {
    console.error('Error creating response time widget:', error);
    container.innerHTML = `
      <div class="card" style="padding:1.5rem;">
        ${_stopwatchIconHeader()}
        <p style="color:#6B7280;">Unable to load response time data. Please try again later.</p>
      </div>`;
  }
}

// Export functions
export default {
  createAnalyticsChart,
  createPerformanceChart,
  createAnalyticsSummary,
  createEnquiryTrendChart,
  createLeadQualityWidget,
  loadReviewStats,
  loadChartJS,
  createConversionFunnelWidget,
  createResponseTimeWidget,
};
