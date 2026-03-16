// Display subscription status on dashboard using MongoDB API
import {
  initializeFeatureAccess,
  displayPackageLimitNotice,
  enforcePackageLimit,
} from '/supplier/js/feature-access.js';

import { createStatsGrid, createProfileChecklist } from '/assets/js/dashboard-widgets.js';
import {
  createPerformanceChart,
  createAnalyticsSummary,
  createEnquiryTrendChart,
  createLeadQualityWidget,
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

// Initialize supplier dashboard widgets
async function initSupplierDashboardWidgets() {
  try {
    // Fetch real analytics from the supplier analytics API
    let analytics = null;
    let totalEnquiries = 0;
    let views7d = 0;
    let responseRate = 100;
    let avgResponseTime = 0;

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

    // Update hero quick-stat cards with real API data
    const quickStatEnquiries = document.getElementById('quick-stat-enquiries');
    if (quickStatEnquiries) {
      quickStatEnquiries.setAttribute('data-target', String(totalEnquiries));
      quickStatEnquiries.textContent = String(totalEnquiries);
    }

    // Create statistics widgets with real data
    createStatsGrid(
      [
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
          value: views7d,
          label: 'Profile Views (7d)',
          format: 'number',
          color: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
          value: totalEnquiries,
          label: 'Total Enquiries',
          format: 'number',
          color: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
          value: responseRate,
          label: 'Response Rate',
          format: 'percent',
          color: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
        },
        {
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
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

    // Initialize Lead Quality widget
    await createLeadQualityWidget('lead-quality-breakdown');

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
      pro: 'Professional',
      pro_plus: 'Professional Plus',
      free: 'Starter (Free)',
    };
    const TIER_BADGES = {
      pro: '<span style="display:inline-block;background:#7c3aed;color:#fff;font-size:0.7rem;font-weight:700;letter-spacing:0.05em;padding:0.2em 0.6em;border-radius:999px;margin-left:0.5rem;">PRO</span>',
      pro_plus:
        '<span style="display:inline-block;background:#d97706;color:#fff;font-size:0.7rem;font-weight:700;letter-spacing:0.05em;padding:0.2em 0.6em;border-radius:999px;margin-left:0.5rem;">PRO+</span>',
      free: '',
    };

    // Also load payment record for billing details
    const paymentsResponse = await fetch('/api/payments', { credentials: 'include' });
    let activeSubscription = null;
    if (paymentsResponse.ok) {
      const data = await paymentsResponse.json();
      activeSubscription = (data.payments || []).find(
        p =>
          p.type === 'subscription' &&
          p.status === 'succeeded' &&
          p.subscriptionDetails &&
          !p.subscriptionDetails.cancelAtPeriodEnd
      );
    }

    if (currentTier !== 'free') {
      const planLabel = TIER_LABELS[currentTier] || currentTier;
      const badge = TIER_BADGES[currentTier] || '';
      let billingHtml = '';
      if (activeSubscription?.subscriptionDetails?.currentPeriodEnd) {
        const endDate = new Date(activeSubscription.subscriptionDetails.currentPeriodEnd);
        billingHtml = `<p class="small"><strong>Renews:</strong> ${endDate.toLocaleDateString('en-GB')}</p>`;
      }

      container.innerHTML = `
            <p class="small"><strong>Active Plan:</strong> ${planLabel}${badge}</p>
            ${billingHtml}
            <p class="small"><strong>Status:</strong> <span class="subscription-status-active">✓ Active</span></p>
            <a href="/supplier/subscription" class="btn btn-secondary subscription-action-btn">Manage Subscription</a>
          `;
    } else {
      container.innerHTML = `
            <p class="small">You're currently on the <strong>Starter (Free) Plan</strong></p>
            <p class="small">Upgrade to Pro or Professional Plus to unlock premium features and boost your visibility!</p>
            <a href="/pricing" class="btn btn-primary subscription-action-btn">View Upgrade Options</a>
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
      container.innerHTML =
        '<p class="small">No enquiries yet. Lead quality statistics will appear here when customers contact you.</p>';
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
