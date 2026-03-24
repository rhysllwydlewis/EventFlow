/**
 * Admin Partners Page — init
 * Loads and manages partner accounts from the admin panel.
 */
(function () {
  'use strict';

  let allPartners = [];
  let currentDetailId = null;

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

  function showToast(msg, type = 'success') {
    const t = document.getElementById('partner-toast');
    if (!t) {
      return;
    }
    t.textContent = msg;
    t.className = `partner-toast partner-toast--${type} show`;
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function statusBadge(status) {
    if (status === 'active') {
      return `<span class="p-badge p-badge--success">Active</span>`;
    }
    return `<span class="p-badge p-badge--inactive">Disabled</span>`;
  }

  // ── Load partners ─────────────────────────────────────────────────────────────

  async function loadPartners() {
    const tbody = document.getElementById('partners-tbody');
    const summary = document.getElementById('partner-summary');

    if (summary) {
      summary.textContent = 'Loading…';
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2.5rem;color:#9ca3af;">Loading partners…</td></tr>`;
    }

    try {
      const data = await AdminShared.api('/api/admin/partners');
      allPartners = data.items || [];
      updateStats();
      renderTable();
      toggleEmptyState();
      if (summary) {
        summary.textContent =
          allPartners.length === 0
            ? 'No partners yet'
            : `${allPartners.length} partner${allPartners.length === 1 ? '' : 's'}`;
      }
    } catch (err) {
      AdminShared.debugError('Failed to load partners', err);
      if (summary) {
        summary.textContent = 'Error loading';
      }
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2.5rem;color:#fca5a5;">
          Error loading partners.
          <button onclick="loadPartners()" style="margin-left:0.5rem;color:#60a5fa;background:none;border:none;cursor:pointer;text-decoration:underline;">Retry</button>
        </td></tr>`;
      }
    }
  }

  /** Show empty-state hero or table depending on whether partners exist */
  function toggleEmptyState() {
    const tableSection = document.getElementById('partners-table-section');
    const emptyState = document.getElementById('ap-empty-state');
    const progInfo = document.getElementById('ap-programme-info');
    const hasPartners = allPartners.length > 0;

    if (tableSection) {
      tableSection.hidden = !hasPartners;
    }
    if (emptyState) {
      emptyState.hidden = hasPartners;
    }
    if (progInfo) {
      progInfo.hidden = !hasPartners;
    }

    // Show the partner sign-up URL in the info card
    if (progInfo && hasPartners) {
      const urlEl = document.getElementById('ap-partner-signup-url');
      if (urlEl) {
        const base = window.location.origin;
        urlEl.textContent = `${base}/partner`;
        urlEl.href = '/partner';
      }
    }
  }

  function updateStats() {
    const totalActive = allPartners.filter(p => p.status === 'active').length;
    const totalReferrals = allPartners.reduce((s, p) => s + (p.referralCount || 0), 0);
    const totalCredits = allPartners.reduce((s, p) => s + (p.credits?.balance || 0), 0);

    const el = id => document.getElementById(id);
    if (el('count-total')) {
      el('count-total').textContent = allPartners.length;
    }
    if (el('count-active')) {
      el('count-active').textContent = totalActive;
    }
    if (el('count-referrals')) {
      el('count-referrals').textContent = totalReferrals;
    }
    if (el('count-credits')) {
      el('count-credits').textContent = totalCredits.toLocaleString();
    }
  }

  function renderTable() {
    const tbody = document.getElementById('partners-tbody');
    if (!tbody) {
      return;
    }

    const search = (document.getElementById('partnerSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('statusFilter')?.value || '';

    let list = allPartners;
    if (search) {
      list = list.filter(
        p =>
          (p.refCode || '').toLowerCase().includes(search) ||
          (p.user?.name || '').toLowerCase().includes(search) ||
          (p.user?.email || '').toLowerCase().includes(search) ||
          (p.user?.company || '').toLowerCase().includes(search)
      );
    }
    if (statusFilter) {
      list = list.filter(p => p.status === statusFilter);
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2.5rem;color:#9ca3af;">
        No partners match your filters.
        <button type="button" id="ap-clear-filters-btn"
          style="margin-left:0.5rem;color:#60a5fa;background:none;border:none;cursor:pointer;text-decoration:underline;font-size:inherit;">
          Clear filters
        </button>
      </td></tr>`;
      // Wire clear-filters button after inserting HTML
      const clearBtn = document.getElementById('ap-clear-filters-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const s = document.getElementById('partnerSearch');
          const f = document.getElementById('statusFilter');
          if (s) {
            s.value = '';
          }
          if (f) {
            f.value = '';
          }
          renderTable();
        });
      }
      return;
    }

    tbody.innerHTML = list
      .map(p => {
        const credits = p.credits || {};
        return `<tr>
        <td>
          <strong style="color:#111827">${esc(p.user?.name || '—')}</strong>
          <br/><small style="color:#888">${esc(p.user?.email || '')}</small>
          ${p.user?.company ? `<br/><small style="color:#059669">${esc(p.user.company)}</small>` : ''}
        </td>
        <td><code style="color:#6366f1;font-size:0.8rem;">${esc(p.refCode || '—')}</code></td>
        <td style="color:#888;font-size:0.85rem;">${fmtDate(p.createdAt)}</td>
        <td style="text-align:center;">${p.referralCount || 0}</td>
        <td style="text-align:center;color:#d97706;">${(credits.totalEarned || 0).toLocaleString()}</td>
        <td style="text-align:center;color:#059669;font-weight:700;">${(credits.balance || 0).toLocaleString()}</td>
        <td>${statusBadge(p.status)}</td>
        <td>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <button class="ap-action-btn ap-action-btn--view" data-action="view" data-id="${esc(p.id)}" aria-label="View ${esc(p.user?.name || 'partner')}">View</button>
            ${
              p.status === 'active'
                ? `<button class="ap-action-btn ap-action-btn--disable" data-action="disable" data-id="${esc(p.id)}" aria-label="Disable ${esc(p.user?.name || 'partner')}">Disable</button>`
                : `<button class="ap-action-btn ap-action-btn--enable" data-action="enable" data-id="${esc(p.id)}" aria-label="Enable ${esc(p.user?.name || 'partner')}">Enable</button>`
            }
            <button class="ap-action-btn ap-action-btn--credit" data-action="credit" data-id="${esc(p.id)}" aria-label="Adjust credits for ${esc(p.user?.name || 'partner')}">Credits</button>
          </div>
        </td>
      </tr>`;
      })
      .join('');
  }

  // ── Detail panel ──────────────────────────────────────────────────────────────

  async function openDetailPanel(partnerId) {
    const panel = document.getElementById('partner-detail-panel');
    const body = document.getElementById('detail-body-content');
    if (!panel || !body) {
      return;
    }

    currentDetailId = partnerId;
    panel.removeAttribute('hidden');
    panel.classList.add('open');
    body.innerHTML = '<p style="color:#6b7280;padding:1rem 0;">Loading…</p>';

    const nameEl = document.getElementById('detail-partner-name');
    const emailEl = document.getElementById('detail-partner-email');

    try {
      const data = await AdminShared.api(`/api/admin/partners/${encodeURIComponent(partnerId)}`);
      const { partner, credits, referrals } = data;

      if (nameEl) {
        nameEl.textContent = partner.user?.name || 'Partner';
      }
      if (emailEl) {
        emailEl.textContent = partner.user?.email || '';
      }

      const txnRows = (credits.transactions || [])
        .slice(0, 20)
        .map(t => {
          const typeLabels = {
            PACKAGE_BONUS: '📦 Package Bonus',
            SUBSCRIPTION_BONUS: '💳 Subscription Bonus',
            ADJUSTMENT: '⚙️ Adjustment',
            REDEEM: '🎁 Redemption',
          };
          const lbl = typeLabels[t.type] || t.type;
          const amtColor = t.amount >= 0 ? '#34d399' : '#fca5a5';
          const amtStr = t.amount >= 0 ? `+${t.amount}` : `${t.amount}`;
          return `<tr>
          <td style="color:#e5e7eb;font-size:0.8rem;">${esc(lbl)}</td>
          <td style="color:${amtColor};font-weight:700;font-size:0.85rem;">${amtStr}</td>
          <td style="color:#9ca3af;font-size:0.75rem;">${fmtDate(t.createdAt)}</td>
          <td style="color:#9ca3af;font-size:0.73rem;">${esc(t.notes || '')}</td>
        </tr>`;
        })
        .join('');

      const refRows = (referrals || [])
        .slice(0, 20)
        .map(r => {
          const pkg = r.packageQualified ? '✓' : '—';
          const sub = r.subscriptionQualified ? '✓' : '—';
          return `<tr>
          <td style="color:#e5e7eb;font-size:0.8rem;">${esc(r.supplierName || '—')}</td>
          <td style="color:#9ca3af;font-size:0.75rem;">${fmtDate(r.supplierCreatedAt)}</td>
          <td style="text-align:center;color:${r.packageQualified ? '#34d399' : '#6b7280'}">${pkg}</td>
          <td style="text-align:center;color:${r.subscriptionQualified ? '#34d399' : '#6b7280'}">${sub}</td>
        </tr>`;
        })
        .join('');

      body.innerHTML = `
        <!-- Summary -->
        <div class="partner-detail-section">
          <div class="partner-detail-section-title">Account Info</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.83rem;">
            <div style="color:#9ca3af">Ref Code</div><div style="color:#818cf8;font-family:monospace;">${esc(partner.refCode)}</div>
            <div style="color:#9ca3af">Status</div><div>${statusBadge(partner.status)}</div>
            <div style="color:#9ca3af">Joined</div><div style="color:#e5e7eb">${fmtDate(partner.createdAt)}</div>
            <div style="color:#9ca3af">Company</div><div style="color:#e5e7eb">${esc(partner.user?.company || '—')}</div>
          </div>
        </div>

        <!-- Credits summary -->
        <div class="partner-detail-section">
          <div class="partner-detail-section-title">Credits</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;margin-bottom:1rem;">
            <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#34d399">${(credits.balance || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:#9ca3af;margin-top:0.2rem">Balance</div>
            </div>
            <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#fbbf24">${(credits.packageBonusTotal || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:#9ca3af;margin-top:0.2rem">Pkg Bonuses</div>
            </div>
            <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#818cf8">${(credits.subscriptionBonusTotal || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:#9ca3af;margin-top:0.2rem">Sub Bonuses</div>
            </div>
          </div>

          ${
            txnRows
              ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Type</th>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Amount</th>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Date</th>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Notes</th>
                </tr>
              </thead>
              <tbody>${txnRows}</tbody>
            </table>
          </div>`
              : '<p style="color:#9ca3af;font-size:0.8rem;padding:0.5rem 0">No transactions yet.</p>'
          }
        </div>

        <!-- Referrals -->
        <div class="partner-detail-section">
          <div class="partner-detail-section-title">Referrals (${(referrals || []).length})</div>
          ${
            refRows
              ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Supplier</th>
                  <th style="text-align:left;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Signed Up</th>
                  <th style="text-align:center;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Pkg</th>
                  <th style="text-align:center;padding:0.4rem;color:#9ca3af;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.1)">Sub</th>
                </tr>
              </thead>
              <tbody>${refRows}</tbody>
            </table>
          </div>`
              : '<p style="color:#9ca3af;font-size:0.8rem;padding:0.5rem 0">No referrals yet.</p>'
          }
        </div>`;
    } catch (err) {
      body.innerHTML = `<p style="color:#fca5a5;font-size:0.85rem">Failed to load partner details. Please try again.</p>`;
    }
  }

  function closeDetailPanel() {
    const panel = document.getElementById('partner-detail-panel');
    if (panel) {
      panel.classList.remove('open');
      setTimeout(() => panel.setAttribute('hidden', ''), 320);
    }
    currentDetailId = null;
  }

  // ── Status toggle ─────────────────────────────────────────────────────────────

  async function togglePartnerStatus(partnerId, newStatus) {
    try {
      const csrfToken = await getCsrf();
      const res = await fetch(`/api/v1/admin/partners/${encodeURIComponent(partnerId)}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed');
      }
      showToast(
        `Partner ${newStatus === 'active' ? 'enabled' : 'disabled'} successfully`,
        'success'
      );
      await loadPartners();
    } catch (err) {
      showToast(err.message || 'Action failed', 'error');
    }
  }

  // ── Credit modal ──────────────────────────────────────────────────────────────

  let creditTargetId = null;

  function openCreditModal(partnerId) {
    creditTargetId = partnerId;
    const overlay = document.getElementById('credit-modal-overlay');
    const partnerInfo = document.getElementById('credit-modal-partner');
    const form = document.getElementById('credit-adjust-form');
    const statusEl = document.getElementById('credit-modal-status');

    const partner = allPartners.find(p => p.id === partnerId);
    if (partnerInfo) {
      partnerInfo.textContent = partner?.user?.name
        ? `For: ${partner.user.name} (${partner.refCode})`
        : `Partner ID: ${partnerId}`;
    }

    if (form) {
      form.reset();
    }
    if (statusEl) {
      statusEl.textContent = '';
      // Reset to base class only; CSS (.partner-status) already hides it via display:none.
      // Do NOT set statusEl.style.display — inline styles override the .error display:block rule.
      statusEl.className = 'partner-status';
    }
    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  function closeCreditModal() {
    const overlay = document.getElementById('credit-modal-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
    creditTargetId = null;
  }

  async function submitCreditAdjustment(e) {
    e.preventDefault();
    const form = e.target;
    const statusEl = document.getElementById('credit-modal-status');
    const submitBtn = document.getElementById('credit-modal-submit');

    const amount = parseInt(form.querySelector('#credit-amount').value, 10);
    const notes = form.querySelector('#credit-notes').value.trim();

    if (!Number.isFinite(amount) || amount === 0) {
      if (statusEl) {
        statusEl.textContent = 'Amount must be a non-zero integer.';
        statusEl.className = 'partner-status error';
      }
      return;
    }
    if (!notes || notes.length < 3) {
      if (statusEl) {
        statusEl.textContent = 'An audit note is required.';
        statusEl.className = 'partner-status error';
      }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Applying…';

    try {
      const csrfToken = await getCsrf();
      const res = await fetch(
        `/api/v1/admin/partners/${encodeURIComponent(creditTargetId)}/credits`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ amount, notes }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed');
      }

      showToast(`Credit adjustment (${amount > 0 ? '+' : ''}${amount}) applied`, 'success');
      closeCreditModal();
      await loadPartners();
      if (currentDetailId === creditTargetId) {
        openDetailPanel(currentDetailId);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = err.message || 'Failed to apply adjustment.';
        statusEl.className = 'partner-status error';
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Apply Adjustment';
    }
  }

  // ── CSRF helper ───────────────────────────────────────────────────────────────

  async function getCsrf() {
    try {
      const r = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const d = await r.json();
      return d.csrfToken || '';
    } catch (_) {
      return '';
    }
  }

  // ── Event delegation ──────────────────────────────────────────────────────────

  function setupEventListeners() {
    // Table actions (delegated)
    const tbody = document.getElementById('partners-tbody');
    if (tbody) {
      tbody.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) {
          return;
        }
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (!id) {
          return;
        }

        if (action === 'view') {
          openDetailPanel(id);
        } else if (action === 'disable') {
          const confirmed =
            window.AdminShared && window.AdminShared.showConfirmModal
              ? await window.AdminShared.showConfirmModal({
                  title: 'Disable partner?',
                  message:
                    'This partner will no longer earn credits. You can re-enable them at any time.',
                  confirmText: 'Disable',
                  cancelText: 'Cancel',
                })
              : false; // AdminShared always present on admin pages; default false (safe) if unavailable
          if (confirmed) {
            await togglePartnerStatus(id, 'disabled');
          }
        } else if (action === 'enable') {
          await togglePartnerStatus(id, 'active');
        } else if (action === 'credit') {
          openCreditModal(id);
        }
      });
    }

    // Filters
    const searchInput = document.getElementById('partnerSearch');
    if (searchInput) {
      searchInput.addEventListener('input', renderTable);
    }

    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', renderTable);
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadPartners);
    }

    // Payout requests filter and refresh
    const payoutStatusFilter = document.getElementById('payoutStatusFilter');
    if (payoutStatusFilter) {
      payoutStatusFilter.addEventListener('change', loadPayoutRequests);
    }
    const refreshPayoutsBtn = document.getElementById('refreshPayoutsBtn');
    if (refreshPayoutsBtn) {
      refreshPayoutsBtn.addEventListener('click', loadPayoutRequests);
    }

    // Detail panel close
    const closeBtn = document.getElementById('close-detail-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDetailPanel);
    }

    // Credit modal
    const cancelBtn = document.getElementById('credit-modal-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeCreditModal);
    }

    const creditForm = document.getElementById('credit-adjust-form');
    if (creditForm) {
      creditForm.addEventListener('submit', submitCreditAdjustment);
    }

    // Close modal on overlay click
    const overlay = document.getElementById('credit-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeCreditModal();
        }
      });
    }

    // Escape key to close panels
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeCreditModal();
        closeDetailPanel();
      }
    });
  }

  // ── Payout requests ───────────────────────────────────────────────────────────

  async function loadPayoutRequests() {
    const container = document.getElementById('payout-requests-container');
    const statusFilter = document.getElementById('payoutStatusFilter');
    const status = statusFilter ? statusFilter.value : '';

    if (container) {
      container.innerHTML =
        '<div style="text-align:center;padding:2rem;color:#9ca3af;">Loading payout requests…</div>';
    }

    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await AdminShared.api(`/api/admin/partners/payout-requests${qs}`);
      const items = data.items || [];

      if (!container) {
        return;
      }

      if (items.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:2.5rem;color:#9ca3af;">
            <div style="font-size:2rem;margin-bottom:0.75rem;">🎁</div>
            <div>No payout requests${status ? ' with this status' : ''} yet.</div>
          </div>`;
        return;
      }

      const statusOptions = ['open', 'in_progress', 'resolved', 'closed'];
      const statusLabels = {
        open: '<span class="p-badge p-badge--pending">Open</span>',
        in_progress: '<span class="p-badge p-badge--success">In Progress</span>',
        resolved: '<span class="p-badge p-badge--inactive">Resolved</span>',
        closed: '<span class="p-badge p-badge--inactive">Closed</span>',
      };

      const rows = items.map(r => {
        const userName = r.partnerUser
          ? esc(r.partnerUser.name || r.partnerUser.email || 'Unknown')
          : 'Unknown';
        const userEmail = r.partnerUser ? esc(r.partnerUser.email || '') : '';
        const statusBadge =
          statusLabels[r.status] ||
          `<span class="p-badge p-badge--inactive">${esc(r.status)}</span>`;
        const statusSelectOptions = statusOptions
          .map(
            s =>
              `<option value="${s}"${s === r.status ? ' selected' : ''}>${s.replace('_', ' ')}</option>`
          )
          .join('');

        return `<tr>
          <td>
            <div style="font-weight:600;color:#111827;">${userName}</div>
            <div style="font-size:0.75rem;color:#9ca3af;">${userEmail}</div>
            <div style="font-size:0.73rem;color:#9ca3af;margin-top:0.1rem;">${esc(r.partnerId || '')}</div>
          </td>
          <td>
            <div style="font-weight:700;color:#059669;font-size:1.05rem;">${esc(r.payoutValueGbp || '—')}</div>
            <div style="font-size:0.78rem;color:#6b7280;">${esc(String(r.payoutPoints || 0))} points</div>
          </td>
          <td style="font-size:0.82rem;">${esc(r.payoutGiftCardType || 'Not specified')}</td>
          <td style="font-size:0.78rem;color:#6b7280;">${fmtDate(r.createdAt)}</td>
          <td>${statusBadge}</td>
          <td>
            <select
              class="payout-status-select"
              data-ticket-id="${esc(r.id)}"
              style="background:#fff;border:1px solid #d1d5db;border-radius:7px;color:#374151;padding:0.3rem 0.55rem;font-size:0.78rem;cursor:pointer;"
              aria-label="Update payout request status"
            >${statusSelectOptions}</select>
          </td>
        </tr>`;
      });

      container.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" aria-label="Payout requests">
            <thead>
              <tr>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Partner</th>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Amount</th>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Gift Card</th>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Submitted</th>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Status</th>
                <th style="text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;padding:0.5rem 0.75rem;">Update Status</th>
              </tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>`;

      // Attach status-change listeners
      container.querySelectorAll('.payout-status-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const ticketId = sel.getAttribute('data-ticket-id');
          const newStatus = sel.value;
          try {
            const csrfToken = await getCsrf();
            await AdminShared.api(
              `/api/admin/partners/payout-requests/${encodeURIComponent(ticketId)}/status`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ status: newStatus }),
              }
            );
            showToast(
              `Payout request status updated to "${newStatus.replace('_', ' ')}"`,
              'success'
            );
            loadPayoutRequests();
          } catch (err) {
            AdminShared.debugError('Failed to update payout status', err);
            showToast('Failed to update status', 'error');
          }
        });
      });
    } catch (err) {
      AdminShared.debugError('Failed to load payout requests', err);
      if (container) {
        container.innerHTML =
          '<div style="text-align:center;padding:2rem;color:#fca5a5;">Error loading payout requests.</div>';
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    setupEventListeners();
    loadPartners();
    loadPayoutRequests();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
