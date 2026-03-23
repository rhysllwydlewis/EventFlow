/**
 * Partner Dashboard — init
 * Loads partner data and renders stats, referral link, referrals list, and transactions.
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) {
      return '—';
    }
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function fmtCredits(n) {
    return typeof n === 'number' ? n.toLocaleString() : '—';
  }

  function toPounds(credits) {
    return `£${((credits || 0) / 100).toFixed(2)}`;
  }

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('partner-toast');
    if (!toast) {
      return;
    }
    toast.textContent = msg;
    toast.className = `partner-toast partner-toast--${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ── Auth guard ────────────────────────────────────────────────────────────────

  async function ensureAuth() {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!res.ok) {
        window.location.replace(
          `/partner?redirect=${encodeURIComponent(window.location.pathname)}`
        );
        return null;
      }
      const data = await res.json();
      const user = data.user || data;
      if (!user || !user.id) {
        window.location.replace('/partner');
        return null;
      }
      // Admins should use the admin partners dashboard, not the partner portal
      if (user.role === 'admin') {
        window.location.replace('/admin-partners');
        return null;
      }
      if (user.role !== 'partner') {
        window.location.replace('/partner');
        return null;
      }
      return user;
    } catch (err) {
      window.location.replace('/partner');
      return null;
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────────

  async function getCsrfToken() {
    // Try the global CSRF token first (set by csrf-handler.js if loaded)
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    // Fall back to fetching a fresh token
    try {
      const r = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        return d.csrfToken || '';
      }
    } catch (_) {
      // Ignore fetch errors
    }
    return '';
  }

  function initLogout() {
    const btn = document.getElementById('partner-logout-btn');
    if (!btn) {
      return;
    }
    btn.addEventListener('click', async () => {
      try {
        const csrfToken = await getCsrfToken();
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRF-Token': csrfToken },
        });
      } catch (_) {
        // Best-effort logout — navigate regardless
      }
      // Clear any stale client-side auth state
      try {
        if (window.AuthStateManager) {
          window.AuthStateManager.logout();
        }
        localStorage.removeItem('user');
        sessionStorage.clear();
      } catch (_) {
        // Ignore storage errors
      }
      window.location.replace('/partner');
    });
  }

  // ── Load partner data ─────────────────────────────────────────────────────────

  async function loadPartnerData() {
    const res = await fetch('/api/v1/partner/me', { credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.disabled) {
        const err = new Error(body.error || 'Your partner account has been disabled.');
        err.disabled = true;
        throw err;
      }
      throw new Error('Failed to load partner data');
    }
    return res.json();
  }

  async function loadReferrals() {
    const res = await fetch('/api/v1/partner/referrals', { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Failed to load referrals');
    }
    return res.json();
  }

  async function loadTransactions() {
    const res = await fetch('/api/v1/partner/transactions', { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Failed to load transactions');
    }
    return res.json();
  }

  // ── Render stats ──────────────────────────────────────────────────────────────

  function renderStats(credits, referralCount) {
    if (!credits || typeof credits !== 'object') {
      return;
    }
    document.getElementById('stat-balance').textContent = fmtCredits(credits.balance);
    document.getElementById('stat-balance-gbp').textContent = toPounds(credits.balance);
    document.getElementById('stat-pending').textContent = fmtCredits(credits.pendingPoints || 0);
    document.getElementById('stat-earned').textContent = fmtCredits(credits.totalEarned);
    document.getElementById('stat-pkg-bonus').textContent = fmtCredits(credits.packageBonusTotal);
    document.getElementById('stat-sub-bonus').textContent = fmtCredits(
      credits.subscriptionBonusTotal
    );
    document.getElementById('stat-referrals').textContent = fmtCredits(referralCount);
  }

  // ── Render referrals ──────────────────────────────────────────────────────────

  function renderReferrals(referrals) {
    const container = document.getElementById('referrals-container');
    if (!container) {
      return;
    }

    if (!referrals || referrals.length === 0) {
      container.innerHTML = `
        <div class="partner-empty">
          <div class="partner-empty-icon" aria-hidden="true">🔗</div>
          <p class="partner-empty-text">No referred suppliers yet. Share your link to get started!</p>
        </div>`;
      return;
    }

    const rows = referrals.map(r => {
      const withinWindow = r.withinWindow;
      const windowLabel = withinWindow
        ? `<span class="p-badge p-badge--success">Active window</span>`
        : `<span class="p-badge p-badge--inactive">Expired</span>`;

      const pkgStatus = r.packageQualified
        ? `<span class="p-badge p-badge--success">✓ Package bonus</span>`
        : withinWindow
          ? `<span class="p-badge p-badge--pending">Pending</span>`
          : `<span class="p-badge p-badge--inactive">—</span>`;

      const subStatus = r.subscriptionQualified
        ? `<span class="p-badge p-badge--success">✓ Sub bonus</span>`
        : withinWindow
          ? `<span class="p-badge p-badge--pending">Pending</span>`
          : `<span class="p-badge p-badge--inactive">—</span>`;

      return `<tr>
        <td>${esc(r.supplierName || '—')}</td>
        <td>${fmtDate(r.signedUpAt)}</td>
        <td>${windowLabel}</td>
        <td>${pkgStatus}</td>
        <td>${subStatus}</td>
      </tr>`;
    });

    container.innerHTML = `
      <div class="partner-table-wrap">
        <table class="partner-table" aria-label="Referred suppliers">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Signed Up</th>
              <th>Window</th>
              <th>Package Bonus</th>
              <th>Sub Bonus</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
  }

  // ── Render transactions ───────────────────────────────────────────────────────

  function renderTransactions(txns) {
    const container = document.getElementById('transactions-container');
    if (!container) {
      return;
    }

    if (!txns || txns.length === 0) {
      container.innerHTML = `
        <div class="partner-empty">
          <div class="partner-empty-icon" aria-hidden="true">💸</div>
          <p class="partner-empty-text">No credit activity yet.</p>
        </div>`;
      return;
    }

    const typeLabels = {
      PACKAGE_BONUS: { label: 'Package Bonus', icon: '📦' },
      SUBSCRIPTION_BONUS: { label: 'Subscription Bonus', icon: '💳' },
      ADJUSTMENT: { label: 'Admin Adjustment', icon: '⚙️' },
      REDEEM: { label: 'Redemption', icon: '🎁' },
    };

    const rows = txns.slice(0, 50).map(t => {
      const meta = typeLabels[t.type] || { label: t.type, icon: '•' };
      const amtClass = t.amount >= 0 ? 'color:#6ee7b7' : 'color:#fca5a5';
      const amtStr = t.amount >= 0 ? `+${t.amount}` : `${t.amount}`;
      return `<tr>
        <td>${esc(meta.icon)} ${esc(meta.label)}</td>
        <td style="${amtClass};font-weight:700;">${amtStr} credits</td>
        <td style="color:rgba(255,255,255,0.45)">${toPounds(Math.abs(t.amount))}</td>
        <td>${fmtDate(t.createdAt)}</td>
        <td style="color:rgba(255,255,255,0.4);font-size:0.78rem;">${esc(t.notes || '')}</td>
      </tr>`;
    });

    container.innerHTML = `
      <div class="partner-table-wrap">
        <table class="partner-table" aria-label="Credit transactions">
          <thead>
            <tr>
              <th>Type</th>
              <th>Credits</th>
              <th>Value</th>
              <th>Date</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
  }

  // ── Referral link copy ────────────────────────────────────────────────────────

  function initCopyButton(refLink) {
    const btn = document.getElementById('partner-copy-btn');
    const copyText = document.getElementById('copy-btn-text');
    if (!btn || !copyText) {
      return;
    }

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(refLink);
        btn.classList.add('copied');
        copyText.textContent = '✓ Copied!';
        showToast('Referral link copied to clipboard!', 'success');
        setTimeout(() => {
          btn.classList.remove('copied');
          copyText.textContent = 'Copy link';
        }, 2000);
      } catch (_) {
        // Fallback for browsers without clipboard API
        const ta = document.createElement('textarea');
        ta.value = refLink;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Referral link copied!', 'success');
      }
    });
  }

  // ── Code history ──────────────────────────────────────────────────────────────

  async function loadCodeHistory() {
    const res = await fetch('/api/v1/partner/code-history', { credentials: 'include' });
    if (!res.ok) {
      throw new Error('Failed to load code history');
    }
    return res.json();
  }

  function renderCodeHistory(historyItems) {
    const container = document.getElementById('code-history-container');
    if (!container) {
      return;
    }

    if (!historyItems || historyItems.length === 0) {
      container.innerHTML =
        '<p class="partner-empty-text" style="color:rgba(255,255,255,0.35);font-size:0.82rem;">' +
        'No previous codes — your current code has never been regenerated.</p>';
      return;
    }

    // Show archived codes in a table (oldest first)
    const rows = historyItems.map(h => `<tr>
      <td><code style="font-family:monospace;color:#a5b4fc;">${esc(h.refCode)}</code></td>
      <td style="color:rgba(255,255,255,0.5);">${fmtDate(h.archivedAt)}</td>
      <td><span class="p-badge p-badge--inactive" style="font-size:0.72rem;">Archived (still valid)</span></td>
    </tr>`);

    container.innerHTML = `
      <div class="partner-table-wrap">
        <table class="partner-table" aria-label="Partner code history">
          <thead>
            <tr>
              <th>Old Code</th>
              <th>Archived On</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
  }

  // ── Code regeneration ─────────────────────────────────────────────────────────

  function initRegenButton(partner, onRegenerated) {
    const btn = document.getElementById('partner-regen-btn');
    if (!btn) {
      return;
    }

    btn.addEventListener('click', async () => {
      if (
        !confirm(
          'Are you sure you want to generate a new partner code?\n\nYour old code will still work — this just creates a new one.'
        )
      ) {
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Regenerating…';

      try {
        const csrfToken = await getCsrfToken();
        const res = await fetch('/api/v1/partner/regenerate-code', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({}),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to regenerate code');
        }

        const data = await res.json();
        showToast('New code generated! Old code still works.', 'success');

        // Notify parent to refresh partner data
        if (typeof onRegenerated === 'function') {
          onRegenerated(data);
        }
      } catch (err) {
        showToast(err.message || 'Failed to regenerate code', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Regenerate code';
      }
    });
  }

  // ── Support ticket modal ──────────────────────────────────────────────────────

  function initSupportTicketModal() {
    const overlay = document.getElementById('support-modal-overlay');
    const openBtn = document.getElementById('partner-support-btn');
    const cancelBtn = document.getElementById('support-modal-cancel');
    const form = document.getElementById('support-ticket-form');
    const statusEl = document.getElementById('support-modal-status');
    const submitBtn = document.getElementById('support-modal-submit');

    if (!overlay || !openBtn) {
      return;
    }

    function openModal() {
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'partner-status';
      }
      if (form) {
        form.reset();
      }
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    openBtn.addEventListener('click', openModal);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeModal);
    }
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (statusEl) {
          statusEl.textContent = '';
        }

        const subjectInput = document.getElementById('support-subject');
        const messageInput = document.getElementById('support-message');

        const subject = subjectInput ? subjectInput.value.trim() : '';
        const message = messageInput ? messageInput.value.trim() : '';

        if (!subject) {
          if (statusEl) {
            statusEl.textContent = 'Please enter a subject.';
            statusEl.className = 'partner-status partner-status--error';
          }
          return;
        }
        if (!message) {
          if (statusEl) {
            statusEl.textContent = 'Please enter a message.';
            statusEl.className = 'partner-status partner-status--error';
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending…';
        }

        try {
          const csrfToken = await getCsrfToken();
          const res = await fetch('/api/v1/partner/support-ticket', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ subject, message }),
          });

          const body = await res.json().catch(() => ({}));

          if (!res.ok) {
            throw new Error(body.error || 'Failed to submit ticket');
          }

          closeModal();
          showToast('Support ticket submitted! Our team will be in touch.', 'success');
        } catch (err) {
          if (statusEl) {
            statusEl.textContent = err.message || 'Failed to submit ticket.';
            statusEl.className = 'partner-status partner-status--error';
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send ticket';
          }
        }
      });
    }
  }

  // ── Main ──────────────────────────────────────────────────────────────────────

  async function init() {
    initLogout();

    const user = await ensureAuth();
    if (!user) {
      return;
    }

    // Show user name in header
    const nameEl = document.getElementById('partner-user-name');
    if (nameEl) {
      nameEl.textContent = user.name || user.email || '';
    }

    const nameHeading = document.getElementById('partner-name-heading');

    async function loadAll() {
      const [partnerData, referralsData, txnsData, codeHistoryData] = await Promise.all([
        loadPartnerData(),
        loadReferrals(),
        loadTransactions(),
        loadCodeHistory(),
      ]);
      return { partnerData, referralsData, txnsData, codeHistoryData };
    }

    try {
      const { partnerData, referralsData, txnsData, codeHistoryData } = await loadAll();

      const { partner, credits } = partnerData;
      const referrals = referralsData.items || [];
      const transactions = txnsData.items || [];
      const codeHistory = codeHistoryData.items || [];

      // Update heading
      if (nameHeading) {
        nameHeading.textContent = user.firstName || (user.name || '').split(' ')[0] || 'Partner';
      }

      // Update status line
      const statusLine = document.getElementById('partner-status-line');
      if (statusLine) {
        statusLine.textContent =
          partner.status === 'active'
            ? 'Your partner account is active'
            : '⚠️ Your account is currently disabled — contact support';
        if (partner.status !== 'active') {
          statusLine.style.color = '#fca5a5';
        }
      }

      // Render stats
      renderStats(credits, referrals.length);

      // Referral link
      const refLinkEl = document.getElementById('partner-ref-link');
      const refCodeBadge = document.getElementById('partner-ref-code-badge');
      if (refLinkEl) {
        refLinkEl.textContent = partner.refLink;
      }
      if (refCodeBadge) {
        refCodeBadge.textContent = partner.refCode;
      }
      initCopyButton(partner.refLink);

      // Code management
      const codeDisplay = document.getElementById('partner-code-display');
      if (codeDisplay) {
        codeDisplay.textContent = partner.refCode;
      }
      renderCodeHistory(codeHistory);
      initRegenButton(partner, async data => {
        // On successful regeneration, reload to reflect the new code everywhere
        const refLinkBox = document.getElementById('partner-ref-link');
        if (refLinkBox) {
          refLinkBox.textContent = data.refLink || '';
        }
        if (refCodeBadge) {
          refCodeBadge.textContent = data.newCode || '';
        }
        if (codeDisplay) {
          codeDisplay.textContent = data.newCode || '';
        }
        // Reload code history
        try {
          const fresh = await loadCodeHistory();
          renderCodeHistory(fresh.items || []);
        } catch (_) {
          // Non-blocking
        }
      });

      // Support ticket modal
      initSupportTicketModal();

      // Referrals & transactions
      renderReferrals(referrals);
      renderTransactions(transactions);
    } catch (err) {
      console.error('Dashboard load error:', err);
      const statusLine = document.getElementById('partner-status-line');
      if (err.disabled) {
        // Account disabled — show prominent message
        if (statusLine) {
          statusLine.textContent = err.message;
          statusLine.style.color = '#fca5a5';
        }
        if (nameHeading) {
          nameHeading.textContent = 'Account Disabled';
        }
        const containers = ['referrals-container', 'transactions-container', 'code-history-container'];
        containers.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.innerHTML = `
              <div class="partner-empty">
                <div class="partner-empty-icon" aria-hidden="true">🚫</div>
                <p class="partner-empty-text">Your partner account has been disabled. Please contact support to resolve this.</p>
              </div>`;
          }
        });
        return;
      }
      if (statusLine) {
        statusLine.textContent = 'Error loading dashboard data. Please refresh.';
        statusLine.style.color = '#fca5a5';
      }
      if (nameHeading) {
        nameHeading.textContent = 'Partner';
      }
      // Show retry button and clear loading placeholders
      const containers = ['referrals-container', 'transactions-container'];
      containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.innerHTML = `
            <div class="partner-empty">
              <div class="partner-empty-icon" aria-hidden="true">⚠️</div>
              <p class="partner-empty-text">Failed to load data.</p>
              <button type="button" class="partner-retry-btn" onclick="window.location.reload()" style="margin-top:0.75rem;padding:0.45rem 1rem;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:8px;color:#6ee7b7;cursor:pointer;font-size:0.85rem;">
                Retry
              </button>
            </div>`;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
