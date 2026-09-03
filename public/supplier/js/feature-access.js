/**
 * Feature Access Control for EventFlow Suppliers
 * Manages premium feature access based on subscription tier
 */

// Feature tiers
const FEATURE_TIERS = {
  free: {
    maxPackages: 3,
    maxBookings: 10,
    priorityListing: false,
    analytics: false,
    badge: null,
    support: 'community',
    customBranding: false,
    homepageCarousel: false,
  },
  pro: {
    maxPackages: 50,
    maxBookings: 50,
    priorityListing: true,
    analytics: true,
    badge: 'pro',
    support: 'email',
    customBranding: false,
    homepageCarousel: false,
  },
  pro_plus: {
    maxPackages: -1, // unlimited
    maxBookings: -1, // unlimited
    priorityListing: true,
    analytics: true,
    badge: 'pro_plus',
    support: 'priority',
    customBranding: true,
    homepageCarousel: true,
  },
};

let currentSupplierTier = 'free';
let currentSupplierId = null;

/**
 * Initialize feature access control
 */
export async function initializeFeatureAccess() {
  try {
    // Check if user is authenticated via cookie-based auth
    const authResponse = await fetch('/api/v1/auth/me', {
      credentials: 'include',
    });

    if (!authResponse.ok) {
      console.warn('Failed to fetch auth status');
      return;
    }

    const authData = await authResponse.json();
    if (!authData.user) {
      return;
    }

    // Get supplier tier
    const tier = await getSupplierTier(authData.user.id);
    currentSupplierTier = tier;
  } catch (error) {
    console.error('Error initializing feature access:', error);
    throw error;
  }
}

/**
 * Get supplier tier for current user
 * @param {string} _userId - User ID (unused, kept for API compatibility)
 */
export async function getSupplierTier(_userId) {
  try {
    // Fetch supplier data from MongoDB-backed API
    const response = await fetch('/api/me/suppliers', {
      credentials: 'include',
    });

    if (!response.ok) {
      console.warn('Failed to fetch supplier data');
      return 'free';
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      return 'free';
    }

    // Get the first supplier (in case user has multiple)
    const supplierData = data.items[0];
    currentSupplierId = supplierData.id;

    // Check subscription
    const subscription = supplierData.subscription;
    if (!subscription || !subscription.tier) {
      return 'free';
    }

    // Check if subscription is active
    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      return 'free';
    }

    return subscription.tier;
  } catch (error) {
    console.error('Error getting supplier tier:', error);
    return 'free';
  }
}

/**
 * Check if a feature is available for current tier
 */
export function hasFeatureAccess(featureName) {
  const tierFeatures = FEATURE_TIERS[currentSupplierTier] || FEATURE_TIERS.free;
  return tierFeatures[featureName] !== false && tierFeatures[featureName] !== null;
}

/**
 * Get feature limit for current tier
 */
export function getFeatureLimit(featureName) {
  const tierFeatures = FEATURE_TIERS[currentSupplierTier] || FEATURE_TIERS.free;
  return tierFeatures[featureName];
}

/**
 * Check if user has reached package limit
 */
export function hasReachedPackageLimit(currentCount) {
  const limit = getFeatureLimit('maxPackages');
  if (limit === -1) {
    return false;
  } // unlimited
  return currentCount >= limit;
}

/**
 * Check if user has reached booking limit
 */
export function hasReachedBookingLimit(currentCount) {
  const limit = getFeatureLimit('maxBookings');
  if (limit === -1) {
    return false;
  } // unlimited
  return currentCount >= limit;
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier = null) {
  const t = tier || currentSupplierTier;
  switch (t) {
    case 'pro':
      return 'Pro';
    case 'pro_plus':
      return 'Pro+';
    default:
      return 'Starter';
  }
}

/**
 * Show upgrade prompt
 */
export function showUpgradePrompt(featureName, message = null) {
  const defaultMessage = `This feature requires an EventFlow Pro subscription. Upgrade now to unlock this feature.`;
  const displayMessage = message || defaultMessage;

  const modal = document.createElement('div');
  modal.className = 'upgrade-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'upgrade-modal-title');
  modal.innerHTML = `
    <div class="upgrade-modal-overlay" aria-hidden="true"></div>
    <div class="upgrade-modal-content">
      <button class="upgrade-modal-close" aria-label="Close premium feature dialog">&times;</button>
      <div class="upgrade-modal-icon" aria-hidden="true">🔒</div>
      <h3 id="upgrade-modal-title">Premium Feature</h3>
      <p>${escapeHtml(displayMessage)}</p>
      <div class="upgrade-modal-features">
        <h4>Unlock with Pro:</h4>
        <ul>
          <li>✓ Priority listing in search</li>
          <li>✓ Featured supplier badge</li>
          <li>✓ Advanced analytics</li>
          <li>✓ Up to 50 bookings/month</li>
        </ul>
      </div>
      <div class="upgrade-modal-actions">
        <a href="/supplier/subscription" class="upgrade-modal-cta">Upgrade Now</a>
        <button class="upgrade-modal-cancel">Maybe Later</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add styles if not already added
  // Close handlers
  // Close handlers
  const lastFocused = document.activeElement;
  const escapeHandler = e => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);
  function closeModal() {
    modal.remove();
    document.removeEventListener('keydown', escapeHandler);
    if (lastFocused?.focus) {
      lastFocused.focus();
    }
  }
  modal.querySelector('.upgrade-modal-close').addEventListener('click', closeModal);
  modal.querySelector('.upgrade-modal-cancel') &&
    modal.querySelector('.upgrade-modal-cancel').addEventListener('click', closeModal);
  modal.querySelector('.btn-cancel') &&
    modal.querySelector('.btn-cancel').addEventListener('click', closeModal);
  modal.querySelector('.upgrade-modal-overlay').addEventListener('click', closeModal);
  requestAnimationFrame(() => {
    const f = modal.querySelector('.upgrade-modal-close');
    if (f) {
      f.focus();
    }
  });
}

/**
 * Lock a feature element visually
 */
export function lockFeature(element, featureName) {
  element.classList.add('feature-locked');
  element.classList.add('feature-locked-wrapper');

  const badge = document.createElement('div');
  badge.className = 'feature-lock-badge';
  badge.innerHTML = `
    <div>🔒 Pro Feature</div>
    <a href="/supplier/subscription" class="upgrade-cta">Upgrade to unlock</a>
  `;

  element.appendChild(badge);
  element.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showUpgradePrompt(featureName);
  });
}

/**
 * Check and enforce package limit
 */
export function enforcePackageLimit(currentPackageCount) {
  const limit = getFeatureLimit('maxPackages');

  if (limit === -1) {
    // Unlimited
    return { allowed: true, remaining: -1 };
  }

  const remaining = limit - currentPackageCount;

  if (remaining <= 0) {
    return { allowed: false, remaining: 0, limit };
  }

  return { allowed: true, remaining, limit };
}

/**
 * Display package limit notice
 */
export function displayPackageLimitNotice(container, currentCount) {
  const limit = getFeatureLimit('maxPackages');

  if (limit === -1) {
    container.innerHTML = '<p class="small">✓ Unlimited packages with Pro+ subscription</p>';
    return;
  }

  const remaining = limit - currentCount;
  const percentage = (currentCount / limit) * 100;

  let statusClass = 'info';
  let statusIcon = 'ℹ️';

  if (percentage >= 100) {
    statusClass = 'danger';
    statusIcon = '⚠️';
  } else if (percentage >= 80) {
    statusClass = 'warning';
    statusIcon = '⚠️';
  }

  container.innerHTML = `
    <p class="small ${statusClass}">
      ${statusIcon} You have used ${currentCount} of ${limit} packages. 
      ${remaining > 0 ? `${remaining} remaining.` : 'Upgrade to add more packages.'}
    </p>
    ${
      remaining <= 0
        ? '<a href="/supplier/subscription" class="cta package-limit-upgrade-cta">Upgrade to Pro</a>'
        : ''
    }
  `;
}

/**
 * Get supplier badge HTML
 */
export function getSupplierBadgeHtml(tier = null) {
  const t = tier || currentSupplierTier;

  if (t === 'pro_plus') {
    return '<span class="badge badge-pro-plus">Pro Plus</span>';
  }

  if (t === 'pro') {
    return '<span class="badge badge-pro">Pro</span>';
  }

  // Free / Starter tier
  return '<span class="badge badge-starter">Starter</span>';
}

/**
 * Export current tier for use in other modules
 */
export function getCurrentTier() {
  return currentSupplierTier;
}

/**
 * Export current supplier ID
 */
export function getCurrentSupplierId() {
  return currentSupplierId;
}
