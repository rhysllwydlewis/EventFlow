/**
 * Admin Exports Page — Initializer
 *
 * Wires up the three export buttons on /admin-exports:
 *   - Users CSV       → GET /api/v1/admin/users-export
 *   - Marketing CSV   → GET /api/v1/admin/marketing-export
 *   - Full JSON       → GET /api/v1/admin/export/all  (with confirmation)
 *
 * Uses AdminShared helpers for confirmation modals, toast notifications, and
 * the Back-to-Dashboard button so behaviour is consistent with other admin pages.
 */

(function () {
  'use strict';

  // Mapping from data-export attribute → { label, url, fileType, confirmRequired }
  const EXPORTS = {
    'users-csv': {
      label: 'Users CSV',
      url: '/api/v1/admin/users-export',
      fileType: 'CSV',
      confirmRequired: false,
      metaId: 'usersExportMeta',
      metaText: 'All registered users.',
    },
    'marketing-csv': {
      label: 'Marketing Contacts CSV',
      url: '/api/v1/admin/marketing-export',
      fileType: 'CSV',
      confirmRequired: false,
      metaId: 'marketingExportMeta',
      metaText: 'Users with marketing opt-in only.',
    },
    'all-json': {
      label: 'Full Platform Export',
      url: '/api/v1/admin/export/all',
      fileType: 'JSON',
      confirmRequired: true,
      metaId: 'fullExportMeta',
      metaText: '⚠️ This export can be large and may take a moment to generate.',
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    initBackButton();
    initMetaTexts();
    initExportButtons();
  });

  function initBackButton() {
    const btn = document.getElementById('backToDashboard');
    if (btn) {
      btn.addEventListener('click', () => {
        window.location.href = '/admin';
      });
    }
  }

  function initMetaTexts() {
    Object.keys(EXPORTS).forEach(key => {
      const cfg = EXPORTS[key];
      const el = document.getElementById(cfg.metaId);
      if (el) {
        el.textContent = cfg.metaText;
      }
    });
  }

  function initExportButtons() {
    const buttons = document.querySelectorAll('.export-btn[data-export]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-export');
        const cfg = EXPORTS[key];
        if (!cfg) {
          return;
        }

        if (cfg.confirmRequired) {
          triggerWithConfirm(btn, cfg);
        } else {
          triggerDownload(btn, cfg);
        }
      });
    });
  }

  function triggerWithConfirm(btn, cfg) {
    if (typeof AdminShared === 'undefined' || typeof AdminShared.confirm !== 'function') {
      // AdminShared is loaded synchronously before this script; if it's missing
      // something is seriously wrong — disable the button to prevent an unconfirmed download.
      btn.disabled = true;
      btn.textContent = 'Unavailable (page error)';
      showToast('Unable to confirm export — please reload the page.', 'error');
      return;
    }

    AdminShared.confirm(
      'This will export ALL platform data (users, suppliers, packages, events, messages).\n\nThis file may be large. Continue?'
    ).then(confirmed => {
      if (confirmed) {
        triggerDownload(btn, cfg);
      }
    });
  }

  function triggerDownload(btn, cfg) {
    btn.disabled = true;
    btn.textContent = 'Downloading…';

    showToast(`Starting ${cfg.label} download…`, 'info');

    // Navigate to the export URL — the browser will handle the file download
    window.location.href = cfg.url;

    // Re-enable after a short delay to allow repeat downloads
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = `<span class="export-btn-icon" aria-hidden="true">⬇️</span> Download ${cfg.fileType}`;
    }, 3000);
  }

  function showToast(message, type) {
    if (typeof AdminShared !== 'undefined' && typeof AdminShared.showToast === 'function') {
      AdminShared.showToast(message, type || 'info');
    }
  }
})();
