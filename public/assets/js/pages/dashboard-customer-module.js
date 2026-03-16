import {
  createStatsGrid,
  createBudgetTracker,
  createProgressRing,
  createEventsTimeline,
} from '/assets/js/dashboard-widgets.js';

// Budget calculation configuration
const BUDGET_CONFIG = {
  DEFAULT_TOTAL_BUDGET: 5000, // Default budget for new event planners
  BUDGET_BUFFER_MULTIPLIER: 1.2, // Ensure total budget is 20% more than spent
  DEFAULT_GUEST_COUNT: 50, // Default guest count for per-person pricing estimates
};

/**
 * Parse price string to numeric value
 * Handles formats like: "£3,500", "£45 pp", "From £500", "Contact for pricing"
 * @param {string} priceStr - Price string to parse
 * @returns {number} - Parsed price value or 0
 */
function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') {
    return 0;
  }

  // Remove "From", "£", commas, and other non-numeric characters (except digits and decimal point)
  const cleaned = priceStr.replace(/from/gi, '').replace(/£/g, '').replace(/,/g, '').trim();

  // Handle "per person" (pp) or "per guest" pricing - extract base price
  const ppMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:pp|per person|per guest)/i);
  if (ppMatch) {
    return parseFloat(ppMatch[1]) || 0;
  }

  // Extract first number found
  const numMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return parseFloat(numMatch[1]) || 0;
  }

  // If no number found (e.g., "Contact for pricing"), return 0
  return 0;
}

/**
 * Categorize a package by its category
 * @param {string} category - Package category
 * @returns {string} - Standardized category name
 */
function categorizePackage(category) {
  if (!category) {
    return 'other';
  }

  const cat = category.toLowerCase();
  if (cat.includes('venue')) {
    return 'venue';
  }
  if (cat.includes('catering') || cat.includes('food')) {
    return 'catering';
  }
  if (
    cat.includes('entertainment') ||
    cat.includes('music') ||
    cat.includes('dj') ||
    cat.includes('band')
  ) {
    return 'entertainment';
  }
  if (cat.includes('photo')) {
    return 'photography';
  }
  if (cat.includes('flower') || cat.includes('decor') || cat.includes('decoration')) {
    return 'decorations';
  }
  if (cat.includes('transport')) {
    return 'transport';
  }
  if (cat.includes('hair') || cat.includes('makeup')) {
    return 'beauty';
  }

  return 'other';
}

/**
 * Calculate real budget from user's plans
 * @param {Array} plans - User's event plans
 * @returns {Object} - Budget data with spent, total, remaining, and breakdown
 */
async function calculateRealBudget(plans) {
  let totalSpent = 0;
  const breakdown = {
    venue: 0,
    catering: 0,
    entertainment: 0,
    photography: 0,
    decorations: 0,
    transport: 0,
    beauty: 0,
    other: 0,
  };

  if (!plans || plans.length === 0) {
    return {
      spent: 0,
      total: BUDGET_CONFIG.DEFAULT_TOTAL_BUDGET,
      remaining: BUDGET_CONFIG.DEFAULT_TOTAL_BUDGET,
      breakdown,
    };
  }

  // Collect all package IDs from plans
  const packageIds = [];
  plans.forEach(plan => {
    if (plan.packages && Array.isArray(plan.packages)) {
      packageIds.push(...plan.packages);
    }

    // Add custom budget items if available
    if (plan.budgetItems && Array.isArray(plan.budgetItems)) {
      plan.budgetItems.forEach(item => {
        const amount = parseFloat(item.actual || item.estimated || 0);
        if (amount > 0) {
          totalSpent += amount;
          breakdown.other += amount;
        }
      });
    }
  });

  // Fetch package details from API if we have package IDs
  if (packageIds.length > 0) {
    try {
      // Fetch packages in batches to avoid overwhelming the API
      const packagePromises = packageIds.map(async pkgId => {
        try {
          const response = await fetch(`/api/packages/${encodeURIComponent(pkgId)}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });

          if (response.ok) {
            const data = await response.json();
            return data.package || data;
          }
        } catch (err) {
          console.warn(`Failed to fetch package ${pkgId}:`, err);
        }
        return null;
      });

      const packages = (await Promise.all(packagePromises)).filter(p => p !== null);

      // Calculate spent from packages
      packages.forEach(pkg => {
        const price = parsePrice(pkg.price || pkg.price_display || '0');

        // Handle per-person pricing - estimate with guest count if available
        const isPP =
          (pkg.price || '').toLowerCase().includes('pp') ||
          (pkg.price || '').toLowerCase().includes('per person');

        let actualPrice = price;
        if (isPP && price > 0) {
          // Try to get guest count from plan
          const plan = plans.find(p => p.packages && p.packages.includes(pkg.id));
          const guests = plan?.guests || BUDGET_CONFIG.DEFAULT_GUEST_COUNT;
          actualPrice = price * guests;
        }

        totalSpent += actualPrice;

        // Categorize and add to breakdown
        const category = categorizePackage(pkg.category);
        breakdown[category] += actualPrice;
      });
    } catch (err) {
      console.error('Error fetching package details:', err);
    }
  }

  // Get total budget - server plan is source of truth, localStorage is fallback
  let totalBudget = BUDGET_CONFIG.DEFAULT_TOTAL_BUDGET;
  const planWithBudget = plans.find(p => p.budget && parseFloat(p.budget) > 0);

  // Priority 1: Server plan budget (authoritative — consistent across devices)
  if (planWithBudget) {
    totalBudget = parseFloat(planWithBudget.budget);
    // Keep localStorage in sync with server value
    try {
      localStorage.setItem('eventflow_custom_budget', String(totalBudget));
    } catch (_) {
      /* ignore */
    }
  } else {
    // Priority 2: localStorage fallback (user may have set budget without a plan,
    // or localStorage may be more recent than this plan fetch)
    try {
      const customBudget = localStorage.getItem('eventflow_custom_budget');
      if (customBudget && parseFloat(customBudget) > 0) {
        totalBudget = parseFloat(customBudget);
      }
    } catch (err) {
      console.error('Failed to read custom budget from localStorage:', err);
    }
  }

  // If no budget found anywhere and user is spending, flag it
  let noBudgetSet = false;
  if (totalBudget === BUDGET_CONFIG.DEFAULT_TOTAL_BUDGET && totalSpent > 0) {
    // Show warning instead of auto-expanding
    console.warn('User is spending without a budget set. Total spent:', totalSpent);
    noBudgetSet = true;
  }

  const remaining = Math.max(0, totalBudget - totalSpent);

  return {
    spent: Math.round(totalSpent * 100) / 100,
    total: Math.round(totalBudget * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    breakdown,
    noBudgetSet,
  };
}

// Initialize dashboard widgets after data loads
async function initCustomerDashboardWidgets(preloadedPlans) {
  try {
    // Fetch customer data with fallback (skip fetch if plans already provided)
    let plans = [];
    if (preloadedPlans) {
      plans = preloadedPlans;
    } else {
      try {
        const response = await fetch('/api/me/plans', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          plans = data.plans || [];
        }
      } catch (err) {
        console.error('Error fetching plans:', err);

        // Show error state with retry option
        const statsGrid = document.getElementById('customer-stats-grid');
        if (statsGrid) {
          statsGrid.innerHTML = `
          <div class="card" style="padding: 2rem; text-align: center; background: #FEF2F2; border: 1px solid #FCA5A5;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
            <h3 style="margin: 0 0 0.5rem 0; color: #991B1B;">Unable to Load Dashboard</h3>
            <p style="color: #7F1D1D; margin: 0 0 1.5rem 0;">There was a problem connecting to our servers.</p>
            <button id="dashboard-error-retry" class="cta" style="background: #DC2626;">
              🔄 Retry
            </button>
          </div>
        `;

          // Add event listener for retry button
          document.getElementById('dashboard-error-retry')?.addEventListener('click', () => {
            window.location.reload();
          });
        }

        // Show error in other widgets too
        const budgetWidget = document.getElementById('budget-tracker-widget');
        if (budgetWidget) {
          budgetWidget.innerHTML =
            '<p style="color: #991B1B; text-align: center; padding: 2rem;">Unable to load budget data</p>';
        }

        const progressWidget = document.getElementById('progress-ring-widget');
        if (progressWidget) {
          progressWidget.innerHTML =
            '<p style="color: #991B1B; text-align: center; padding: 2rem;">Unable to load progress</p>';
        }

        return; // Don't continue with empty data
      }
    } // end else (no preloadedPlans)

    // Count saved suppliers (from localStorage or API)
    let savedSuppliers = [];
    try {
      savedSuppliers = JSON.parse(localStorage.getItem('eventflow_saved_suppliers') || '[]');
    } catch (err) {
      console.error('Error reading saved suppliers from localStorage:', err);
      // Continue with empty array
    }

    // Count messages/conversations — start at 0; the stats widget will be updated
    // dynamically once UnreadBadgeManager receives real data (unreadCountUpdated event).
    const unreadMessages = 0;

    // Count upcoming tasks from plans (suppliers that need action)
    const upcomingTasks = plans.length > 0 ? plans.length : 0;

    // Create statistics widgets
    createStatsGrid(
      [
        {
          icon: '📋',
          value: plans.length,
          label: 'Active Plans',
          format: 'number',
          color: 'linear-gradient(135deg, #0B8073 0%, #13B6A2 100%)',
        },
        {
          icon: '⭐',
          value: savedSuppliers.length,
          label: 'Saved Suppliers',
          format: 'number',
          color: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
        },
        {
          icon: '📅',
          value: upcomingTasks,
          label: 'Upcoming Tasks',
          format: 'number',
          color: 'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)',
        },
        {
          icon: '💬',
          value: 0,
          label: 'Messages',
          format: 'number',
          color: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
          pulse: false,
        },
      ],
      'customer-stats-grid'
    );

    // Update Messages stat card as soon as UnreadBadgeManager fires the real count
    window.addEventListener('unreadCountUpdated', function onUnreadForStats(e) {
      window.removeEventListener('unreadCountUpdated', onUnreadForStats);
      const count =
        typeof e.detail?.count === 'number' ? Math.max(0, Math.floor(e.detail.count)) : 0;
      if (count <= 0) {
        return;
      }
      // Find the stat card that has the "Messages" label and update its displayed number
      const statsGrid = document.getElementById('customer-stats-grid');
      if (!statsGrid) {
        return;
      }
      statsGrid.querySelectorAll('.stat-widget').forEach(card => {
        const label = card.querySelector('.stat-label');
        if (label && label.textContent.trim() === 'Messages') {
          const num = card.querySelector('.stat-number');
          if (num) {
            num.textContent = count;
            num.dataset.target = count;
          }
          // Add pulse class to the icon container to draw attention
          const icon = card.querySelector('.icon-with-gradient');
          if (icon) {
            icon.classList.add('pulse');
          }
        }
      });
    });

    // Calculate real budget from plans
    const budgetData = await calculateRealBudget(plans);

    createBudgetTracker(budgetData, 'budget-tracker-widget');

    // Show warning banner when user is spending but has no explicit budget set
    if (budgetData.noBudgetSet) {
      const budgetWidget = document.getElementById('budget-tracker-widget');
      if (budgetWidget) {
        const warning = document.createElement('div');
        warning.id = 'budget-no-budget-warning';
        warning.style.cssText =
          'margin-top:0.75rem;padding:0.75rem 1rem;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;color:#92400E;';
        const icon = document.createElement('span');
        icon.textContent = '⚠️';
        const message = document.createElement('span');
        const link = document.createElement('a');
        link.href = '#budget-settings-form';
        link.style.cssText = 'color:#92400E;font-weight:600;text-decoration:underline;';
        link.textContent = 'Set a budget';
        message.appendChild(
          document.createTextNode('You have spending recorded but no budget set. ')
        );
        message.appendChild(link);
        message.appendChild(document.createTextNode(' to track your progress accurately.'));
        warning.appendChild(icon);
        warning.appendChild(message);
        budgetWidget.appendChild(warning);
      }
    }

    // Calculate real progress based on completion criteria
    let progressPercentage = 0;
    let completedSteps = 0;
    const totalSteps = 7; // Increased from 5

    if (plans.length > 0) {
      // Get the first plan with data or the most recent plan
      const activePlan = plans.find(p => p.eventDate || p.venue || p.catering) || plans[0];

      // More comprehensive criteria
      const criteria = [
        !!activePlan.eventDate || !!activePlan.date, // Has event date
        !!activePlan.eventName || !!activePlan.eventType, // Has event name/type
        !!activePlan.venue, // Has venue selected
        !!activePlan.catering, // Has catering selected
        !!(activePlan.budget && parseFloat(activePlan.budget) > 0), // Has budget set
        !!(activePlan.guestCount || activePlan.guests) &&
          parseInt(activePlan.guestCount || activePlan.guests || 0) > 0, // Has guest count
        !!(
          activePlan.packages &&
          Array.isArray(activePlan.packages) &&
          activePlan.packages.length > 0
        ), // Has booked suppliers
      ];

      completedSteps = criteria.filter(Boolean).length;
      progressPercentage = Math.round((completedSteps / totalSteps) * 100);
    }

    // Create progress ring
    createProgressRing(
      {
        percentage: progressPercentage,
        label: 'Planning Progress', // Changed from "Event Progress"
        booked: completedSteps,
        pending: totalSteps - completedSteps,
      },
      'progress-ring-widget'
    );

    // Create upcoming events timeline based on REAL event date
    let upcomingEvents = [];
    let eventDate = null;

    if (plans.length > 0) {
      // Find nearest upcoming event date
      const planWithDate = plans.find(p => p.eventDate || p.date);
      if (planWithDate) {
        eventDate = planWithDate.eventDate || planWithDate.date;
        const eventDateObj = new Date(eventDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const daysUntilEvent = Math.ceil((eventDateObj - today) / (1000 * 60 * 60 * 24));

        if (daysUntilEvent > 0) {
          // Generate REAL tasks based on event date
          const tasks = [];

          // 14 days before: Finalize suppliers
          if (daysUntilEvent > 14) {
            tasks.push({
              name: 'Finalize all supplier bookings',
              supplier: 'All Suppliers',
              daysUntil: Math.max(1, daysUntilEvent - 14),
            });
          }

          // 7 days before: Confirm details
          if (daysUntilEvent > 7) {
            tasks.push({
              name: 'Confirm final event details',
              supplier: 'Event Planning',
              daysUntil: Math.max(1, daysUntilEvent - 7),
            });
          }

          // 3 days before: Final payments
          if (daysUntilEvent > 3) {
            tasks.push({
              name: 'Complete final payments',
              supplier: 'Budget',
              daysUntil: Math.max(1, daysUntilEvent - 3),
            });
          }

          // 1 day before: Final checks
          if (daysUntilEvent > 1) {
            tasks.push({
              name: 'Final venue and supplier checks',
              supplier: 'All',
              daysUntil: 1,
            });
          }

          // Filter to only show upcoming tasks
          upcomingEvents = tasks.filter(task => task.daysUntil <= daysUntilEvent);
        } else if (daysUntilEvent === 0) {
          // Event is today!
          upcomingEvents = [
            { name: '🎉 Your event is TODAY!', supplier: 'EventFlow', daysUntil: 0 },
          ];
        } else {
          // Event has passed
          upcomingEvents = [
            { name: '✅ Event completed', supplier: 'Past Event', daysUntil: 0 },
            { name: 'Create a new event plan', supplier: 'Getting Started', daysUntil: 0 },
          ];
        }
      }

      // If no date set, show planning tasks
      if (upcomingEvents.length === 0) {
        upcomingEvents = [
          { name: 'Set your event date', supplier: 'Planning', daysUntil: 0 },
          { name: 'Browse and book suppliers', supplier: 'Marketplace', daysUntil: 0 },
          { name: 'Set your budget', supplier: 'Budget Settings', daysUntil: 0 },
        ];
      }
    } else {
      // No plans - show getting started tasks
      upcomingEvents = [
        { name: 'Create your first event plan', supplier: 'Getting Started', daysUntil: 0 },
        { name: 'Browse suppliers', supplier: 'Marketplace', daysUntil: 0 },
        { name: 'Save your favorites', supplier: 'Supplier Search', daysUntil: 0 },
      ];
    }

    createEventsTimeline(upcomingEvents, 'upcoming-events-timeline', eventDate);
  } catch (error) {
    console.error('Error initializing dashboard widgets:', error);
  }
}

// Expose to global scope so the non-module inline script can call it
window.initCustomerDashboardWidgets = initCustomerDashboardWidgets;
