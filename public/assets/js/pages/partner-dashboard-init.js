/**
 * Partner Dashboard — init
 * Loads partner data and renders stats, referral link, referrals list, and transactions.
 */
(function () {
  'use strict';
function escapeHtml(s){if(!s)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}

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

  function toPounds(credits, pointsPerGbp) {
    const rate = Number.isInteger(pointsPerGbp) && pointsPerGbp > 0 ? pointsPerGbp : 100;
    return `£${((credits || 0) / rate).toFixed(2)}`;
  }

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('partner-toast');
    if (!toast) {
      return;
    }
    // Set ARIA role: 'alert' for errors (assertive announcement), 'status' for others
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = msg;
    toast.className = `partner-toast partner-toast--${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ── In-page confirmation dialog ───────────────────────────────────────────────

  function showConfirmDialog(message) {
    return new Promise(resolve => {
      const existing = document.getElementById('_partner_confirm_dialog');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = '_partner_confirm_dialog';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Confirm action');
      overlay.className = 'partner-confirm-overlay';

      overlay.innerHTML = `
        <div style="background:rgba(15,28,35,0.97);border:1px solid rgba(255,255,255,0.14);border-radius:16px;max-width:400px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.5);padding:1.5rem;">
          <p style="margin:0 0 1.25rem;font-size:0.92rem;color:rgba(255,255,255,0.85);line-height:1.55;white-space:pre-line;">${escHtml(message)}</p>
          <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
            <button type="button" id="_partner_confirm_cancel" class="ef-cta partner-confirm-cancel">Cancel</button>
            <button type="button" id="_partner_confirm_ok" class="ef-cta partner-confirm-ok">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const cleanup = val => { overlay.remove(); resolve(val); };
      overlay.querySelector('#_partner_confirm_cancel').addEventListener('click', () => cleanup(false));
      overlay.querySelector('#_partner_confirm_ok').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(false); });
      overlay.querySelector('#_partner_confirm_ok').focus();
    });
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

  function renderStats(credits, referralCount, pointsPerGbp) {
    if (!credits || typeof credits !== 'object') {
      return;
    }
    // Remove skeleton loading state from stats grid
    const statsGrid = document.querySelector('.partner-stats-grid');
    if (statsGrid) {
      statsGrid.removeAttribute('data-loading');
    }
    const available =
      credits.availableBalance !== undefined ? credits.availableBalance : credits.balance;
    const maturing = credits.maturingBalance || 0;
    const potential = credits.pendingPoints || 0;
    document.getElementById('stat-balance').textContent = fmtCredits(available);
    document.getElementById('stat-balance-gbp').textContent = toPounds(available, pointsPerGbp);
    document.getElementById('stat-pending').textContent = fmtCredits(maturing);
    const potentialEl = document.getElementById('stat-potential');
    if (potentialEl) {
      potentialEl.textContent = fmtCredits(potential);
    }
    document.getElementById('stat-earned').textContent = fmtCredits(credits.totalEarned);
    const bonusesEl = document.getElementById('stat-bonuses');
    if (bonusesEl) {
      bonusesEl.textContent = fmtCredits(
        (credits.packageBonusTotal || 0) + (credits.subscriptionBonusTotal || 0)
      );
    }
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

  function renderTransactions(txns, pointsPerGbp) {
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
      REFERRAL_SIGNUP_BONUS: { label: 'Referral Signup', icon: '🔗' },
      FIRST_REVIEW_BONUS: { label: 'First Review Bonus', icon: '⭐' },
      ADJUSTMENT: { label: 'Admin Adjustment', icon: '⚙️' },
      REDEEM: { label: 'Redemption', icon: '🎁' },
      CASHOUT_HOLD: { label: 'Cashout Hold', icon: '🔒' },
      CASHOUT_RELEASE: { label: 'Hold Released', icon: '🔓' },
    };

    const rows = txns.slice(0, 50).map(t => {
      const meta = typeLabels[t.type] || { label: t.type, icon: '•' };
      const amtClass = t.amount >= 0 ? 'color:#6ee7b7' : 'color:#fca5a5';
      const amtStr = t.amount >= 0 ? `+${t.amount}` : `${t.amount}`;
      return `<tr>
        <td>${esc(meta.icon)} ${esc(meta.label)}</td>
        <td style="${amtClass};font-weight:700;">${amtStr} points</td>
        <td style="color:rgba(255,255,255,0.45)">${toPounds(Math.abs(t.amount), pointsPerGbp)}</td>
        <td>${fmtDate(t.createdAt)}</td>
        <td style="color:rgba(255,255,255,0.4);font-size:0.78rem;">${esc(t.notes || '')}</td>
      </tr>`;
    });

    container.innerHTML = `
      <div class="partner-table-wrap">
        <table class="partner-table" aria-label="Point transactions">
          <thead>
            <tr>
              <th>Type</th>
              <th>Points</th>
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

  // ── Referral code badge copy ──────────────────────────────────────────────────

  function initRefCodeCopy(refCode) {
    const badge = document.getElementById('partner-ref-code-badge');
    if (!badge || !refCode) {
      return;
    }

    async function copyCode() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(refCode);
        } else {
          // Fallback for older browsers
          const ta = document.createElement('textarea');
          ta.value = refCode;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast('Partner code copied!', 'success');
      } catch (err) {
        console.error('Failed to copy partner code:', err);
        showToast('Could not copy — please copy the code manually.', 'error');
      }
    }

    badge.addEventListener('click', copyCode);
    badge.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyCode();
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
    const rows = historyItems.map(
      h => `<tr>
      <td><code style="font-family:monospace;color:#a5b4fc;">${esc(h.refCode)}</code></td>
      <td style="color:rgba(255,255,255,0.5);">${fmtDate(h.archivedAt)}</td>
      <td><span class="p-badge p-badge--inactive" style="font-size:0.72rem;">Archived (still valid)</span></td>
    </tr>`
    );

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
      const confirmed = await showConfirmDialog(
        'Are you sure you want to generate a new partner code?\n\nYour old code will still work — this just creates a new one.'
      );
      if (!confirmed) {
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
          // Refresh ticket list
          loadAndRenderTickets();
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

  // ── Partner Support Tickets ───────────────────────────────────────────────────

  function getTicketStatusBadge(status) {
    const map = {
      open: { label: 'Open', color: '#6ee7b7', bg: 'rgba(16,185,129,0.15)' },
      in_progress: { label: 'In Progress', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
      resolved: { label: 'Resolved', color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.06)' },
      closed: { label: 'Closed', color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.04)' },
    };
    const s = map[status] || {
      label: status || 'Unknown',
      color: 'rgba(255,255,255,0.4)',
      bg: 'rgba(255,255,255,0.06)',
    };
    return `<span style="display:inline-block;padding:0.2rem 0.6rem;border-radius:100px;font-size:0.75rem;font-weight:600;color:${s.color};background:${s.bg};">${s.label}</span>`;
  }

  async function loadAndRenderTickets() {
    const container = document.getElementById('partner-tickets-container');
    if (!container) {
      return;
    }

    try {
      const res = await fetch('/api/v1/partner/support-tickets', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to load tickets');
      }
      const { items } = await res.json();

      if (!items || items.length === 0) {
        container.innerHTML = `
          <div class="partner-empty">
            <div class="partner-empty-icon" aria-hidden="true">🎫</div>
            <p class="partner-empty-text">No support tickets yet.</p>
            <button
              type="button"
              id="partner-empty-ticket-btn"
              style="margin-top:0.75rem;padding:0.45rem 1.1rem;background:linear-gradient(135deg,rgba(11,128,115,0.3),rgba(16,185,129,0.2));border:1px solid rgba(16,185,129,0.35);border-radius:8px;color:#6ee7b7;cursor:pointer;font-size:0.85rem;font-weight:600;"
              aria-label="Raise a support ticket"
            >✉️ Raise a support ticket</button>
          </div>`;
        const emptyBtn = document.getElementById('partner-empty-ticket-btn');
        if (emptyBtn) {
          emptyBtn.addEventListener('click', () => {
            const openBtn = document.getElementById('partner-support-btn');
            if (openBtn) openBtn.click();
          });
        }
        return;
      }

      const rows = items
        .map(
          t => `
        <div class="partner-ticket-row" tabindex="0" role="button" data-ticket-id="${escHtml(String(t._id || t.id || ''))}" aria-label="View ticket: ${escHtml(t.subject)}">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.9rem;font-weight:600;color:#fff;margin-bottom:0.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.subject)}</div>
            <div style="font-size:0.78rem;color:rgba(255,255,255,0.38);">Opened ${fmtDate(t.createdAt)}${t.responseCount ? ` · ${t.responseCount} response${t.responseCount !== 1 ? 's' : ''}` : ''}</div>
          </div>
          <div style="flex-shrink:0;">${getTicketStatusBadge(t.status)}</div>
        </div>`
        )
        .join('');

      container.innerHTML = `<div style="padding:0 0.25rem;">${rows}</div>`;

      container.querySelectorAll('.partner-ticket-row').forEach(row => {
        const open = () => viewTicket(row.dataset.ticketId);
        row.addEventListener('click', open);
        row.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    } catch (err) {
      container.innerHTML = `
        <div class="partner-empty">
          <div class="partner-empty-icon" aria-hidden="true">⚠️</div>
          <p class="partner-empty-text">Failed to load tickets. Please refresh.</p>
        </div>`;
    }
  }

  async function viewTicket(ticketId) {
    const overlay = document.getElementById('partner-ticket-detail-overlay');
    const body = document.getElementById('partner-ticket-detail-body');
    const titleEl = document.getElementById('partner-ticket-detail-title');
    if (!overlay || !body) return;

    body.innerHTML = `
      <div class="partner-empty">
        <span class="partner-spinner" aria-hidden="true"></span>
        <p class="partner-empty-text">Loading ticket…</p>
      </div>`;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    function closeDetail() {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEsc);
    }

    function handleEsc(e) {
      if (e.key === 'Escape') closeDetail();
    }

    const closeBtn = document.getElementById('partner-ticket-detail-close');
    if (closeBtn) {
      closeBtn.onclick = closeDetail;
    }
    overlay.onclick = e => { if (e.target === overlay) closeDetail(); };

    document.addEventListener('keydown', handleEsc);

    try {
      const r = await fetch('/api/v1/tickets/' + encodeURIComponent(ticketId), { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const ticket = d.ticket || d;
      const replies = ticket.replies || [];

      if (titleEl) titleEl.textContent = ticket.subject || 'Support Ticket';

      const replyItems = replies.map(reply => {
        const isStaff = reply.isStaff || reply.authorRole === 'admin';
        return `
          <div class="partner-reply-item ${isStaff ? 'partner-reply-item--staff' : 'partner-reply-item--user'}">
            <div class="partner-reply-meta">${isStaff ? '🛡 EventFlow Support' : '👤 You'} &nbsp;·&nbsp; ${fmtDate(reply.createdAt)}</div>
            <div style="white-space:pre-wrap;color:rgba(255,255,255,0.8);">${escHtml(reply.message || reply.content || '')}</div>
          </div>`;
      }).join('');

      const replyForm = ticket.status !== 'closed' ? `
        <div class="partner-reply-form">
          <p class="partner-reply-label">Add a reply</p>
          <textarea
            id="partner-reply-message"
            class="partner-reply-textarea"
            rows="3"
            placeholder="Type your reply…"
            maxlength="5000"
            aria-label="Your reply"
          ></textarea>
          <button
            type="button"
            class="ef-cta partner-reply-submit"
            id="partner-reply-submit"
            data-ticket-id="${escHtml(String(ticket._id || ticket.id))}"
          >Send Reply</button>
          <span id="partner-reply-status" role="status" aria-live="polite" style="font-size:0.8rem;margin-top:0.25rem;"></span>
        </div>` : '<p style="color:rgba(255,255,255,0.35);font-size:0.875rem;margin-top:1rem;">This ticket is closed.</p>';

      body.innerHTML = `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.4);margin-bottom:0.75rem;">
          Status: <strong style="color:#fff;">${escHtml(ticket.status || 'open')}</strong>
          &nbsp;·&nbsp; Opened ${fmtDate(ticket.createdAt)}
        </div>
        <div class="partner-ticket-message-box">${escHtml(ticket.message || '')}</div>
        ${replies.length ? `<div class="partner-reply-thread">${replyItems}</div>` : ''}
        ${replyForm}
      `;

      const sendBtn = body.querySelector('#partner-reply-submit');
      if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
          const textarea = body.querySelector('#partner-reply-message');
          const statusEl = body.querySelector('#partner-reply-status');
          const msg = textarea ? textarea.value.trim() : '';
          if (!msg) {
            if (statusEl) { statusEl.textContent = 'Please enter a reply.'; statusEl.style.color = '#ef4444'; }
            return;
          }
          sendBtn.disabled = true;
          sendBtn.textContent = 'Sending…';
          if (statusEl) statusEl.textContent = '';
          try {
            const csrfToken = await getCsrfToken();
            const rr = await fetch(
              '/api/v1/tickets/' + encodeURIComponent(sendBtn.dataset.ticketId) + '/reply',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                credentials: 'include',
                body: JSON.stringify({ message: msg }),
              }
            );
            if (!rr.ok) throw new Error('HTTP ' + rr.status);
            if (statusEl) { statusEl.textContent = '✓ Reply sent'; statusEl.style.color = '#10b981'; }
            if (textarea) textarea.value = '';
            setTimeout(() => viewTicket(sendBtn.dataset.ticketId), 800);
          } catch (err) {
            if (statusEl) { statusEl.textContent = '✗ Failed: ' + err.message; statusEl.style.color = '#ef4444'; }
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Reply';
          }
        });
      }
    } catch (err) {
      body.innerHTML = `<div style="color:#ef4444;padding:1rem;">Failed to load ticket: ${escHtml(err.message)}</div>`;
    }
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Cashout Requests ──────────────────────────────────────────────────────────

  const CASHOUT_STATUS_MAP = {
    submitted: { label: 'Submitted', color: '#93c5fd', bg: 'rgba(59,130,246,0.15)' },
    approved: { label: 'Approved', color: '#6ee7b7', bg: 'rgba(16,185,129,0.15)' },
    processing: { label: 'Processing', color: '#fcd34d', bg: 'rgba(245,158,11,0.15)' },
    delivered: { label: 'Delivered', color: '#86efac', bg: 'rgba(34,197,94,0.18)' },
    rejected: { label: 'Rejected', color: '#fca5a5', bg: 'rgba(239,68,68,0.12)' },
  };

  function getCashoutStatusBadge(status) {
    const s = CASHOUT_STATUS_MAP[status] || {
      label: status || 'Unknown',
      color: 'rgba(255,255,255,0.4)',
      bg: 'rgba(255,255,255,0.06)',
    };
    return `<span style="display:inline-block;padding:0.18rem 0.55rem;border-radius:100px;font-size:0.72rem;font-weight:600;color:${s.color};background:${s.bg};">${escHtml(s.label)}</span>`;
  }

  async function loadCashoutHistory() {
    const container = document.getElementById('cashout-history-container');
    if (!container) {
      return;
    }

    try {
      const res = await fetch('/api/v1/partner/cashout-requests', { credentials: 'include' });
      if (!res.ok) {
        throw new Error('Failed to load cashout history');
      }
      const { items } = await res.json();

      if (!items || items.length === 0) {
        container.innerHTML = `
          <div class="partner-empty">
            <div class="partner-empty-icon" aria-hidden="true">💸</div>
            <p class="partner-empty-text">No cashout requests yet — submit your first one above!</p>
          </div>`;
        return;
      }

      const rows = items
        .map(r => {
          const methodLabel =
            r.method === 'amazon_voucher'
              ? 'Amazon Voucher'
              : r.method === 'prepaid_debit_card'
                ? 'Pre-Paid Debit Card'
                : escHtml(r.method || '');
          const deliveryNote =
            r.status === 'submitted' || r.status === 'approved' || r.status === 'processing'
              ? '<span style="font-size:0.75rem;opacity:0.6;"> · Est. 3–5 working days</span>'
              : '';
          const adminMsg = r.adminResponseMessage
            ? `<div class="cashout-history-admin-msg">💬 ${escHtml(r.adminResponseMessage)}</div>`
            : '';
          return `
          <div class="cashout-history-row">
            <div class="cashout-history-info">
              <div class="cashout-history-recipient"><strong>£${escHtml(String(r.denominationGbp))}</strong> — ${escHtml(methodLabel)}</div>
              <div class="cashout-history-meta">
                ${fmtDate(r.createdAt)}${deliveryNote}
                ${r.deliveredAt ? ` · Delivered ${fmtDate(r.deliveredAt)}` : ''}
              </div>
              ${adminMsg}
            </div>
            <div class="cashout-history-actions">
              ${getCashoutStatusBadge(r.status)}
            </div>
          </div>`;
        })
        .join('');

      container.innerHTML = `<div class="cashout-history-list">${rows}</div>`;
    } catch (err) {
      container.innerHTML = `
        <div class="partner-empty">
          <div class="partner-empty-icon" aria-hidden="true">⚠️</div>
          <p class="partner-empty-text">Failed to load cashout history. Please refresh.</p>
        </div>`;
    }
  }

  function initCashoutSection(credits, pointsPerGbp) {
    const insufficientEl = document.getElementById('cashout-insufficient');
    const formWrap = document.getElementById('cashout-form-wrap');
    const confirmationEl = document.getElementById('cashout-confirmation');

    if (!formWrap) {
      return;
    }

    const rate = Number.isInteger(pointsPerGbp) && pointsPerGbp > 0 ? pointsPerGbp : 100;
    const MIN_DENOM = 15;
    const STEP = 5;

    const availBal = credits
      ? credits.availableBalance !== undefined
        ? credits.availableBalance
        : credits.balance || 0
      : 0;
    const availGbp = Math.floor(availBal / rate);
    const maxDenom = Math.floor(availGbp / STEP) * STEP;

    // Update balance hint
    const balancePtsEl = document.getElementById('cashout-balance-pts');
    const balanceGbpEl = document.getElementById('cashout-balance-gbp');
    if (balancePtsEl) {
      balancePtsEl.textContent = availBal.toLocaleString();
    }
    if (balanceGbpEl) {
      balanceGbpEl.textContent = toPounds(availBal, rate);
    }

    // Insufficient balance?
    if (availGbp < MIN_DENOM) {
      if (insufficientEl) {
        insufficientEl.style.display = 'flex';
        const msgEl = document.getElementById('cashout-avail-gbp-msg');
        if (msgEl) {
          msgEl.textContent = toPounds(availBal, rate);
        }
      }
      return; // Don't show the form
    }

    // Populate denomination dropdown
    const denomSelect = document.getElementById('cashout-denomination');
    if (denomSelect) {
      denomSelect.innerHTML = '<option value="">Select an amount…</option>';
      for (let d = MIN_DENOM; d <= maxDenom; d += STEP) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `£${d}`;
        denomSelect.appendChild(opt);
      }
    }

    formWrap.style.display = 'block';

    const form = document.getElementById('cashout-form');
    const statusEl = document.getElementById('cashout-status');
    const submitBtn = document.getElementById('cashout-submit-btn');
    const confirmMsgEl = document.getElementById('cashout-confirmation-msg');
    const newBtn = document.getElementById('cashout-new-btn');

    if (newBtn) {
      newBtn.addEventListener('click', () => {
        if (confirmationEl) {
          confirmationEl.style.display = 'none';
        }
        formWrap.style.display = 'block';
        if (form) {
          form.reset();
        }
        if (denomSelect) {
          denomSelect.innerHTML = '<option value="">Select an amount…</option>';
          for (let d = MIN_DENOM; d <= maxDenom; d += STEP) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = `£${d}`;
            denomSelect.appendChild(opt);
          }
        }
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.className = 'partner-status';
        }
      });
    }

    if (!form) {
      return;
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'partner-status';
      }

      const method = ((form.elements['method'] || {}).value || '').trim();
      const denominationGbp = parseInt((form.elements['denominationGbp'] || {}).value || '', 10);
      const partnerMessage = ((form.elements['partnerMessage'] || {}).value || '').trim();

      if (!method) {
        if (statusEl) {
          statusEl.textContent = 'Please select a payout method.';
          statusEl.className = 'partner-status partner-status--error';
        }
        return;
      }
      if (!denominationGbp || isNaN(denominationGbp)) {
        if (statusEl) {
          statusEl.textContent = 'Please select an amount.';
          statusEl.className = 'partner-status partner-status--error';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
      }

      try {
        const csrfToken = await getCsrfToken();
        const res = await fetch('/api/v1/partner/cashout-requests', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({
            method,
            denominationGbp,
            partnerMessage: partnerMessage || undefined,
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || 'Failed to submit cashout request');
        }

        const methodLabel = method === 'amazon_voucher' ? 'Amazon Voucher' : 'Pre-Paid Debit Card';
        formWrap.style.display = 'none';
        if (confirmationEl) {
          confirmationEl.style.display = 'block';
        }
        if (confirmMsgEl) {
          confirmMsgEl.innerHTML = `Request for <strong>£${escHtml(String(denominationGbp))}</strong> via <strong>${escHtml(methodLabel)}</strong> submitted. Ref: <code style="font-family:monospace;font-size:0.8em;">${escHtml(body.cashoutRequestId || '')}</code><br>Typically processed within <strong>3–5 working days</strong>.`;
        }
        loadCashoutHistory();
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err.message || 'Failed to submit request.';
          statusEl.className = 'partner-status partner-status--error';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '💸 Submit Cashout Request';
        }
      }
    });
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
      const pointsPerGbp = partnerData.pointsPerGbp || 100;
      const referrals = referralsData.items || [];
      const transactions = txnsData.items || [];
      const codeHistory = codeHistoryData.items || [];

      // Update heading with time-based greeting
      if (nameHeading) {
        nameHeading.textContent = user.firstName || (user.name || '').split(' ')[0] || 'Partner';
      }
      const greetingTimeEl = document.getElementById('partner-greeting-time');
      if (greetingTimeEl) {
        const hour = new Date().getHours();
        greetingTimeEl.textContent =
          hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
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
      renderStats(credits, referrals.length, pointsPerGbp);

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

      // Copy referral code badge
      initRefCodeCopy(partner.refCode);

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

      // Load and render partner's own tickets
      loadAndRenderTickets();

      // Cashout request section
      initCashoutSection(credits, pointsPerGbp);

      // Cashout request history
      loadCashoutHistory();

      // Referrals & transactions
      renderReferrals(referrals);
      renderTransactions(transactions, pointsPerGbp);
    } catch (err) {
      console.error('Dashboard load error:', err);

      // Remove skeleton state so stats grid doesn't hang in loading animation
      const statsGrid = document.querySelector('.partner-stats-grid');
      if (statsGrid) {
        statsGrid.removeAttribute('data-loading');
      }

      const statusLine = document.getElementById('partner-status-line');
      if (err.disabled) {
        // Account disabled — show the dedicated disabled panel with next steps
        const disabledPanel = document.getElementById('partner-disabled-panel');
        const disabledMsg = document.getElementById('partner-disabled-msg');
        const disabledSupportLink = document.getElementById('partner-disabled-support-link');

        if (disabledPanel) {
          if (disabledMsg) {
            disabledMsg.textContent =
              err.message || 'Your partner account has been disabled.';
          }
          disabledPanel.removeAttribute('hidden');
        }

        if (nameHeading) {
          nameHeading.textContent = 'Account Disabled';
        }
        if (statusLine) {
          statusLine.textContent = 'Contact support to resolve this.';
          statusLine.style.color = '#fca5a5';
        }

        // Wire up the support link inside the disabled panel to open the modal
        if (disabledSupportLink) {
          disabledSupportLink.addEventListener('click', e => {
            e.preventDefault();
            const openBtn = document.getElementById('partner-support-btn');
            if (openBtn) {
              openBtn.click();
            }
          });
        }

        // Clear loading placeholders in data containers
        const containers = [
          'referrals-container',
          'transactions-container',
          'code-history-container',
        ];
        containers.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.innerHTML = `
              <div class="partner-empty">
                <div class="partner-empty-icon" aria-hidden="true">🚫</div>
                <p class="partner-empty-text">Account disabled — data unavailable.</p>
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

