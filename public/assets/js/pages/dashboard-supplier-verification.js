(function () {
  function esc(unsafe) {
    if (!unsafe) {
      return '';
    }
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatVerifState(state) {
    const map = {
      unverified: { label: 'Not Yet Submitted', cls: 'unverified', icon: '🕐' },
      pending_review: { label: 'Under Review', cls: 'pending', icon: '🔍' },
      needs_changes: { label: 'Changes Required', cls: 'warning', icon: '⚠️' },
      approved: { label: 'Approved', cls: 'approved', icon: '✅' },
      rejected: { label: 'Application Not Approved', cls: 'rejected', icon: '❌' },
      suspended: { label: 'Account Suspended', cls: 'suspended', icon: '🚫' },
    };
    return map[state] || map.unverified;
  }

  async function loadVerificationBanner() {
    const banner = document.getElementById('verification-status-banner');
    if (!banner) {
      return;
    }
    try {
      const res = await fetch('/api/supplier/verification/status', { credentials: 'include' });
      if (!res.ok) {
        return;
      } // Not a supplier or not logged in — no banner needed
      const data = await res.json();
      const state = data.verificationStatus || 'unverified';

      // Don't show banner for approved suppliers (keep their dashboard clean)
      if (state === 'approved') {
        return;
      }

      const info = formatVerifState(state);
      const BG = {
        unverified: 'rgba(107,114,128,0.08)',
        pending: 'rgba(59,130,246,0.08)',
        warning: 'rgba(245,158,11,0.1)',
        approved: 'rgba(16,185,129,0.08)',
        rejected: 'rgba(239,68,68,0.1)',
        suspended: 'rgba(239,68,68,0.1)',
      };
      const BORDER = {
        unverified: '#9ca3af',
        pending: '#3b82f6',
        warning: '#f59e0b',
        approved: '#10b981',
        rejected: '#ef4444',
        suspended: '#ef4444',
      };
      const notesHtml = data.verificationNotes
        ? `<p style="margin:0.35rem 0 0;font-size:0.85rem;opacity:0.85;">${esc(data.verificationNotes)}</p>`
        : '';

      const ctaHtml =
        state === 'unverified' || state === 'needs_changes' || state === 'rejected'
          ? `<a href="/dashboard-supplier#my-suppliers" style="display:inline-block;margin-top:0.5rem;padding:0.4rem 1rem;background:${BORDER[info.cls]};color:white;border-radius:999px;font-weight:600;font-size:0.85rem;text-decoration:none;">Submit for Verification →</a>`
          : '';

      banner.style.cssText = `display:block;margin-bottom:1rem;padding:1rem 1.25rem;border-radius:12px;border-left:4px solid ${BORDER[info.cls]};background:${BG[info.cls]};`;
      banner.innerHTML = `
            <div style="display:flex;align-items:flex-start;gap:0.75rem;">
              <span style="font-size:1.4rem;flex-shrink:0;">${info.icon}</span>
              <div>
                <strong style="font-size:0.95rem;">Verification Status: ${info.label}</strong>
                ${notesHtml}
                ${ctaHtml}
              </div>
            </div>`;
    } catch (_) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadVerificationBanner);
  } else {
    loadVerificationBanner();
  }
})();
