/**
 * Moderation page: Reviews, Photos and Reports are tabs of one page.
 * Each queue's own script (admin-reviews-init.js and so on) loads its list the first time its tab is
 * opened, and each tab shows how many items are waiting.
 */
'use strict';
(function () {
  const TABS = [
    { name: 'reviews', countKey: 'reviews', start: () => window.AdminReviews?.start() },
    { name: 'photos', countKey: 'photos', start: () => window.AdminPhotos?.start() },
    { name: 'reports', countKey: 'reports', start: () => window.AdminReports?.start() },
  ];

  function showCounts(pending) {
    TABS.forEach(tab => {
      const badge = document.getElementById(
        `tabCount${tab.name[0].toUpperCase()}${tab.name.slice(1)}`
      );
      const count = Number((pending || {})[tab.countKey]) || 0;
      if (!badge) {
        return;
      }
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    });
  }

  function mountTabs() {
    if (!window.AdminTabs) {
      return;
    }
    window.AdminTabs.mount({
      tabs: TABS.map(tab => ({
        name: tab.name,
        button: document.getElementById(`tab-${tab.name}`),
        panel: document.getElementById(`panel-${tab.name}`),
        onShow: tab.start,
      })),
      activeClass: 'admin-tab--active',
      initial: 'reviews',
    });
    // The navbar fetches the waiting counts; show them on the tabs too
    showCounts(window.AdminPendingCounts);
    document.addEventListener('admin:pending-counts', event => showCounts(event.detail));
    document.getElementById('backToDashboard')?.addEventListener('click', () => {
      window.location.href = '/admin';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTabs);
  } else {
    mountTabs();
  }
})();
