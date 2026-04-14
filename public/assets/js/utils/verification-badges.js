/**
 * Verification Badges Utility
 * Renders verification and trust badges for suppliers
 * Used on: supplier cards, profile pages, search results
 */

/**
 * Resolve the active subscription tier for a supplier object.
 * Uses subscriptionTier field first, then subscription.tier, then isPro boolean.
 * @param {Object} supplier
 * @returns {'pro_plus'|'pro'|'free'}
 */
function resolveSupplierTier(supplier) {
  if (!supplier) {
    return 'free';
  }
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
  return tier === 'pro_plus' ? 'pro_plus' : tier === 'pro' ? 'pro' : 'free';
}

/**
 * Render a small inline tier icon (star or diamond) to appear next to a name.
 * Returns an empty string when the supplier is on the free tier.
 * @param {Object} supplier - Supplier object
 * @returns {string} HTML string — a single <span> or empty string
 */
export function renderTierIcon(supplier) {
  const tier = resolveSupplierTier(supplier);
  if (tier === 'pro_plus') {
    return `<span class="tier-icon tier-icon-pro-plus" title="Professional Plus subscriber" aria-label="Pro Plus">💎</span>`;
  }
  if (tier === 'pro') {
    return `<span class="tier-icon tier-icon-pro" title="Professional subscriber" aria-label="Pro">⭐</span>`;
  }
  return '';
}

/**
 * Generate verification badges HTML for a supplier
 * @param {Object} supplier - Supplier object with verification fields
 * @param {Object} options - Rendering options
 * @returns {string} HTML string for badges
 */
export function renderVerificationBadges(supplier, options = {}) {
  if (!supplier) {
    return '';
  }

  const {
    size = 'normal', // 'small', 'normal', 'large'
    showAll = true, // Show all badges or just priority ones
    maxBadges = null, // Limit number of badges shown
  } = options;

  const badges = [];

  // Priority 1: Founding Supplier Badge
  if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding ||
      (supplier.badges && (supplier.badges.includes('founding') || supplier.badges.includes('founder')))) {
    badges.push({
      html: `<span class="badge badge-founding ${size === 'small' ? 'badge-sm' : ''}" 
                   title="Founding Supplier - One of our first partners" 
                   role="status"
                   aria-label="Founding supplier">
               Founding Supplier
             </span>`,
      priority: 1,
    });
  }

  // Priority 2: Subscription Tier Badges — always at top (priority 1 reserved for Founding)
  const tier = resolveSupplierTier(supplier);
  if (tier === 'pro_plus') {
    badges.push({
      html: `<span class="badge badge-pro-plus ${size === 'small' ? 'badge-sm' : ''}" 
                   title="Pro Plus — Premium subscription" 
                   role="status"
                   aria-label="Pro Plus subscriber">
               Pro Plus
             </span>`,
      priority: 2,
    });
  } else if (tier === 'pro') {
    badges.push({
      html: `<span class="badge badge-pro ${size === 'small' ? 'badge-sm' : ''}" 
                   title="Pro — Enhanced subscription" 
                   role="status"
                   aria-label="Pro subscriber">
               Pro
             </span>`,
      priority: 2,
    });
  } else {
    // Free tier — show Starter badge
    badges.push({
      html: `<span class="badge badge-starter ${size === 'small' ? 'badge-sm' : ''}" 
                   title="Starter — Free plan" 
                   role="status"
                   aria-label="Starter plan">
               Starter
             </span>`,
      priority: 2,
    });
  }

  // Priority 3: Featured Badge
  if (supplier.featured || supplier.featuredSupplier) {
    badges.push({
      html: `<span class="badge badge-featured ${size === 'small' ? 'badge-sm' : ''}" 
                   title="Featured Supplier" 
                   role="status"
                   aria-label="Featured supplier">
               Featured
             </span>`,
      priority: 2,
    });
  }

  // Priority 3b: Earned / auto-awarded badges from the badgeDetails array
  // (populated by the server from the badges collection when enriching the supplier response)
  const EARNED_TYPE_CLASS = {
    'fast-responder': 'badge-fast-responder',
    'top-rated': 'badge-top-rated',
    expert: 'badge-expert',
    custom: 'badge-custom',
  };
  if (Array.isArray(supplier.badgeDetails) && supplier.badgeDetails.length > 0) {
    supplier.badgeDetails.forEach(badge => {
      // Skip tier / founder / featured / verification badges — rendered elsewhere
      const skipTypes = ['pro', 'pro-plus', 'founder', 'founding', 'verified', 'featured'];
      if (skipTypes.includes(badge.type)) {
        return;
      }
      const cssClass =
        EARNED_TYPE_CLASS[badge.id] || EARNED_TYPE_CLASS[badge.type] || 'badge-custom';
      // For custom badges (no CSS ::before icon), include badge.icon in text.
      // For standard badge types, CSS ::before handles the icon — omit it here.
      const iconText = cssClass === 'badge-custom' && badge.icon ? `${badge.icon} ` : '';
      badges.push({
        html: `<span class="badge ${cssClass} ${size === 'small' ? 'badge-sm' : ''}" 
                     title="${badge.description || badge.name}" 
                     role="status"
                     aria-label="${badge.name}">
                 ${iconText}${badge.name}
               </span>`,
        priority: 2,
      });
    });
  }

  // Priority 4: Verification Badges
  // Email Verified
  if (supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified) {
    if (showAll) {
      badges.push({
        html: `<span class="badge badge-email-verified ${size === 'small' ? 'badge-sm' : ''}" 
                     title="Email address verified" 
                     role="status"
                     aria-label="Email verified">
                 <i class="fas fa-envelope-circle-check" aria-hidden="true"></i> Email
               </span>`,
        priority: 3,
      });
    }
  }

  // Phone Verified
  if (supplier.phoneVerified || supplier.verifications?.phone?.verified) {
    if (showAll) {
      badges.push({
        html: `<span class="badge badge-phone-verified ${size === 'small' ? 'badge-sm' : ''}" 
                     title="Phone number verified" 
                     role="status"
                     aria-label="Phone verified">
                 <i class="fas fa-phone-check" aria-hidden="true"></i> Phone
               </span>`,
        priority: 3,
      });
    }
  }

  // Business Verified
  if (supplier.businessVerified || supplier.verifications?.business?.verified) {
    if (showAll) {
      badges.push({
        html: `<span class="badge badge-business-verified ${size === 'small' ? 'badge-sm' : ''}" 
                     title="Business documents verified" 
                     role="status"
                     aria-label="Business verified">
                 <i class="fas fa-building-circle-check" aria-hidden="true"></i> Business
               </span>`,
        priority: 3,
      });
    }
  }

  // Sort by priority
  badges.sort((a, b) => a.priority - b.priority);

  // Limit badges if maxBadges is set
  const displayBadges = maxBadges ? badges.slice(0, maxBadges) : badges;

  if (displayBadges.length === 0) {
    return '';
  }

  return `
    <div class="supplier-badges ${size === 'small' ? 'supplier-badges-sm' : ''}">
      ${displayBadges.map(b => b.html).join('\n      ')}
    </div>
  `;
}

/**
 * Format date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date (e.g., "15/01/2025")
 */
function formatVerificationDate(dateString) {
  if (!dateString) {
    return '';
  }
  try {
    return new Date(dateString).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  } catch (e) {
    return '';
  }
}

/**
 * Generate detailed verification section HTML for supplier profile page
 * @param {Object} supplier - Supplier object with verification fields
 * @returns {string} HTML string for verification section
 */
export function renderVerificationSection(supplier) {
  if (!supplier) {
    return '';
  }

  const verifications = [];

  // Founding Supplier
  if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
    verifications.push({
      icon: '👑',
      title: 'Founding Supplier',
      description: 'Original member of the EventFlow platform since 2024',
      verified: true,
      class: 'founding',
    });
  }

  // Email Verification
  const emailVerified =
    supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified;
  const emailDate = formatVerificationDate(
    supplier.verifications?.email?.verifiedAt || supplier.createdAt
  );

  verifications.push({
    icon: emailVerified ? '✓' : '○',
    title: 'Email Address',
    description: emailVerified ? `Verified ${emailDate}` : 'Not yet verified',
    verified: emailVerified,
    class: 'email',
  });

  // Phone Verification
  const phoneVerified = supplier.phoneVerified || supplier.verifications?.phone?.verified;
  const phoneDate = formatVerificationDate(supplier.verifications?.phone?.verifiedAt);

  verifications.push({
    icon: phoneVerified ? '✓' : '○',
    title: 'Phone Number',
    description: phoneVerified ? `Verified ${phoneDate}` : 'Not yet verified',
    verified: phoneVerified,
    class: 'phone',
  });

  // Business Verification
  const businessVerified = supplier.businessVerified || supplier.verifications?.business?.verified;
  const businessDate = formatVerificationDate(supplier.verifications?.business?.verifiedAt);

  verifications.push({
    icon: businessVerified ? '✓' : '○',
    title: 'Business Documents',
    description: businessVerified ? `Verified ${businessDate}` : 'Not yet verified',
    verified: businessVerified,
    class: 'business',
  });

  const html = `
    <div class="verification-section">
      <h3 class="verification-section__title">Verification & Trust</h3>
      <div class="verification-list">
        ${verifications
          .map(
            v => `
          <div class="verification-item ${v.verified ? 'verified' : 'unverified'} verification-item--${v.class}">
            <div class="verification-icon" aria-hidden="true">${v.icon}</div>
            <div class="verification-content">
              <div class="verification-title">${v.title}</div>
              <div class="verification-description">${v.description}</div>
            </div>
            <div class="verification-status" role="status" aria-label="${v.verified ? 'Verified' : 'Not verified'}">
              ${v.verified ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-circle"></i>'}
            </div>
          </div>
        `
          )
          .join('\n        ')}
      </div>
    </div>
  `;

  return html;
}

/**
 * Check if supplier has any verification badges
 * @param {Object} supplier - Supplier object
 * @returns {boolean} True if supplier has any badges
 */
export function hasVerificationBadges(supplier) {
  if (!supplier) {
    return false;
  }

  return !!(
    supplier.isFoundingSupplier ||
    supplier.isFounding ||
    supplier.founding ||
    supplier.emailVerified ||
    supplier.phoneVerified ||
    supplier.businessVerified ||
    supplier.verifications?.email?.verified ||
    supplier.verifications?.phone?.verified ||
    supplier.verifications?.business?.verified ||
    supplier.isPro ||
    supplier.subscription?.tier
  );
}

/**
 * Get verification summary for supplier
 * @param {Object} supplier - Supplier object
 * @returns {Object} Verification summary with counts and percentages
 */
export function getVerificationSummary(supplier) {
  if (!supplier) {
    return { total: 0, verified: 0, percentage: 0 };
  }

  const checks = [
    supplier.emailVerified || supplier.verifications?.email?.verified || supplier.verified,
    supplier.phoneVerified || supplier.verifications?.phone?.verified,
    supplier.businessVerified || supplier.verifications?.business?.verified,
  ];

  const verified = checks.filter(Boolean).length;
  const total = checks.length;
  const percentage = Math.round((verified / total) * 100);

  return {
    total,
    verified,
    percentage,
    isFullyVerified: verified === total,
    verificationLevel:
      percentage === 100
        ? 'Complete'
        : percentage >= 66
          ? 'High'
          : percentage >= 33
            ? 'Partial'
            : 'Low',
  };
}

// Export default object with all functions
export default {
  renderTierIcon,
  renderVerificationBadges,
  renderVerificationSection,
  hasVerificationBadges,
  getVerificationSummary,
};
