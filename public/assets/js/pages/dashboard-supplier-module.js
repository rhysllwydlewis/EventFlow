// Display subscription status on dashboard using MongoDB API
import { initializeFeatureAccess } from '/supplier/js/feature-access.js';

import { createStatsGrid } from '/assets/js/dashboard-widgets.js';
import {
  createPerformanceChart,
  loadReviewStats,
  createConversionFunnelWidget,
  createResponseTimeWidget,
} from '/assets/js/supplier-analytics-chart.js';

// Module-level variable to store chart instance for real-time updates
let analyticsChartInstance = null;
// Store WebSocket client instance for cleanup
let wsClientInstance = null;
let hasConnectedOnce = false;
let lastDisconnectToastAt = 0;
const DISCONNECT_TOAST_THROTTLE_MS = 10 * 1000;
const DISCONNECT_TOAST_DELAY_MS = 3 * 1000;
let pendingDisconnectNoticeTimer = null;
let actionPromptChecklistPromise = null;

// Initialize feature access control (non-blocking)
initializeFeatureAccess().catch(err => {
  console.error('Error initializing feature access:', err);
});

// Placeholder function for earnings feature (coming soon)
window.showEarningsComingSoon = function () {
  if (typeof showToast === 'function') {
    showToast(
      'Earnings dashboard coming soon! Track your revenue, payments, and invoices.',
      'info'
    );
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
 * Show a persistent email-verification reminder banner at the top of the dashboard.
 * Includes a "Resend" link that fires the resend API and shows inline feedback.
 * @param {string} [userEmail] - The user's email address (avoids extra /me API call)
 */
function showEmailVerificationBanner(userEmail) {
  // Avoid duplicate banners
  if (document.getElementById('email-verify-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'email-verify-banner';
  banner.className = 'sd-email-verify-banner';
  banner.setAttribute('role', 'alert');

  const msg = document.createElement('span');
  msg.className = 'sd-email-verify-banner__msg';
  msg.textContent =
    '⚠️ Please verify your email address to unlock all features. Check your inbox for a verification link.';

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.className = 'sd-email-verify-banner__btn';
  resendBtn.textContent = 'Resend email';

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    try {
      let csrfToken = window.__CSRF_TOKEN__;
      if (!csrfToken) {
        const r = await fetch('/api/csrf-token', { credentials: 'include' });
        if (r.ok) {
          const d = await r.json();
          csrfToken = d.csrfToken || d.token || '';
          if (csrfToken) {
            window.__CSRF_TOKEN__ = csrfToken;
          }
        }
      }

      // Use provided email; fall back to a /me call only if not available
      let email = userEmail;
      if (!email) {
        const meData = window._efFetchOnceJSON
          ? await window._efFetchOnceJSON('/api/v1/auth/me', { credentials: 'include' })
          : await fetch('/api/v1/auth/me', { credentials: 'include' })
              .then(r => (r.ok ? r.json() : null))
              .catch(() => null);
        email = meData?.user?.email || '';
      }
      if (!email) {
        throw new Error('No email found');
      }

      const resp = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
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

  // Insert at the top of the page content, before the first section
  const firstSection =
    document.querySelector('.sd-section, .dashboard-hero, main > *:first-child') ||
    document.body.firstElementChild;
  if (firstSection && firstSection.parentNode) {
    firstSection.parentNode.insertBefore(banner, firstSection);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
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

/**
 * Select the most relevant hero tip message using live supplier state.
 * Prioritizes outstanding action-prompt items so the hero tip aligns with
 * the same "Next Steps" logic shown elsewhere in the dashboard.
 *
 * Unread messages are intentionally NOT surfaced here — showUrgentAlert()
 * already renders that exact notice above this tip when messages.unread > 0,
 * so repeating it here would tell the supplier the same thing twice in one card.
 *
 * @param {Object|null} summaryData - Dashboard summary payload
 * @param {Object|null} checklistData - /api/me/action-prompt-checklist payload
 * @returns {string}
 */
function getDynamicHeroTip(summaryData, checklistData) {
  const outstanding = Array.isArray(checklistData?.outstanding) ? checklistData.outstanding : [];
  const missingPackages = outstanding.find(action => action?.key === 'missingPackages');
  if (missingPackages) {
    return '📦 Add your first package to start receiving more relevant customer enquiries';
  }

  const incompleteProfile = outstanding.find(action => action?.key === 'incompleteProfile');
  if (incompleteProfile) {
    return '✨ Complete your profile to appear in more search results and attract more enquiries';
  }

  const missingPhotos = outstanding.find(action => action?.key === 'missingPhotos');
  if (missingPhotos) {
    return '📸 Add quality photos to increase profile views and improve trust with planners';
  }

  const totalReviewCount = summaryData?.reviews?.total || 0;
  if (totalReviewCount === 0) {
    return '⭐ Ask your first customer for a review — social proof triples enquiry conversion';
  }

  return '🚀 Fast responses within 2 hours increase booking rates by up to 40%';
}

/**
 * Load action-prompt checklist data once and share it between dashboard widgets
 * (hero tip + next steps card) to avoid duplicate network requests.
 *
 * @returns {Promise<Object|null>}
 */
function loadActionPromptChecklist() {
  if (!actionPromptChecklistPromise) {
    actionPromptChecklistPromise = fetch('/api/me/action-prompt-checklist', {
      credentials: 'include',
    })
      .then(response => {
        if (!response.ok) {
          return null;
        }
        return response.json();
      })
      .catch(() => null);
  }
  return actionPromptChecklistPromise;
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

    // Update active packages stat card. This reads the same dashboard-summary payload
    // the KPI grid renders from, rather than counting /api/me/packages separately —
    // the two used to apply different definitions of "active" and disagreed on screen.
    const quickStatPackages = document.getElementById('quick-stat-packages');
    if (quickStatPackages) {
      const activeCount = summaryData?.packages?.active ?? 0;
      quickStatPackages.setAttribute('data-target', String(activeCount));
      quickStatPackages.textContent = String(activeCount);
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

    // Load checklist actions (same source as Next Steps card) to make hero tip actionable.
    const checklistData = await loadActionPromptChecklist();

    // Update pro-tip text with context-aware tip based on live data
    const proTipEl = document.getElementById('pro-tip-text');
    if (proTipEl) {
      proTipEl.textContent = getDynamicHeroTip(summaryData, checklistData);
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
          dataColor: 'blue',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
          // Both totalEnquiries and totalViews come from the same summary query (same period),
          // so the ratio is a valid same-window conversion rate.
          value: views7d > 0 ? Math.round((totalEnquiries / views7d) * 100) : 0,
          label: 'Enquiry Rate',
          format: 'percent',
          color: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
          dataColor: 'green',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>',
          value: responseRate,
          label: 'Response Rate',
          format: 'percent',
          color: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
          dataColor: 'amber',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
          value: avgResponseTime,
          label: 'Avg Response Time',
          format: 'time',
          color: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
          dataColor: 'purple',
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
    // supplier-reviews-init.js exposes window.SupplierReviews.init().
    // supplierId comes from summaryData.profile.topProfileId which the
    // dashboard-summary endpoint always returns for authenticated suppliers.
    const _reviewSupplierId = summaryData?.profile?.topProfileId || null;
    if (_reviewSupplierId && window.SupplierReviews?.init) {
      await window.SupplierReviews.init(_reviewSupplierId, 'supplier-reviews-section');
    } else {
      // Fallback: legacy stats-only view if new script hasn't loaded or the supplier ID is unavailable.
      console.warn(
        '[supplier-dashboard] Review management panel unavailable; loading legacy review stats fallback.',
        {
          hasSupplierId: Boolean(_reviewSupplierId),
          hasReviewModule: Boolean(window.SupplierReviews?.init),
        }
      );
      await loadReviewStats('supplier-reviews-section');
    }

    // Fetch supplier profiles to check completion
    let hasProfile = false;

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

    // Check email verification status
    let emailVerified = false;
    let userEmail = '';

    try {
      const userData = window._efFetchOnceJSON
        ? await window._efFetchOnceJSON('/api/v1/auth/me', { credentials: 'include' })
        : await fetch('/api/v1/auth/me', { credentials: 'include' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
      if (userData) {
        emailVerified = userData.user?.emailVerified || userData.user?.verified || false;
        userEmail = userData.user?.email || '';
      }
    } catch (err) {
      console.error('Error checking email verification:', err);
    }

    // Show email verification banner if user is not yet verified
    if (!emailVerified) {
      showEmailVerificationBanner(userEmail);
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

      if (typeof NotificationDispatcher !== 'undefined') {
        NotificationDispatcher.info('New enquiry received.');
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
        onConnect: ({ isReconnect } = {}) => {
          if (pendingDisconnectNoticeTimer) {
            clearTimeout(pendingDisconnectNoticeTimer);
            pendingDisconnectNoticeTimer = null;
          }
          if (typeof NotificationDispatcher !== 'undefined') {
            NotificationDispatcher.success(
              isReconnect || hasConnectedOnce
                ? 'Live Dashboard Reconnected'
                : 'Live Dashboard Connected',
              2000
            );
          }
          hasConnectedOnce = true;
        },
        // eslint-disable-next-line no-unused-vars -- signature locked by tests/integration/dashboard-websocket-integration.test.js source-match assertion
        onDisconnect: reason => {
          const now = Date.now();
          if (now - lastDisconnectToastAt < DISCONNECT_TOAST_THROTTLE_MS) {
            return;
          }
          if (pendingDisconnectNoticeTimer) {
            clearTimeout(pendingDisconnectNoticeTimer);
          }
          pendingDisconnectNoticeTimer = setTimeout(() => {
            lastDisconnectToastAt = Date.now();
            if (typeof NotificationDispatcher !== 'undefined') {
              NotificationDispatcher.warning('Live dashboard disconnected\nretrying...', 4000);
            }
            showUrgentAlert('Live updates disconnected. retrying...', 'warning');
            pendingDisconnectNoticeTimer = null;
          }, DISCONNECT_TOAST_DELAY_MS);
        },
        onNotification: data => handleRealtimeNotification(data),
      });
    } catch (error) {
      console.error('Error initializing WebSocket client:', error);
    }
  }
});

// Cleanup WebSocket on page unload
window.addEventListener('beforeunload', () => {
  if (pendingDisconnectNoticeTimer) {
    clearTimeout(pendingDisconnectNoticeTimer);
    pendingDisconnectNoticeTimer = null;
  }
  if (wsClientInstance && typeof wsClientInstance.disconnect === 'function') {
    wsClientInstance.disconnect();
  }
});

// Initialize widgets after page loads
// The 500ms delay has been removed — ES modules defer by default, so the DOM
// is guaranteed ready by the time this module evaluates.
if (document.readyState === 'complete') {
  initSupplierDashboardWidgets();
} else {
  window.addEventListener('load', initSupplierDashboardWidgets, { once: true });
}

// Expose init function for external callers
window.initSupplierDashboardWidgets = initSupplierDashboardWidgets;

async function displaySubscriptionStatus() {
  const container = document.getElementById('supplier-subscription-card');
  if (!container) {
    return;
  }

  try {
    // Load current user data (most reliable for tier)
    const authData = window._efFetchOnceJSON
      ? await window._efFetchOnceJSON('/api/v1/auth/me', { credentials: 'include' })
      : await fetch('/api/v1/auth/me', { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null);
    const user = authData?.user || null;
    const currentTier = user?.subscriptionTier || 'free';

    const TIER_LABELS = {
      pro: 'Pro',
      pro_plus: 'Pro Plus',
      free: 'Starter',
    };

    // Fetch subscription details from the dedicated subscription endpoint.
    // This endpoint reads from the subscriptions collection and includes
    // currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt,
    // billingInterval, discountName, discountPercent, and payment method info.
    let subscriptionRecord = null;
    let paymentMethodBrand = null;
    let paymentMethodLast4 = null;
    try {
      // Use the shared dedup helper (window._efFetchOnceJSON defined in app.js) so
      // this call and the concurrent loadSuppliers() fallback in app.js share a single
      // network request — and therefore trigger only one Stripe customer retrieve.
      const subJson = window._efFetchOnceJSON
        ? await window._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' })
        : await fetch('/api/v2/subscriptions/me', { credentials: 'include' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
      if (subJson) {
        subscriptionRecord = subJson.subscription || null;
        paymentMethodBrand = subJson.paymentMethodBrand || null;
        paymentMethodLast4 = subJson.paymentMethodLast4 || null;
      }
    } catch {
      // best-effort — subscriptionRecord stays null; billing details won't display
    }

    // Load upcoming invoice amount/currency info (best-effort).
    // Only fetch when the subscription record has a Stripe subscription ID —
    // without it the server would return null anyway, so we save the round-trip.
    let paymentAmount = null;
    let paymentCurrency = 'gbp';
    if (subscriptionRecord?.stripeSubscriptionId) {
      try {
        const upcomingResponse = await fetch('/api/v2/subscriptions/upcoming-invoice', {
          credentials: 'include',
        });
        if (upcomingResponse.ok) {
          const data = await upcomingResponse.json();
          if (data.upcomingInvoice) {
            paymentAmount = data.upcomingInvoice.amount;
            paymentCurrency = data.upcomingInvoice.currency || 'gbp';
          }
        }
      } catch {
        // best-effort
      }
    }

    // A failed payment drops entitlement (and therefore user.subscriptionTier)
    // to 'free' immediately — see webhooks/stripeWebhookHandler.js
    // handleInvoicePaymentFailed. Without this check that state renders
    // identically to "never subscribed", with no indication the supplier
    // lost access because a card was declined rather than by choice.
    if (subscriptionRecord?.status === 'past_due') {
      const pastDuePlanLabel =
        TIER_LABELS[subscriptionRecord.plan] || subscriptionRecord.plan || 'your plan';
      container.innerHTML = `
        <div class="sd-subscription-past-due">
          <div class="sd-subscription-past-due__plan-row">
            <span class="sd-subscription-past-due__badge">⚠️ Payment failed</span>
          </div>
          <p class="sd-subscription-past-due__message">Your last payment for <strong>${pastDuePlanLabel}</strong> didn't go through, so premium features are paused. Update your payment method to restore them — we'll also retry the charge automatically.</p>
          <div class="sd-subscription-manage-row">
            <button type="button" id="sd-subscription-billing-btn-past-due" class="sd-subscription-manage-btn sd-subscription-manage-btn--billing">Update payment method</button>
            <a href="/supplier/subscription" class="sd-subscription-manage-btn">View subscription →</a>
          </div>
        </div>
      `;
      document
        .getElementById('sd-subscription-billing-btn-past-due')
        ?.addEventListener('click', handleManageBillingClick);
      await updatePackageLimitDisplay();
      return;
    }

    if (currentTier !== 'free') {
      const planLabel = TIER_LABELS[currentTier] || currentTier;
      const cancelAtPeriodEnd = !!subscriptionRecord?.cancelAtPeriodEnd;
      const dateFormat = { day: 'numeric', month: 'long', year: 'numeric' };
      const isTrialing = subscriptionRecord?.status === 'trialing';

      // Status label
      const statusLabel = isTrialing ? 'Trial' : 'Active';

      // Billing interval badge (Monthly / Annual)
      const interval = subscriptionRecord?.billingInterval || null;
      const intervalLabel =
        interval === 'year' ? 'Annual' : interval === 'month' ? 'Monthly' : null;
      const intervalBadge = intervalLabel
        ? `<span class="sd-subscription-active__interval">${intervalLabel}</span>`
        : '';

      // Trial info — show when trialing
      let trialHtml = '';
      if (isTrialing && subscriptionRecord?.trialEnd) {
        const trialEndDate = new Date(subscriptionRecord.trialEnd);
        const daysLeft = Math.ceil((trialEndDate - Date.now()) / (1000 * 60 * 60 * 24));
        const trialEndFormatted = trialEndDate.toLocaleDateString('en-GB', dateFormat);
        let trialDaysNotice = '';
        if (daysLeft > 0) {
          trialDaysNotice = `<p class="sd-subscription-active__trial-notice">🎁 ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining in trial</p>`;
        } else if (daysLeft === 0) {
          trialDaysNotice = `<p class="sd-subscription-active__trial-notice">🎁 Trial ends today</p>`;
        }
        trialHtml = `
          <div class="sd-subscription-active__detail-row">
            <span class="sd-subscription-active__detail-label">Trial ends</span>
            <span class="sd-subscription-active__detail-value">${trialEndFormatted}</span>
          </div>
          ${trialDaysNotice}`;
      }

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

      // Next payment amount (from most recent payment record). A downgrade to
      // a lower PAID plan still bills going forward (just at the new price),
      // so only a true end-of-billing (no pendingPlan, or pendingPlan free)
      // should hide this row — not every cancelAtPeriodEnd flag.
      const pendingPlan = subscriptionRecord?.pendingPlan;
      const billingEnds = cancelAtPeriodEnd && (!pendingPlan || pendingPlan === 'free');
      const amountHtml =
        paymentAmount && !billingEnds
          ? `<div class="sd-subscription-active__detail-row">
              <span class="sd-subscription-active__detail-label">Next payment</span>
              <span class="sd-subscription-active__detail-value">${new Intl.NumberFormat('en-GB', { style: 'currency', currency: paymentCurrency.toUpperCase() }).format(paymentAmount / 100)}</span>
             </div>`
          : '';

      // Payment method — map brand codes to display names
      const CARD_BRAND_LABELS = {
        visa: 'Visa',
        mastercard: 'Mastercard',
        amex: 'Amex',
        discover: 'Discover',
        diners: 'Diners',
        jcb: 'JCB',
        unionpay: 'UnionPay',
      };
      const paymentMethodHtml =
        paymentMethodBrand && paymentMethodLast4
          ? `<div class="sd-subscription-active__detail-row">
              <span class="sd-subscription-active__detail-label">Payment method</span>
              <span class="sd-subscription-active__detail-value">💳 ${CARD_BRAND_LABELS[paymentMethodBrand.toLowerCase()] || paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)} ····${paymentMethodLast4}</span>
             </div>`
          : '';

      // Discount
      const discountHtml = subscriptionRecord?.discountName
        ? `<div class="sd-subscription-active__detail-row">
              <span class="sd-subscription-active__detail-label">Discount</span>
              <span class="sd-subscription-active__detail-value">${subscriptionRecord.discountPercent ? `${subscriptionRecord.discountPercent}% off` : 'Applied'} (${subscriptionRecord.discountName})</span>
             </div>`
        : '';

      const detailsHtml =
        trialHtml || startHtml || endHtml || amountHtml || paymentMethodHtml || discountHtml
          ? `<div class="sd-subscription-active__details">${trialHtml}${startHtml}${endHtml}${amountHtml}${paymentMethodHtml}${discountHtml}</div>`
          : '';

      // Auto-renew / cancellation notice
      let renewalNotice = '';
      if (endRaw) {
        const endDate = new Date(endRaw).toLocaleDateString('en-GB', dateFormat);
        if (cancelAtPeriodEnd && pendingPlan) {
          const pendingPlanLabel = TIER_LABELS[pendingPlan] || pendingPlan;
          renewalNotice = `<p class="sd-subscription-active__renewal-notice sd-subscription-active__renewal-notice--cancel">📋 Downgrades to ${pendingPlanLabel} on ${endDate}</p>`;
        } else if (cancelAtPeriodEnd) {
          renewalNotice = `<p class="sd-subscription-active__renewal-notice sd-subscription-active__renewal-notice--cancel">⚠️ Cancels on ${endDate}</p>`;
        } else {
          renewalNotice = `<p class="sd-subscription-active__renewal-notice sd-subscription-active__renewal-notice--auto">↻ Auto-renews on ${endDate}</p>`;
        }
      }

      container.innerHTML = `
        <div class="sd-subscription-active">
          <div class="sd-subscription-active__plan-row">
            <span class="sd-subscription-active__badge sd-subscription-active__badge--${currentTier}">${planLabel}</span>
            <span class="sd-subscription-active__status${isTrialing ? ' sd-subscription-active__status--trial' : ''}">${statusLabel}</span>
            ${intervalBadge}
          </div>
          ${detailsHtml}
          ${renewalNotice}
          <div class="sd-subscription-manage-row">
            <a href="/supplier/subscription" class="sd-subscription-manage-btn">Manage subscription →</a>
            <button type="button" id="sd-subscription-billing-btn" class="sd-subscription-manage-btn sd-subscription-manage-btn--billing">Manage billing</button>
          </div>
        </div>
      `;
      document
        .getElementById('sd-subscription-billing-btn')
        ?.addEventListener('click', handleManageBillingClick);
    } else {
      container.innerHTML = `
        <div class="sd-subscription-free">
          <div class="sd-subscription-free__plan">
            <span class="sd-subscription-free__badge">Starter</span>
            <span class="sd-subscription-free__label">Free Plan</span>
          </div>
          <ul class="sd-subscription-limits">
            <li>✓ 1 supplier profile</li>
            <li>✓ 3 packages</li>
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

/**
 * Open the Stripe billing portal directly from the dashboard card — lets a
 * supplier update their payment method, view invoices, or cancel without
 * leaving the dashboard for the full plans page.
 * @param {MouseEvent} event
 */
async function handleManageBillingClick(event) {
  const button = event.currentTarget;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Loading…';

  try {
    let csrfToken = window.__CSRF_TOKEN__ || '';
    if (!csrfToken) {
      const csrfResp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (csrfResp.ok) {
        const csrfData = await csrfResp.json();
        csrfToken = csrfData.csrfToken || csrfData.token || '';
        window.__CSRF_TOKEN__ = csrfToken;
      }
    }

    const response = await fetch('/api/payments/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify({ returnUrl: window.location.href }),
    });
    const data = await response.json();
    if (!response.ok || !data.url) {
      throw new Error(data.error || 'Failed to open billing portal');
    }
    window.location.href = data.url;
  } catch (error) {
    console.error('Error opening billing portal:', error);
    const message = error.message || 'Failed to open billing portal. Please try again.';
    if (typeof showToast === 'function') {
      showToast(message, 'error');
    } else {
      alert(message);
    }
    button.disabled = false;
    button.textContent = originalText;
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
      // Hide limit notice if user has packages (implementation can be enhanced later)
      limitContainer.classList.add('sd-hidden');
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
      const authData = window._efFetchOnceJSON
        ? await window._efFetchOnceJSON('/api/v1/auth/me', { credentials: 'include' })
        : await fetch('/api/v1/auth/me', { credentials: 'include' })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null);
      currentUserId = authData?.user?.id || null;
    } catch {
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
        otherPartyDisplayName: otherParticipant?.displayName || otherParticipant?.name || 'Unknown',
        otherPartyAvatar: otherParticipant?.avatar || null,
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

// --- Welcome overlay dismiss logic ---
// Manages permanent dismissal of the first-login onboarding overlay only.
// The hero section (#welcome-section) is permanently visible; only the overlay
// (#ef-onboarding-box) is removed when the supplier acknowledges the welcome.
// localStorage keys are set to prevent the overlay from reappearing.
(function initWelcomeOverlayDismiss() {
  const DISMISS_KEY = 'ef_supplier_welcome_dismissed';
  const PROFILE_HINT_KEY = 'ef_supplier_profile_hint_seen';

  function nudgeProfileManagement() {
    try {
      if (localStorage.getItem(PROFILE_HINT_KEY) === '1') {
        return;
      }
    } catch {
      /* Ignore localStorage errors */
    }

    const profileToggle = document.getElementById('toggle-profile-form');
    const profileCard = profileToggle ? profileToggle.closest('.sd-card') : null;
    const sectionDivider =
      profileCard && profileCard.previousElementSibling?.classList.contains('sd-section-divider')
        ? profileCard.previousElementSibling
        : document.querySelector('.sd-section-divider');

    if (!sectionDivider || !profileToggle) {
      return;
    }

    const scrollTarget = profileCard || sectionDivider;
    const headerOffset = 96;
    const absoluteTop = window.scrollY + scrollTarget.getBoundingClientRect().top - headerOffset;
    window.scrollTo({
      top: Math.max(absoluteTop, 0),
      behavior: 'smooth',
    });
    sectionDivider.classList.add('ef-profile-onboarding-hint');
    profileToggle.classList.add('ef-profile-onboarding-cta');
    profileToggle.setAttribute('aria-describedby', 'ef-profile-onboarding-breadcrumb');

    let breadcrumb = document.getElementById('ef-profile-onboarding-breadcrumb');
    if (!breadcrumb) {
      breadcrumb = document.createElement('p');
      breadcrumb.id = 'ef-profile-onboarding-breadcrumb';
      breadcrumb.className = 'ef-profile-onboarding-breadcrumb';
      breadcrumb.setAttribute('role', 'status');
      breadcrumb.setAttribute('aria-live', 'polite');
      breadcrumb.textContent =
        'Next step: expand “Your Supplier Profile” to start building your listing.';
      sectionDivider.insertAdjacentElement('afterend', breadcrumb);
    } else {
      breadcrumb.classList.remove('is-visible');
    }

    requestAnimationFrame(() => breadcrumb.classList.add('is-visible'));

    const clearNudgeState = () => {
      sectionDivider.classList.remove('ef-profile-onboarding-hint');
      profileToggle.classList.remove('ef-profile-onboarding-cta');
      profileToggle.removeAttribute('aria-describedby');
      profileToggle.removeEventListener('click', clearNudgeState);
    };

    profileToggle.addEventListener('click', clearNudgeState, { once: true });

    window.setTimeout(() => {
      clearNudgeState();
    }, 5200);

    try {
      localStorage.setItem(PROFILE_HINT_KEY, '1');
    } catch {
      /* Ignore localStorage errors */
    }
  }

  function dismissWelcomeOverlay() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
      localStorage.setItem('ef_onboarding_dismissed', '1');
    } catch {
      /* Ignore localStorage errors */
    }

    // Remove the onboarding overlay card if it is still visible
    const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
    const overlay = document.getElementById('ef-onboarding-box');
    if (overlay) {
      overlay.style.transition = `opacity 0.3s ${easing}`;
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
      // Wait until the overlay is removed before scrolling, otherwise
      // removing the card shifts the viewport and can overshoot sections.
      setTimeout(() => nudgeProfileManagement(), 320);
      return;
    }
    nudgeProfileManagement();
  }

  // Export so that the onboarding overlay card in app.js can call this too
  window.dismissSupplierWelcome = dismissWelcomeOverlay;
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

// ── Next Steps / Action Checklist ─────────────────────────────────────────
// Loads outstanding action items from the server (same logic as action-prompt emails)
// and renders a clear card with severity badges and direct CTA links.
(function () {
  const DISMISS_KEY = 'ef_next_steps_dismissed_v1';

  function isDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  function severityStyle(severity) {
    // Returns only the label — colour styling is now handled by CSS classes
    // (.sd-next-steps__item--red / --amber, .sd-next-steps__badge--red / --amber)
    return {
      label: severity === 'red' ? 'Required' : 'Recommended',
    };
  }

  function renderNextSteps(data) {
    const card = document.getElementById('next-steps-card');
    const list = document.getElementById('next-steps-list');
    if (!card || !list) {
      return;
    }

    if (!data || data.outstanding.length === 0) {
      card.style.display = 'none';
      return;
    }

    if (isDismissed()) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';

    const items = data.outstanding
      .map(action => {
        const s = severityStyle(action.severity);
        const ctaHtml = action.ctaUrl
          ? `<a href="${action.ctaUrl}" class="sd-next-steps__cta">${action.ctaText || 'Fix now'}</a>`
          : '';
        return `<div class="sd-next-steps__item sd-next-steps__item--${action.severity || 'amber'}">
        <div class="sd-next-steps__badge-col">
          <span class="sd-next-steps__badge sd-next-steps__badge--${action.severity || 'amber'}">${s.label}</span>
        </div>
        <div class="sd-next-steps__content">
          <div class="sd-next-steps__title">${action.title || action.key}</div>
          <div class="sd-next-steps__desc">${action.description || ''}</div>
          ${ctaHtml}
        </div>
      </div>`;
      })
      .join('');

    const dismissHtml = `<div class="sd-next-steps__dismiss-row">
      <button type="button" id="nextStepsDismissBtn" class="sd-next-steps__dismiss-btn">Dismiss for now</button>
    </div>`;

    list.innerHTML = items + dismissHtml;

    document.getElementById('nextStepsDismissBtn')?.addEventListener('click', () => {
      try {
        localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* */
      }
      card.style.display = 'none';
    });
  }

  async function loadNextSteps() {
    try {
      const data = await loadActionPromptChecklist();
      if (!data) {
        return;
      }
      renderNextSteps(data);
    } catch {
      // Non-critical — silently skip if endpoint is unavailable
    }
  }

  // Load after a short delay so higher-priority widgets load first
  window.addEventListener('load', () => {
    setTimeout(loadNextSteps, 800);
  });
})();
