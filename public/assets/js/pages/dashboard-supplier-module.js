// Display subscription status on dashboard using MongoDB API
import {
  initializeFeatureAccess,
  displayPackageLimitNotice,
  enforcePackageLimit,
} from '/supplier/js/feature-access.js';

import { createStatsGrid } from '/assets/js/dashboard-widgets.js';
import {
  createPerformanceChart,
  createEnquiryTrendChart,
  loadReviewStats,
  createConversionFunnelWidget,
  createResponseTimeWidget,
} from '/assets/js/supplier-analytics-chart.js';
import { initCountUp } from '/assets/js/count-up-animation.js';

// Module-level variable to store chart instance for real-time updates
let analyticsChartInstance = null;
// Store WebSocket client instance for cleanup
let wsClientInstance = null;

// Initialize feature access control (non-blocking)
initializeFeatureAccess().catch(err => {
  console.error('Error initializing feature access:', err);
});

// Placeholder function for earnings feature (coming soon)
window.showEarningsComingSoon = function () {
  if (typeof Toast !== 'undefined') {
    Toast.info('Earnings dashboard coming soon! Track your revenue, payments, and invoices.');
  } else {
    alert('Earnings dashboard coming soon! Track your revenue, payments, and invoices.');
  }
};

// Insert a styled alert inside the hero content area
function showUrgentAlert(message, type = 'warning') {
  const heroContent = document.querySelector('#welcome-section .dashboard-hero__content');
  if (!heroContent) {
    return;
  }
  const existing = heroContent.querySelector('.sd-urgent-alert');
  if (existing) {
    existing.remove();
  }
  const alertEl = document.createElement('div');
  // Let CSS classes control all styling — no inline overrides
  alertEl.className = `sd-urgent-alert sd-urgent-alert--${type}`;
  alertEl.setAttribute('role', 'status');
  alertEl.setAttribute('aria-live', 'polite');
  alertEl.textContent = message;
  // Insert after the header section (before actions bar), using nextElementSibling
  // to skip whitespace text nodes
  const headerSection =
    heroContent.querySelector('.dashboard-hero__header') || heroContent.firstElementChild;
  if (headerSection) {
    const afterHeader = headerSection.nextElementSibling;
    if (afterHeader) {
      heroContent.insertBefore(alertEl, afterHeader);
    } else {
      heroContent.appendChild(alertEl);
    }
  } else {
    heroContent.appendChild(alertEl);
  }
}

/**
 * Update the hero welcome heading with a business/profile name.
 * @param {string} name - Business name to display
 */
function updateWelcomeHeading(name) {
  if (!name) {
    return;
  }
  const titleMain = document.querySelector('.dashboard-hero__title-main');
  const titleHighlight = document.querySelector('.dashboard-hero__title-highlight');
  if (titleMain) {
    titleMain.textContent = 'Welcome back,';
  }
  if (titleHighlight) {
    titleHighlight.textContent = name;
  }
}

// Initialize supplier dashboard widgets
async function initSupplierDashboardWidgets() {
  try {
    // Fetch real analytics from the supplier analytics API
    let analytics = null;
    let totalEnquiries = 0;
    let views7d = 0;
    let responseRate = 100;
    let avgResponseTime = 0;

    // Try the consolidated dashboard-summary endpoint first
    let summaryData = null;
    try {
      const summaryResponse = await fetch('/api/supplier/dashboard-summary?days=30', {
        credentials: 'include',
      });
      if (summaryResponse.ok) {
        summaryData = await summaryResponse.json();
      }
    } catch (err) {
      console.warn('Dashboard summary not available, falling back to individual API calls:', err);
    }

    if (summaryData) {
      analytics = summaryData.analytics || null;
      totalEnquiries = summaryData.analytics?.totalEnquiries || 0;
      views7d = summaryData.analytics?.totalViews || 0;
      responseRate = summaryData.analytics?.responseRate || 100;
      avgResponseTime = summaryData.analytics?.avgResponseTime || 0;
    } else {
      try {
        // Fetch analytics using the real tracking system
        const analyticsResponse = await fetch('/api/supplier/analytics?days=7', {
          credentials: 'include',
        });
        if (analyticsResponse.ok) {
          const analyticsData = await analyticsResponse.json();
          analytics = analyticsData.analytics;

          // Extract values from real analytics
          totalEnquiries = analytics.totalEnquiries || 0;
          views7d = analytics.totalViews || 0;
          responseRate = analytics.responseRate || 100;
          avgResponseTime = analytics.avgResponseTime || 0;
        } else {
          console.warn('Analytics API not available, fetching conversations for basic stats');
          // Fallback to basic conversation count
          const threadsResponse = await fetch('/api/v4/messenger/conversations', {
            credentials: 'include',
          });
          if (threadsResponse.ok) {
            const threadsData = await threadsResponse.json();
            totalEnquiries = (threadsData.conversations || []).length;
          }
        }
      } catch (err) {
        console.error('Error fetching analytics:', err);
      }
    }

    // Update hero quick-stat cards with real API data
    const quickStatEnquiries = document.getElementById('quick-stat-enquiries');
    if (quickStatEnquiries) {
      quickStatEnquiries.setAttribute('data-target', String(totalEnquiries));
      quickStatEnquiries.textContent = String(totalEnquiries);
    }

    // Update active packages stat card — fetch from /api/me/packages and count non-paused packages
    const quickStatPackages = document.getElementById('quick-stat-packages');
    if (quickStatPackages) {
      try {
        const pkgsResp = await fetch('/api/me/packages', { credentials: 'include' });
        if (pkgsResp.ok) {
          const pkgsData = await pkgsResp.json();
          const allPackages = pkgsData?.items ?? [];
          // Active = not paused
          const activeCount = allPackages.filter(p => !p.paused).length;
          quickStatPackages.setAttribute('data-target', String(activeCount));
          quickStatPackages.textContent = String(activeCount);
        }
      } catch (_err) {
        // Leave at 0 on failure — do not crash the dashboard
      }
    }

    // Update rating stat card from review summary
    const ratingEl = document.getElementById('quick-stat-rating');
    const starsEl = document.getElementById('quick-stat-stars');
    const avgRating = summaryData?.reviews?.averageRating;
    const totalReviews = summaryData?.reviews?.total || 0;
    if (ratingEl) {
      if (avgRating && avgRating > 0) {
        ratingEl.textContent = avgRating.toFixed(1);
        ratingEl.removeAttribute('aria-label');
        if (starsEl) {
          const fullStars = Math.round(avgRating);
          starsEl.innerHTML = `<span>${'★'.repeat(fullStars)}${'☆'.repeat(5 - fullStars)}</span>`;
        }
      } else {
        ratingEl.textContent = '—';
        ratingEl.setAttribute('aria-label', 'No ratings yet');
        if (starsEl && totalReviews === 0) {
          // Use CSS class instead of inline styles for the empty state text
          starsEl.innerHTML = '<span class="quick-stat-stars__empty">No reviews yet</span>';
        }
      }
    }

    // Update trend badge with real data; badge is hidden by default via .js-hidden class
    const enquiriesTrendWrapper = document.getElementById('enquiries-trend-badge');
    const enquiriesTrendSpan = enquiriesTrendWrapper?.querySelector('span');
    const enquiriesTrend = summaryData?.analytics?.enquiriesTrend;
    if (enquiriesTrendWrapper) {
      if (enquiriesTrend !== undefined && enquiriesTrend !== null && enquiriesTrend !== 0) {
        if (enquiriesTrend > 0) {
          if (enquiriesTrendSpan) {
            enquiriesTrendSpan.textContent = `+${enquiriesTrend}%`;
          }
          enquiriesTrendWrapper.classList.remove('dashboard-stat-card__trend--down');
          enquiriesTrendWrapper.classList.add('dashboard-stat-card__trend--up');
          enquiriesTrendWrapper.classList.remove('js-hidden');
        } else {
          if (enquiriesTrendSpan) {
            enquiriesTrendSpan.textContent = `${enquiriesTrend}%`;
          }
          enquiriesTrendWrapper.classList.remove('dashboard-stat-card__trend--up');
          enquiriesTrendWrapper.classList.add('dashboard-stat-card__trend--down');
          enquiriesTrendWrapper.classList.remove('js-hidden');
        }
      }
      // If trend is 0 or unavailable, badge stays hidden via .js-hidden
    }

    // Update welcome heading with business/profile name if available
    if (summaryData?.profile?.topProfileName) {
      updateWelcomeHeading(summaryData.profile.topProfileName);
    }

    // Update pro-tip text with context-aware tip based on data
    const proTipEl = document.getElementById('pro-tip-text');
    if (proTipEl && summaryData) {
      const healthScore = summaryData.profile?.healthScore || 0;
      const unread = summaryData.messages?.unread || 0;
      const totalReviewCount = summaryData.reviews?.total || 0;
      if (unread > 0) {
        proTipEl.textContent = `💬 You have ${unread} unread message${unread !== 1 ? 's' : ''} — reply within 24 hours to boost your ranking`;
      } else if (healthScore < 60) {
        proTipEl.textContent =
          '✨ Complete your profile to appear in more search results and attract more enquiries';
      } else if (totalReviewCount === 0) {
        proTipEl.textContent =
          '⭐ Ask your first customer for a review — social proof triples enquiry conversion';
      } else {
        proTipEl.textContent =
          '🚀 Fast responses within 2 hours increase booking rates by up to 40%';
      }
    }

    // Create statistics widgets with real data
    createStatsGrid(
      [
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
          value: views7d,
          label: 'Profile Views (7d)',
          format: 'number',
          color: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
          value: totalEnquiries,
          label: 'Total Enquiries',
          format: 'number',
          color: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>',
          value: responseRate,
          label: 'Response Rate',
          format: 'percent',
          color: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
          value: avgResponseTime,
          label: 'Avg Response Time',
          format: 'time',
          color: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
          pulse: true,
        },
      ],
      'supplier-stats-grid'
    );

    // Prepare chart data from analytics
    const labels = [];
    const viewsData = [];
    const enquiriesData = [];

    if (analytics && analytics.dailyData && analytics.dailyData.length > 0) {
      // Use real daily data from analytics
      analytics.dailyData.forEach(day => {
        labels.push(day.label);
        viewsData.push(day.views);
        enquiriesData.push(day.enquiries);
      });
    } else {
      // Fallback: generate placeholder data for 7 days
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        viewsData.push(0);
        enquiriesData.push(0);
      }
    }

    analyticsChartInstance = await createPerformanceChart(
      'supplier-performance-chart',
      viewsData,
      enquiriesData,
      labels
    );

    // Create enquiry trend chart
    await createEnquiryTrendChart('enquiry-trend-chart');

    // Initialize ROI analytics widgets (uses date-range selector)
    await createConversionFunnelWidget('supplier-conversion-funnel');
    await createResponseTimeWidget('supplier-response-time');

    // Wire date-range selector to refresh ROI widgets
    const roiDateRange = document.getElementById('roi-date-range');
    if (roiDateRange) {
      roiDateRange.addEventListener('change', async () => {
        const days = parseInt(roiDateRange.value, 10) || 30;
        await createConversionFunnelWidget('supplier-conversion-funnel', days);
        await createResponseTimeWidget('supplier-response-time', days);
      });
    }

    // Initialize Reviews & Ratings section
    await loadReviewStats('supplier-reviews-section');

    // Fetch supplier profiles to check completion
    let hasProfile = false;
    let hasPhotos = false;
    let hasBanner = false;
    let hasTagline = false;
    let hasHighlights = false;
    let hasSocialLinks = false;

    try {
      const suppliersResponse = await fetch('/api/me/suppliers', {
        credentials: 'include',
      });
      if (suppliersResponse.ok) {
        const suppliersData = await suppliersResponse.json();
        const suppliers = suppliersData.items || [];
        hasProfile = suppliers.length > 0;
        if (hasProfile && suppliers[0]) {
          const supplier = suppliers[0];
          hasPhotos = supplier.photosGallery && supplier.photosGallery.length >= 5;
          hasBanner = !!supplier.bannerUrl;
          hasTagline = !!supplier.tagline;
          hasHighlights = supplier.highlights && supplier.highlights.length >= 3;
          hasSocialLinks = supplier.socialLinks && Object.keys(supplier.socialLinks).length >= 2;

          // Initialize Profile Health Widget with supplier data
          if (window.ProfileHealthWidget) {
            window.ProfileHealthWidget.init('profile-completeness-widget', supplier);
          }
        }

        // The active-packages stat card is always populated via /api/me/packages
        // regardless of whether summaryData is available — no fallback update needed here.

        // Update welcome heading with business name from live profile if not set by summary
        if (!summaryData?.profile?.topProfileName && suppliers[0]?.name) {
          updateWelcomeHeading(suppliers[0].name);
        }
      }
    } catch (err) {
      console.error('Error fetching suppliers:', err);
    }

    // Fetch packages to check if at least one exists
    let hasPackage = false;

    try {
      const packagesResponse = await fetch('/api/me/packages', {
        credentials: 'include',
      });
      if (packagesResponse.ok) {
        const packagesData = await packagesResponse.json();
        const packages = packagesData.items || [];
        hasPackage = packages.length > 0;
      }
    } catch (err) {
      console.error('Error fetching packages:', err);
    }

    // Check email verification status
    let emailVerified = false;

    try {
      const userResponse = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        emailVerified = userData.user?.emailVerified || false;
      }
    } catch (err) {
      console.error('Error checking email verification:', err);
    }

    // Show the most important urgent alert based on summary data
    const healthScore = summaryData?.profile?.healthScore;
    const unreadMessages = summaryData?.messages?.unread || 0;
    if (healthScore !== undefined && healthScore < 40) {
      showUrgentAlert(
        '⚠️ Your profile health is low — complete your profile to attract more enquiries',
        'warning'
      );
    } else if (unreadMessages > 0) {
      showUrgentAlert(
        `💬 You have ${unreadMessages} unread message${unreadMessages !== 1 ? 's' : ''} waiting for a response`,
        'info'
      );
    }

    // Note: Profile Health Widget is now initialized when supplier data is fetched above
    // Old createProfileChecklist has been replaced with ProfileHealthWidget
  } catch (error) {
    console.error('Error initializing supplier dashboard widgets:', error);
  }
}

// Real-time notification handler for WebSocket updates
function handleRealtimeNotification(data) {
  try {
    if (data.type === 'enquiry_received') {
      const enquiriesDataset = analyticsChartInstance?.data?.datasets?.[1]; // datasets[1]

      if (typeof EventFlowNotifications !== 'undefined') {
        EventFlowNotifications.info('New enquiry received.');
      }

      const enquiriesElement = document.getElementById('quick-stat-enquiries');
      if (enquiriesElement) {
        const currentValue = parseInt(enquiriesElement.textContent) || 0;
        enquiriesElement.textContent = currentValue + 1;

        enquiriesElement.setAttribute('data-target', currentValue + 1);
      }

      if (
        analyticsChartInstance &&
        analyticsChartInstance.data &&
        analyticsChartInstance.data.datasets
      ) {
        // Get the enquiries dataset (index 1)
        // Use pre-resolved enquiries dataset reference
        if (enquiriesDataset && enquiriesDataset.data && enquiriesDataset.data.length > 0) {
          // Increment the last data point (today)
          const lastIndex = enquiriesDataset.data.length - 1;
          enquiriesDataset.data[lastIndex] = (enquiriesDataset.data[lastIndex] || 0) + 1;

          // Update the chart
          analyticsChartInstance.update();
        }
      }
    } else if (data.type === 'profile_view') {
      const viewsDataset = analyticsChartInstance?.data?.datasets?.[0]; // datasets[0]

      // Update the views counter in the stats grid
      // The stats grid is dynamically generated, so we need to find the element
      const statsNumbers = document.querySelectorAll('.stat-number');
      statsNumbers.forEach(element => {
        const label = element.nextElementSibling;
        // Check for Profile Views using data attribute or text content
        if (
          label &&
          label.textContent &&
          (label.textContent.includes('Profile Views') || label.textContent.includes('Views (7d)'))
        ) {
          const currentValue = parseInt(element.textContent) || 0;
          element.textContent = currentValue + 1;
          element.setAttribute('data-target', currentValue + 1);
        }
      });

      if (
        analyticsChartInstance &&
        analyticsChartInstance.data &&
        analyticsChartInstance.data.datasets
      ) {
        // Get the views dataset (index 0)
        // Use pre-resolved views dataset reference
        if (viewsDataset && viewsDataset.data && viewsDataset.data.length > 0) {
          // Increment the last data point (today)
          const lastIndex = viewsDataset.data.length - 1;
          viewsDataset.data[lastIndex] = (viewsDataset.data[lastIndex] || 0) + 1;

          // Update the chart
          analyticsChartInstance.update();
        }
      }
    }
  } catch (error) {
    console.error('Error handling real-time notification:', error);
  }
}

// Initialize WebSocket for real-time updates
window.addEventListener('load', () => {
  // Initialize WebSocketClient if available
  if (typeof WebSocketClient !== 'undefined') {
    try {
      wsClientInstance = new WebSocketClient({
        onConnect: () => console.log('🟢 Live Dashboard Connected'),
        onNotification: data => handleRealtimeNotification(data),
      });
    } catch (error) {
      console.error('Error initializing WebSocket client:', error);
    }
  }
});

// Cleanup WebSocket on page unload
window.addEventListener('beforeunload', () => {
  if (wsClientInstance && typeof wsClientInstance.disconnect === 'function') {
    wsClientInstance.disconnect();
  }
});

// Initialize widgets after page loads
window.addEventListener('load', () => {
  setTimeout(() => {
    initSupplierDashboardWidgets();
  }, 500);
});

// Expose init function for external callers
window.initSupplierDashboardWidgets = initSupplierDashboardWidgets;

async function displaySubscriptionStatus() {
  const container = document.getElementById('supplier-subscription-card');
  if (!container) {
    return;
  }

  try {
    // Load current user data (most reliable for tier)
    const authResponse = await fetch('/api/v1/auth/me', { credentials: 'include' });
    const authData = authResponse.ok ? await authResponse.json() : null;
    const user = authData?.user || null;
    const currentTier = user?.subscriptionTier || 'free';

    const TIER_LABELS = {
      pro: 'Pro',
      pro_plus: 'Pro Plus',
      free: 'Starter',
    };

    // Fetch subscription details from the dedicated subscription endpoint.
    // This endpoint reads from the subscriptions collection and includes
    // currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt.
    let subscriptionRecord = null;
    try {
      const subResponse = await fetch('/api/v2/subscriptions/me', { credentials: 'include' });
      if (subResponse.ok) {
        const subJson = await subResponse.json();
        subscriptionRecord = subJson.subscription || null;
      }
    } catch (_err) {
      // best-effort — subscriptionRecord stays null; billing details won't display
    }

    // Also load payment records for amount/currency info (best-effort)
    let paymentAmount = null;
    let paymentCurrency = 'gbp';
    try {
      const paymentsResponse = await fetch('/api/payments', { credentials: 'include' });
      if (paymentsResponse.ok) {
        const data = await paymentsResponse.json();
        const successfulPayments = (data.payments || []).filter(
          p => p.status === 'succeeded' && p.amount
        );
        successfulPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (successfulPayments.length > 0) {
          paymentAmount = successfulPayments[0].amount;
          paymentCurrency = successfulPayments[0].currency || 'gbp';
        }
      }
    } catch (_err) {
      // best-effort
    }

    if (currentTier !== 'free') {
      const planLabel = TIER_LABELS[currentTier] || currentTier;
      const cancelAtPeriodEnd = !!subscriptionRecord?.cancelAtPeriodEnd;
      const dateFormat = { day: 'numeric', month: 'long', year: 'numeric' };

      // Start date — use subscription createdAt (original sign-up date)
      const startRaw = subscriptionRecord?.createdAt || null;
      const startHtml = startRaw
        ? `<div class="sd-subscription-active__detail-row">
            <span class="sd-subscription-active__detail-label">Started</span>
            <span class="sd-subscription-active__detail-value">${new Date(startRaw).toLocaleDateString('en-GB', dateFormat)}</span>
           </div>`
        : '';

      // Period end / next billing date
      const endRaw = subscriptionRecord?.currentPeriodEnd || null;
      const endHtml = endRaw
        ? `<div class="sd-subscription-active__detail-row">
            <span class="sd-subscription-active__detail-label">Current period ends</span>
            <span class="sd-subscription-active__detail-value">${new Date(endRaw).toLocaleDateString('en-GB', dateFormat)}</span>
           </div>`
        : '';

      // Next payment amount (from most recent payment record)
      const amountHtml =
        paymentAmount && !cancelAtPeriodEnd
          ? `<div class="sd-subscription-active__detail-row">
              <span class="sd-subscription-active__detail-label">Next payment</span>
              <span class="sd-subscription-active__detail-value">${new Intl.NumberFormat('en-GB', { style: 'currency', currency: paymentCurrency.toUpperCase() }).format(paymentAmount / 100)}</span>
             </div>`
          : '';

      const detailsHtml =
        startHtml || endHtml || amountHtml
          ? `<div class="sd-subscription-active__details">${startHtml}${endHtml}${amountHtml}</div>`
          : '';

      // Auto-renew / cancellation notice
      let renewalNotice = '';
      if (endRaw) {
        const endDate = new Date(endRaw).toLocaleDateString('en-GB', dateFormat);
        if (cancelAtPeriodEnd) {
          renewalNotice = `<p class="sd-subscription-active__renewal-notice sd-subscription-active__renewal-notice--cancel">⚠ Cancels on ${endDate}</p>`;
        } else {
          renewalNotice = `<p class="sd-subscription-active__renewal-notice sd-subscription-active__renewal-notice--auto">↻ Auto-renews on ${endDate}</p>`;
        }
      }

      container.innerHTML = `
        <div class="sd-subscription-active">
          <div class="sd-subscription-active__plan-row">
            <span class="sd-subscription-active__badge sd-subscription-active__badge--${currentTier}">${planLabel}</span>
            <span class="sd-subscription-active__status">Active</span>
          </div>
          ${detailsHtml}
          ${renewalNotice}
          <a href="/supplier/subscription" class="sd-subscription-manage-btn">Manage subscription →</a>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="sd-subscription-free">
          <div class="sd-subscription-free__plan">
            <span class="sd-subscription-free__badge">Starter</span>
            <span class="sd-subscription-free__label">Free Plan</span>
          </div>
          <ul class="sd-subscription-limits">
            <li>✓ 1 supplier profile</li>
            <li>✓ 2 packages</li>
            <li>✓ Basic analytics</li>
            <li class="sd-subscription-limits__locked">🔒 Priority visibility</li>
            <li class="sd-subscription-limits__locked">🔒 Unlimited packages</li>
            <li class="sd-subscription-limits__locked">🔒 Advanced analytics</li>
          </ul>
          <a href="/pricing" class="sd-subscription-upgrade-btn">Upgrade to Pro →</a>
          <p class="sd-subscription-upgrade-reason">Pro suppliers get <strong>3x more enquiries</strong> on average</p>
        </div>
      `;
    }

    // Update package limit display
    await updatePackageLimitDisplay();
  } catch (error) {
    console.error('Error loading subscription status:', error);
    container.innerHTML = `
        <p class="small">Unable to load subscription status.</p>
        <a href="/supplier/subscription" class="btn btn-secondary subscription-action-btn">View Subscription</a>
      `;
  }
}

async function updatePackageLimitDisplay() {
  const limitContainer = document.getElementById('pkg-limit-note');
  if (!limitContainer) {
    return;
  }

  try {
    // Fetch package count from MongoDB API
    const packagesResponse = await fetch('/api/me/packages', { credentials: 'include' });
    if (packagesResponse.ok) {
      const packagesData = await packagesResponse.json();
      const packages = packagesData.items || [];

      // Hide limit notice if user has packages (implementation can be enhanced later)
      limitContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Error checking package limit:', error);
  }
}

// Display lead quality breakdown
async function displayLeadQualityBreakdown() {
  const container = document.getElementById('lead-quality-breakdown');
  if (!container) {
    return;
  }

  // Load badges CSS
  if (!document.getElementById('badges-css')) {
    const link = document.createElement('link');
    link.id = 'badges-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/badges.css';
    document.head.appendChild(link);
  }

  try {
    // Fetch conversations (v4) and supplier profile
    const [threadsResponse, supplierResponse] = await Promise.all([
      fetch('/api/v4/messenger/conversations', { credentials: 'include' }),
      fetch('/api/me/suppliers', { credentials: 'include' }),
    ]);

    if (!threadsResponse.ok) {
      throw new Error('Failed to fetch conversations');
    }
    const data = await threadsResponse.json();

    // Resolve current user ID for per-participant unread counts
    let currentUserId = null;
    try {
      const authRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (authRes.ok) {
        const authData = await authRes.json();
        currentUserId = authData?.user?.id || null;
      }
    } catch (_e) {
      /* ignore */
    }

    // Map v4 conversations to thread-like shape for calculateLeadQuality
    const threads = (data.conversations || []).map(conv => {
      let otherParticipant = null;
      let myParticipant = null;
      for (const p of conv.participants || []) {
        if (String(p.userId) === String(currentUserId)) {
          myParticipant = p;
        } else {
          otherParticipant = p;
        }
      }
      return {
        customerName: otherParticipant?.displayName || otherParticipant?.name || 'Unknown',
        lastMessage: conv.lastMessagePreview || conv.lastMessage?.content || 'No messages',
        status: conv.status || 'Open',
        unreadCount: myParticipant?.unreadCount || 0,
        createdAt: conv.createdAt,
      };
    });

    let supplierProfile = {};
    if (supplierResponse.ok) {
      const supplierData = await supplierResponse.json();
      supplierProfile = supplierData.items?.[0] || {};
    }

    if (threads.length === 0) {
      container.innerHTML = `
        <div class="sd-empty-state">
          <div class="sd-empty-state__icon">📊</div>
          <h4 class="sd-empty-state__title">No enquiries yet</h4>
          <p class="sd-empty-state__desc">Lead quality statistics appear once customers start contacting you. Complete your profile to attract more enquiries.</p>
          <a href="#profile-completeness-widget" class="sd-empty-state__cta">Improve your profile →</a>
        </div>
      `;
      return;
    }

    // Import lead quality helper (inline since we're in a script tag)
    const { calculateLeadQuality } = await import('/assets/js/utils/lead-quality-helper.js');

    // Calculate new quality scores
    const counts = { Hot: 0, High: 0, Good: 0, Low: 0 };
    let totalScore = 0;

    threads.forEach(thread => {
      const quality = calculateLeadQuality(thread, supplierProfile);
      counts[quality.label] = (counts[quality.label] || 0) + 1;
      totalScore += quality.score;
    });

    const total = threads.length;
    const hotPercent = Math.round((counts.Hot / total) * 100) || 0;
    const highPercent = Math.round((counts.High / total) * 100) || 0;
    const goodPercent = Math.round((counts.Good / total) * 100) || 0;
    const lowPercent = Math.round((counts.Low / total) * 100) || 0;
    const avgScore = Math.round(totalScore / total);

    container.innerHTML = `
        <div class="lead-quality-item">
          <div class="lead-quality-header">
            <span class="lead-quality-label">🔥 Hot (80+)</span>
            <span class="lead-quality-value">${counts.Hot} (${hotPercent}%)</span>
          </div>
          <div class="lead-quality-bar">
            <div class="lead-quality-fill lead-quality-fill--hot" style="width: ${hotPercent}%;"></div>
          </div>
        </div>
        
        <div class="lead-quality-item">
          <div class="lead-quality-header">
            <span class="lead-quality-label">⭐ High (60-79)</span>
            <span class="lead-quality-value">${counts.High} (${highPercent}%)</span>
          </div>
          <div class="lead-quality-bar">
            <div class="lead-quality-fill lead-quality-fill--high" style="width: ${highPercent}%;"></div>
          </div>
        </div>
        
        <div class="lead-quality-item">
          <div class="lead-quality-header">
            <span class="lead-quality-label">✓ Good (40-59)</span>
            <span class="lead-quality-value">${counts.Good} (${goodPercent}%)</span>
          </div>
          <div class="lead-quality-bar">
            <div class="lead-quality-fill lead-quality-fill--good" style="width: ${goodPercent}%;"></div>
          </div>
        </div>
        
        <div class="lead-quality-item">
          <div class="lead-quality-header">
            <span class="lead-quality-label">◯ Low (&lt;40)</span>
            <span class="lead-quality-value">${counts.Low} (${lowPercent}%)</span>
          </div>
          <div class="lead-quality-bar">
            <div class="lead-quality-fill lead-quality-fill--low" style="width: ${lowPercent}%;"></div>
          </div>
        </div>
        
        <div class="lead-quality-summary">
          <div class="lead-quality-summary-label">Average Lead Score</div>
          <div class="lead-quality-summary-value">${avgScore}/100</div>
        </div>
      `;
  } catch (error) {
    console.error('Error fetching lead quality breakdown:', error);
    container.innerHTML = '<p class="small text-error">Error loading lead quality statistics.</p>';
  }
}

displayLeadQualityBreakdown();

displaySubscriptionStatus();

// Welcome section dismiss logic (persisted in localStorage).
// Follows the same pattern as the customer dashboard (dashboard-customer-init.js).
const SUPPLIER_WELCOME_DISMISS_KEY = 'ef_supplier_welcome_dismissed';
(function applySupplierWelcomeDismissal() {
  const welcomeSection = document.getElementById('welcome-section');
  if (!welcomeSection) {
    return;
  }
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(SUPPLIER_WELCOME_DISMISS_KEY) === '1';
  } catch (_) {
    /* ignore storage errors */
  }
  if (dismissed) {
    welcomeSection.style.display = 'none';
  }
})();

// Earnings Overview CTA: scroll to packages section and open the form if collapsed
document.addEventListener('DOMContentLoaded', () => {
  const earningsCta = document.getElementById('earnings-create-pkg-cta');
  if (earningsCta) {
    earningsCta.addEventListener('click', e => {
      e.preventDefault();
      const packagesSection = document.getElementById('packages-section');
      if (packagesSection) {
        packagesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Open the package creation form if it is collapsed
      const toggleBtn = document.getElementById('toggle-package-form');
      const formSection = document.getElementById('package-form-section');
      if (toggleBtn && formSection) {
        const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        if (!isExpanded) {
          toggleBtn.click();
        }
      }
    });
  }
});
