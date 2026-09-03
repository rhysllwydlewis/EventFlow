/**
 * Profile Health Score Widget
 * Calculates and displays supplier profile completion score
 */

'use strict';
(function () {
  function descriptionValue(supplier) {
    return String(
      supplier?.description_long ||
        supplier?.description_short ||
        supplier?.description ||
        supplier?.blurb ||
        ''
    ).trim();
  }

  function galleryItemKey(item) {
    if (typeof item === 'string') {
      return item.trim();
    }
    if (!item || typeof item !== 'object') {
      return '';
    }
    return String(
      item.url || item.large || item.optimized || item.original || item.thumbnail || item.src || ''
    ).trim();
  }

  function galleryItems(supplier) {
    const canonical = Array.isArray(supplier?.photosGallery) ? supplier.photosGallery : [];
    const legacy = Array.isArray(supplier?.images) ? supplier.images : [];
    // Some migrated records have both schema generations populated. Compare their
    // actual media URLs rather than object identity so the same photo cannot count twice.
    return Array.from(new Set([...canonical, ...legacy].map(galleryItemKey).filter(Boolean)));
  }

  function socialLinks(supplier) {
    const legacy =
      supplier?.socials && typeof supplier.socials === 'object' && !Array.isArray(supplier.socials)
        ? supplier.socials
        : {};
    const canonical =
      supplier?.socialLinks &&
      typeof supplier.socialLinks === 'object' &&
      !Array.isArray(supplier.socialLinks)
        ? supplier.socialLinks
        : {};

    // Preserve a populated legacy value when a migrated record contains an empty
    // canonical key. Non-empty canonical values still take precedence.
    const merged = { ...legacy };
    Object.entries(canonical).forEach(([key, value]) => {
      if (value) {
        merged[key] = value;
      } else if (!merged[key]) {
        merged[key] = value;
      }
    });
    return merged;
  }

  /**
   * Weighted scoring criteria for profile health
   * Total: 100 points
   *
   * Checks use the canonical supplier fields plus supported legacy aliases so
   * the dashboard does not mark populated profile content as missing.
   *
   * Deliberately excludes phone/business hours/FAQs: those fields exist in
   * the data model but no supplier-facing page has ever exposed an input for
   * them, so scoring against them penalised every supplier for something
   * they had no way to fix. Re-add a criterion here once real UI exists for
   * it — don't just check the field is theoretically settable via the API.
   */
  const HEALTH_CRITERIA = [
    {
      id: 'logo',
      label: 'Profile photo',
      weight: 15,
      check: s => Boolean(s.logo || s.profileImage || s.profilePhotoUrl || s.avatarUrl),
    },
    {
      id: 'description',
      label: 'Description (100+ characters)',
      weight: 15,
      check: s => descriptionValue(s).length >= 100,
    },
    {
      id: 'location',
      label: 'Location & postcode',
      weight: 15,
      // basePostcode is the field the dashboard's postcode input actually
      // saves to (see sup-base-postcode in dashboard-supplier.html);
      // venuePostcode is the Venues-category-only alternative. Plain
      // `postcode` isn't written anywhere by any supplier-facing form.
      check: s => Boolean(s.location) && Boolean(s.basePostcode || s.venuePostcode),
    },
    {
      id: 'coverImage',
      label: 'Banner image',
      weight: 15,
      check: s => Boolean(s.bannerUrl || s.coverImage),
    },
    {
      id: 'gallery',
      label: 'Gallery (3+ images)',
      weight: 15,
      check: s => galleryItems(s).length >= 3,
    },
    {
      id: 'socials',
      label: 'Social media (2+ platforms)',
      weight: 15,
      check: s => Object.values(socialLinks(s)).filter(Boolean).length >= 2,
    },
    { id: 'website', label: 'Website URL', weight: 10, check: s => !!s.website },
  ];

  /**
   * Calculate profile health score
   * @param {Object} supplier - Supplier data
   * @returns {Object} - Score data with breakdown
   */
  function calculateHealthScore(supplier) {
    let earnedPoints = 0;
    const totalPoints = HEALTH_CRITERIA.reduce((sum, c) => sum + c.weight, 0);
    const completedItems = [];
    const incompleteItems = [];

    HEALTH_CRITERIA.forEach(criterion => {
      const isComplete = criterion.check(supplier || {});
      if (isComplete) {
        earnedPoints += criterion.weight;
        completedItems.push(criterion);
      } else {
        incompleteItems.push(criterion);
      }
    });

    const percentage = Math.round((earnedPoints / totalPoints) * 100);

    let status = 'poor';
    let message = "Let's improve your profile to attract more customers!";
    let color = '#ef4444';

    if (percentage >= 80) {
      status = 'excellent';
      message = 'Excellent! Your profile is looking great! 🎉';
      color = '#10b981';
    } else if (percentage >= 60) {
      status = 'good';
      message = 'Great job! Just a few more steps to perfection.';
      color = '#f59e0b';
    }

    return {
      percentage,
      earnedPoints,
      totalPoints,
      status,
      message,
      color,
      completedItems,
      incompleteItems,
    };
  }

  /**
   * Render circular progress ring
   *
   * Pure CSS (conic-gradient + mask), not SVG. The previous SVG version drew
   * its circle at fixed coordinates sized for a 120x120 canvas with no
   * viewBox, and the "55%" text was a sibling positioned on top of it via
   * position:absolute + transform — two independent coordinate systems that
   * had to agree by convention rather than by construction. That's exactly
   * the kind of gap where rendering engines are free to disagree.
   *
   * Here the ring is one element's background (conic-gradient, masked to a
   * ring shape) and the percentage text is a real flex-centered child of
   * that same element — centering is a single flexbox computation, not two
   * separately-positioned pieces that happen to line up.
   * @param {number} percentage - Health score percentage (0-100)
   * @param {string} color - Ring color
   * @returns {string} - HTML
   */
  function renderProgressRing(percentage, color) {
    return `
      <div class="health-ring" style="--ring-pct: ${percentage}; --ring-color: ${color};">
        <div class="health-ring-value" aria-live="polite">
          ${percentage}%
          <span class="health-ring-label">Complete</span>
        </div>
      </div>
    `;
  }

  /**
   * Render checklist item
   * @param {Object} item - Checklist item
   * @param {boolean} isComplete - Completion status
   * @returns {string} - HTML
   */
  function renderChecklistItem(item, isComplete) {
    const icon = isComplete ? '✓' : '○';
    const statusClass = isComplete ? 'completed' : 'incomplete';

    return `
      <li class="health-checklist-item ${statusClass}">
        <span class="health-checklist-icon" aria-label="${isComplete ? 'Completed' : 'Incomplete'}">
          ${icon}
        </span>
        <span class="health-checklist-text">${item.label}</span>
        <span class="health-checklist-weight">+${item.weight}pts</span>
      </li>
    `;
  }

  /**
   * Render profile health widget
   * @param {Object} supplier - Supplier data
   * @returns {string} - Widget HTML
   */
  function renderHealthWidget(supplier) {
    if (!supplier) {
      return '<p class="ef-text-muted">No supplier data available</p>';
    }

    const scoreData = calculateHealthScore(supplier);

    return `
      <div class="profile-health-widget" role="region" aria-labelledby="health-widget-title">
        <div class="profile-health-header">
          <div class="profile-health-icon" aria-hidden="true">💪</div>
          <div class="profile-health-title-wrapper">
            <h2 id="health-widget-title">Profile Health</h2>
            <p>How rich your profile content is — separate from the setup checklist above</p>
          </div>
        </div>

        <div class="profile-health-score">
          ${renderProgressRing(scoreData.percentage, scoreData.color)}
        </div>

        <div class="health-message health-${scoreData.status}" role="status" aria-live="polite">
          ${scoreData.message}
        </div>

        <ul class="health-checklist" aria-label="Profile completion checklist">
          ${scoreData.completedItems.map(item => renderChecklistItem(item, true)).join('')}
          ${scoreData.incompleteItems.map(item => renderChecklistItem(item, false)).join('')}
        </ul>

        <button
          class="ef-cta health-cta"
          data-href="/supplier/profile-customization"
          aria-label="Improve your profile to ${scoreData.percentage}%"
        >
          ${scoreData.percentage === 100 ? '🎉 Profile Complete!' : '✨ Improve Profile'}
        </button>
      </div>
    `;
  }

  /**
   * Initialize profile health widget
   * @param {string} containerId - Container element ID
   * @param {Object} supplier - Supplier data
   */
  function initProfileHealthWidget(containerId, supplier) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Profile health widget container not found: ${containerId}`);
      return;
    }

    const widgetHtml = renderHealthWidget(supplier);
    container.innerHTML = widgetHtml;

    // Attach event listener for CTA button (replaces inline onclick)
    const ctaBtn = container.querySelector('.health-cta[data-href]');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', () => {
        window.location.href = ctaBtn.getAttribute('data-href');
      });
    }

    // Announce to screen readers
    if (window.announceToSR) {
      const scoreData = calculateHealthScore(supplier);
      window.announceToSR(`Profile health: ${scoreData.percentage}% complete`);
    }
  }

  // Export to global scope
  window.ProfileHealthWidget = {
    init: initProfileHealthWidget,
    calculate: calculateHealthScore,
    render: renderHealthWidget,
  };
})();
