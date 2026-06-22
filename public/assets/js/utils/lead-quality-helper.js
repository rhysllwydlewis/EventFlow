/**
 * Lead Quality Badge Helper
 * Generates HTML for displaying lead quality badges and scores
 */

/**
 * Calculate lead quality score based on multiple factors
 * @param {object} enquiry - Enquiry/thread object
 * @param {object} supplierProfile - Supplier profile object (optional)
 * @returns {object} { badge, label, color, score }
 */
export function calculateLeadQuality(enquiry, supplierProfile = {}) {
  let score = 0;

  // Budget match (0-40 points)
  const enquiryBudget = enquiry.budget || enquiry.estimatedBudget || 0;
  const minBudget = supplierProfile.minBudget || supplierProfile.priceRange?.min || 0;

  if (minBudget > 0 && enquiryBudget >= minBudget) {
    score += 40;
  } else if (minBudget > 0 && enquiryBudget >= minBudget * 0.8) {
    score += 30;
  } else if (minBudget > 0 && enquiryBudget >= minBudget * 0.6) {
    score += 20;
  } else if (enquiryBudget > 0) {
    score += 10; // Has some budget
  }

  // Message quality (0-20 points)
  const message = enquiry.message || enquiry.lastMessage || '';
  if (message.length > 100) {
    score += 20;
  } else if (message.length > 50) {
    score += 10;
  } else if (message.length > 0) {
    score += 5;
  }

  // Customer profile completeness (0-20 points)
  const customer = enquiry.customer || enquiry.customerDetails || {};
  if (customer.verified || customer.emailVerified) {
    score += 10;
  }
  if (customer.profileComplete || (customer.name && customer.email)) {
    score += 10;
  }

  // Urgency (0-20 points)
  const eventDate = enquiry.eventDate || enquiry.date;
  if (eventDate) {
    const daysUntilEvent = Math.floor((new Date(eventDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntilEvent <= 30) {
      score += 20;
    } else if (daysUntilEvent <= 60) {
      score += 15;
    } else if (daysUntilEvent <= 90) {
      score += 10;
    } else {
      score += 5;
    }
  }

  // Determine badge
  if (score >= 80) {
    return { badge: '🔥', label: 'Hot', color: '#ef4444', score };
  }
  if (score >= 60) {
    return { badge: '⭐', label: 'High', color: '#f59e0b', score };
  }
  if (score >= 40) {
    return { badge: '✓', label: 'Good', color: '#10b981', score };
  }
  return { badge: '◯', label: 'Low', color: '#6b7280', score };
}

/**
 * Get lead quality badge HTML
 * @param {string} rating - 'High', 'Medium', or 'Low' (legacy) OR quality object with badge/label/color/score
 * @param {number} score - Raw score 0-100 (optional if using quality object)
 * @returns {string} HTML string for badge
 */
export function getLeadQualityBadge(rating, score) {
  // New format: rating is quality object
  if (typeof rating === 'object' && rating.badge) {
    return `
      <span class="lead-badge" style="background: ${rating.color}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" role="status" aria-label="Lead quality: ${rating.label} (${rating.score} points)">
        <span style="font-size: 0.875rem;">${rating.badge}</span>
        <span>${rating.label}</span>
        <span style="opacity: 0.8; font-size: 0.7rem;">(${rating.score})</span>
      </span>
    `;
  }

  // Legacy format
  if (!rating) {
    return '';
  }

  const badgeClass = `lead-badge lead-badge-${rating.toLowerCase()}`;
  const scoreCircle = score
    ? `<span class="lead-score-number ${rating.toLowerCase()}">${score}</span>`
    : '';

  return `
    <div class="lead-quality-display">
      <span class="${badgeClass}" role="status" aria-label="Lead quality: ${rating}">
        ${rating} Quality
      </span>
      ${scoreCircle}
    </div>
  `;
}

/**
 * Get supplier badge HTML
 * @param {object} supplier - Supplier object with badge info
 * @returns {string} HTML string for badges
 */
export function getSupplierBadges(supplier) {
  if (!supplier) {
    return '';
  }

  const badges = [];

  // Founding supplier badge
  if (
    supplier.isFounding ||
    supplier.founding ||
    (supplier.badges &&
      (supplier.badges.includes('founding') || supplier.badges.includes('founder')))
  ) {
    badges.push(
      '<span class="badge badge-founding" data-tooltip="Founding Supplier - One of our first partners">Founding Supplier</span>'
    );
  }

  // Subscription tier badge
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : null);
  if (tier === 'featured') {
    badges.push('<span class="badge badge-featured">Featured</span>');
  } else if (tier === 'pro_plus') {
    badges.push('<span class="badge badge-pro-plus">Pro Plus</span>');
  } else if (tier === 'pro') {
    badges.push('<span class="badge badge-pro">Pro</span>');
  } else {
    badges.push('<span class="badge badge-starter">Starter</span>');
  }

  // Verification badges
  if (supplier.verifications) {
    if (supplier.verifications.email && supplier.verifications.email.verified) {
      badges.push(
        '<span class="badge badge-email-verified" data-tooltip="Email verified">Email Verified</span>'
      );
    }
    if (supplier.verifications.phone && supplier.verifications.phone.verified) {
      badges.push(
        '<span class="badge badge-phone-verified" data-tooltip="Phone verified">Phone Verified</span>'
      );
    }
    if (supplier.verifications.business && supplier.verifications.business.verified) {
      badges.push(
        '<span class="badge badge-business-verified" data-tooltip="Business documents verified">Business Verified</span>'
      );
    }
  }

  if (badges.length === 0) {
    return '';
  }

  return `
    <div class="supplier-badges">
      ${badges.join('')}
    </div>
  `;
}

/**
 * Get lead quality breakdown HTML for dashboard
 * @param {Array} threads - Array of thread objects with lead scores
 * @returns {object} Counts and HTML
 */
export function getLeadQualityBreakdown(threads) {
  if (!threads || threads.length === 0) {
    return {
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
      html: '<p class="small">No enquiries yet</p>',
    };
  }

  const counts = {
    High: 0,
    Medium: 0,
    Low: 0,
  };

  threads.forEach(thread => {
    if (thread.leadScore) {
      counts[thread.leadScore] = (counts[thread.leadScore] || 0) + 1;
    }
  });

  const total = threads.length;
  const highPercent = Math.round((counts.High / total) * 100) || 0;
  const mediumPercent = Math.round((counts.Medium / total) * 100) || 0;
  const lowPercent = Math.round((counts.Low / total) * 100) || 0;

  const html = `
    <div class="lead-quality-breakdown">
      <h4 style="margin-bottom: 1rem;">Lead Quality Distribution</h4>
      
      <div class="quality-stat">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="lead-badge lead-badge-high" style="font-size: 0.875rem;">High Quality</span>
          <span style="font-weight: 600;">${counts.High} (${highPercent}%)</span>
        </div>
        <div class="progress-bar" style="background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: #10b981; height: 100%; width: ${highPercent}%; transition: width 0.3s;"></div>
        </div>
      </div>
      
      <div class="quality-stat" style="margin-top: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="lead-badge lead-badge-medium" style="font-size: 0.875rem;">Medium Quality</span>
          <span style="font-weight: 600;">${counts.Medium} (${mediumPercent}%)</span>
        </div>
        <div class="progress-bar" style="background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: #f59e0b; height: 100%; width: ${mediumPercent}%; transition: width 0.3s;"></div>
        </div>
      </div>
      
      <div class="quality-stat" style="margin-top: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span class="lead-badge lead-badge-low" style="font-size: 0.875rem;">Low Quality</span>
          <span style="font-weight: 600;">${counts.Low} (${lowPercent}%)</span>
        </div>
        <div class="progress-bar" style="background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: #ef4444; height: 100%; width: ${lowPercent}%; transition: width 0.3s;"></div>
        </div>
      </div>
      
      <div style="margin-top: 1rem; padding: 0.75rem; background: #f9fafb; border-radius: 6px; text-align: center;">
        <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Average Lead Score</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: #111827;">${Math.round(threads.reduce((sum, t) => sum + (t.leadScoreRaw || 50), 0) / total)}/100</div>
      </div>
    </div>
  `;

  return {
    high: counts.High,
    medium: counts.Medium,
    low: counts.Low,
    total,
    html,
  };
}

/**
 * Add lead quality indicator to thread display
 * @param {object} thread - Thread object
 * @returns {string} HTML to append to thread display
 */
export function getThreadLeadQualityIndicator(thread) {
  if (!thread.leadScore && !thread.leadScoreRaw) {
    return '';
  }

  const score = thread.leadScoreRaw || null;
  const rating = thread.leadScore || 'Medium';

  return `
    <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
      ${getLeadQualityBadge(rating, score)}
      ${thread.leadScoreFlags && thread.leadScoreFlags.length > 0 ? `<span class="small" style="color: #9ca3af;" title="${thread.leadScoreFlags.join(', ')}">ⓘ</span>` : ''}
    </div>
  `;
}

/**
 * Sort threads by lead quality
 * @param {Array} threads - Array of thread objects
 * @param {string} order - 'asc' or 'desc'
 * @returns {Array} Sorted threads
 */
export function sortThreadsByLeadQuality(threads, order = 'desc') {
  const scoreMap = { High: 3, Medium: 2, Low: 1 };

  return threads.sort((a, b) => {
    const scoreA = a.leadScoreRaw || scoreMap[a.leadScore] || 0;
    const scoreB = b.leadScoreRaw || scoreMap[b.leadScore] || 0;

    return order === 'desc' ? scoreB - scoreA : scoreA - scoreB;
  });
}

/**
 * Filter threads by lead quality
 * @param {Array} threads - Array of thread objects
 * @param {string} quality - 'High', 'Medium', 'Low', or 'all'
 * @returns {Array} Filtered threads
 */
export function filterThreadsByQuality(threads, quality) {
  if (quality === 'all' || !quality) {
    return threads;
  }

  return threads.filter(thread => thread.leadScore === quality);
}

/**
 * Sort threads by new quality score
 * @param {Array} threads - Array of thread objects
 * @param {object} supplierProfile - Supplier profile for scoring
 * @param {string} order - 'asc' or 'desc'
 * @returns {Array} Sorted threads with quality scores
 */
export function sortThreadsByQualityScore(threads, supplierProfile = {}, order = 'desc') {
  // Calculate quality for each thread
  const threadsWithQuality = threads.map(thread => {
    const quality = calculateLeadQuality(thread, supplierProfile);
    return { ...thread, qualityScore: quality };
  });

  // Sort by score
  threadsWithQuality.sort((a, b) => {
    return order === 'desc'
      ? b.qualityScore.score - a.qualityScore.score
      : a.qualityScore.score - b.qualityScore.score;
  });

  return threadsWithQuality;
}

/**
 * Filter threads by new quality level
 * @param {Array} threads - Array of thread objects with qualityScore
 * @param {string} level - 'Hot', 'High', 'Good', 'Low', or 'all'
 * @returns {Array} Filtered threads
 */
export function filterThreadsByQualityLevel(threads, level) {
  if (level === 'all' || !level) {
    return threads;
  }

  return threads.filter(thread => {
    if (!thread.qualityScore) {
      return false;
    }
    return thread.qualityScore.label === level;
  });
}

export default {
  calculateLeadQuality,
  getLeadQualityBadge,
  getSupplierBadges,
  getLeadQualityBreakdown,
  getThreadLeadQualityIndicator,
  sortThreadsByLeadQuality,
  filterThreadsByQuality,
  sortThreadsByQualityScore,
  filterThreadsByQualityLevel,
};
