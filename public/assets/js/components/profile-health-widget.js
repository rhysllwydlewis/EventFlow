/**
 * Profile Health Score Widget
 * Calculates and displays supplier profile completion score
 */

(function () {
  'use strict';

  /**
   * Weighted scoring criteria for profile health
   * Total: 100 points
   */
  const HEALTH_CRITERIA = [
    { id: 'logo', label: 'Profile photo', weight: 10, check: s => !!s.logo },
    {
      id: 'description',
      label: 'Description (100+ characters)',
      weight: 10,
      check: s => s.description && s.description.length >= 100,
    },
    {
      id: 'contact',
      label: 'Contact info complete',
      weight: 10,
      check: s => !!s.email && !!s.phone,
    },
    {
      id: 'location',
      label: 'Location & postcode',
      weight: 10,
      check: s => !!s.location && !!s.postcode,
    },
    { id: 'coverImage', label: 'Banner image', weight: 10, check: s => !!s.coverImage },
    {
      id: 'gallery',
      label: 'Gallery (3+ images)',
      weight: 10,
      check: s => Array.isArray(s.images) && s.images.length >= 3,
    },
    {
      id: 'socials',
      label: 'Social media (2+ platforms)',
      weight: 10,
      check: s => s.socials && Object.keys(s.socials).filter(k => s.socials[k]).length >= 2,
    },
    { id: 'website', label: 'Website URL', weight: 5, check: s => !!s.website },
    {
      id: 'businessHours',
      label: 'Business hours',
      weight: 10,
      check: s => s.businessHours && Object.keys(s.businessHours).length > 0,
    },
    {
      id: 'faqs',
      label: 'FAQ section (3+ questions)',
      weight: 15,
      check: s => Array.isArray(s.faqs) && s.faqs.length >= 3,
    },
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
      const isComplete = criterion.check(supplier);
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
   * Render circular progress ring SVG
   * @param {number} percentage - Health score percentage (0-100)
   * @param {string} color - Ring color
   * @returns {string} - SVG HTML
   */
  function renderProgressRing(percentage, color) {
    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    return `
      <svg class="progress-ring" width="120" height="120" aria-hidden="true">
        <circle
          class="progress-ring-background"
          cx="60"
          cy="60"
          r="${radius}"
        />
        <circle
          class="progress-ring-progress health-${percentage >= 80 ? 'excellent' : percentage >= 60 ? 'good' : 'poor'}"
          cx="60"
          cy="60"
          r="${radius}"
          style="stroke: ${color}; stroke-dashoffset: ${offset};"
        />
      </svg>
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
            <p>Complete your profile to increase visibility</p>
          </div>
        </div>

        <div class="profile-health-score">
          ${renderProgressRing(scoreData.percentage, scoreData.color)}
          <div class="health-score-value" aria-live="polite">
            ${scoreData.percentage}%
            <span class="health-score-label">Complete</span>
          </div>
        </div>

        <div class="health-message health-${scoreData.status}" role="status" aria-live="polite">
          ${scoreData.message}
        </div>

        <ul class="health-checklist" aria-label="Profile completion checklist">
          ${scoreData.completedItems.map(item => renderChecklistItem(item, true)).join('')}
          ${scoreData.incompleteItems.map(item => renderChecklistItem(item, false)).join('')}
        </ul>

        <button 
          class="health-cta" 
          onclick="window.location.href='/supplier/profile-customization'"
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

  // Auto-initialize if data is available
  document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on supplier dashboard
    if (window.location.pathname.includes('dashboard-supplier')) {
      // Wait for supplier data to be loaded by main dashboard script
      // The main script should call ProfileHealthWidget.init() explicitly
    }
  });
})();
