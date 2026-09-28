/**
 * Site-wide Announcement Banner
 * Version: 1.0.0
 *
 * Renders the announcements admin-content.html's "Announcements" tab
 * manages (as opposed to the "Quick Notify" half of that tab, which pushes
 * a one-off in-app bell notification through the existing notification
 * system and is unrelated to this file). Fetches the public, unauthenticated
 * GET /api/v1/announcements endpoint and, for each active announcement not
 * already dismissed on this device, prepends a dismissible bar to the very
 * top of <body> — ahead of the sticky header, so it pushes the page down
 * rather than overlapping it.
 *
 * Dismissal is per-announcement-id and stored in localStorage only (a
 * per-visitor convenience, not shared or read back by the admin).
 */

'use strict';
(function () {
  const DISMISSED_KEY = 'ef_dismissed_announcements';
  const TYPE_META = {
    info: { icon: 'ℹ️', className: 'ef-announcement-banner--info' },
    warning: { icon: '⚠️', className: 'ef-announcement-banner--warning' },
    success: { icon: '✅', className: 'ef-announcement-banner--success' },
    maintenance: { icon: '🔧', className: 'ef-announcement-banner--maintenance' },
    urgent: { icon: '🚨', className: 'ef-announcement-banner--urgent' },
  };

  function getDismissed() {
    try {
      const raw = window.localStorage.getItem(DISMISSED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function addDismissed(id) {
    try {
      const dismissed = getDismissed();
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
      }
    } catch {
      // localStorage unavailable (private browsing, blocked, etc.) — the
      // banner just reappears next load, which is an acceptable fallback.
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text === null || text === undefined ? '' : String(text);
    return div.innerHTML;
  }

  function renderBanner(announcement) {
    const meta = TYPE_META[announcement.type] || TYPE_META.info;
    const bar = document.createElement('div');
    bar.className = `ef-announcement-banner ${meta.className}`;
    bar.setAttribute('role', 'status');
    bar.dataset.announcementId = announcement.id;
    bar.innerHTML = `
      <div class="ef-announcement-banner__inner">
        <span class="ef-announcement-banner__icon" aria-hidden="true">${meta.icon}</span>
        <span class="ef-announcement-banner__message">${escapeHtml(announcement.message)}</span>
        <button type="button" class="ef-announcement-banner__close" aria-label="Dismiss announcement">&times;</button>
      </div>
    `;
    bar.querySelector('.ef-announcement-banner__close').addEventListener('click', () => {
      addDismissed(announcement.id);
      bar.remove();
    });
    document.body.insertBefore(bar, document.body.firstChild);
  }

  async function init() {
    let data = null;
    try {
      const response = await fetch('/api/v1/announcements', { credentials: 'omit' });
      if (!response.ok) {
        return;
      }
      data = await response.json();
    } catch {
      // A failed check is not worth surfacing to visitors — just skip the banner.
      return;
    }

    const announcements = Array.isArray(data.announcements) ? data.announcements : [];
    if (!announcements.length) {
      return;
    }

    const dismissed = getDismissed();
    announcements.filter(a => a?.id && !dismissed.includes(a.id)).forEach(renderBanner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
