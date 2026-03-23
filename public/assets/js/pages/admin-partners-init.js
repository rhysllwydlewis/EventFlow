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
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#888;">Loading partners…</td></tr>`;
    }

    try {
      const data = await AdminShared.api('/api/admin/partners');
      allPartners = data.items || [];
      updateStats();
      renderTable();
      if (summary) {
        summary.textContent = `${allPartners.length} partners`;
      }
    } catch (err) {
      AdminShared.debugError('Failed to load partners', err);
      if (summary) {
        summary.textContent = 'Error loading';
      }
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#ef4444;">Error loading partners. <button onclick="loadPartners()" style="color:#60a5fa;background:none;border:none;cursor:pointer;">Retry</button></td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#888;">No partners found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map(p => {
        const credits = p.credits || {};
        return `<tr>
        <td>
          <strong style="color:#fff">${esc(p.user?.name || '—')}</strong>
          <br/><small style="color:#888">${esc(p.user?.email || '')}</small>
          ${p.user?.company ? `<br/><small style="color:#6ee7b7">${esc(p.user.company)}</small>` : ''}
        </td>
        <td><code style="color:#a5b4fc;font-size:0.8rem;">${esc(p.refCode || '—')}</code></td>
        <td style="color:#888;font-size:0.85rem;">${fmtDate(p.createdAt)}</td>
        <td style="text-align:center;">${p.referralCount || 0}</td>
        <td style="text-align:center;color:#fcd34d;">${(credits.totalEarned || 0).toLocaleString()}</td>
        <td style="text-align:center;color:#6ee7b7;font-weight:700;">${(credits.balance || 0).toLocaleString()}</td>
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
    body.innerHTML = '<p style="color:rgba(255,255,255,0.45);padding:1rem 0;">Loading…</p>';

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
          const amtColor = t.amount >= 0 ? '#6ee7b7' : '#fca5a5';
          const amtStr = t.amount >= 0 ? `+${t.amount}` : `${t.amount}`;
          return `<tr>
          <td style="color:rgba(255,255,255,0.65);font-size:0.8rem;">${esc(lbl)}</td>
          <td style="color:${amtColor};font-weight:700;font-size:0.85rem;">${amtStr}</td>
          <td style="color:rgba(255,255,255,0.4);font-size:0.75rem;">${fmtDate(t.createdAt)}</td>
          <td style="color:rgba(255,255,255,0.35);font-size:0.73rem;">${esc(t.notes || '')}</td>
        </tr>`;
        })
        .join('');

      const refRows = (referrals || [])
        .slice(0, 20)
        .map(r => {
          const pkg = r.packageQualified ? '✓' : '—';
          const sub = r.subscriptionQualified ? '✓' : '—';
          return `<tr>
          <td style="color:rgba(255,255,255,0.65);font-size:0.8rem;">${esc(r.supplierName || '—')}</td>
          <td style="color:rgba(255,255,255,0.4);font-size:0.75rem;">${fmtDate(r.supplierCreatedAt)}</td>
          <td style="text-align:center;color:${r.packageQualified ? '#6ee7b7' : 'rgba(255,255,255,0.3)'}">${pkg}</td>
          <td style="text-align:center;color:${r.subscriptionQualified ? '#6ee7b7' : 'rgba(255,255,255,0.3)'}">${sub}</td>
        </tr>`;
        })
        .join('');

      body.innerHTML = `
        <!-- Summary -->
        <div class="partner-detail-section">
          <div class="partner-detail-section-title">Account Info</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.83rem;">
            <div style="color:rgba(255,255,255,0.4)">Ref Code</div><div style="color:#a5b4fc;font-family:monospace;">${esc(partner.refCode)}</div>
            <div style="color:rgba(255,255,255,0.4)">Status</div><div>${statusBadge(partner.status)}</div>
            <div style="color:rgba(255,255,255,0.4)">Joined</div><div style="color:rgba(255,255,255,0.65)">${fmtDate(partner.createdAt)}</div>
            <div style="color:rgba(255,255,255,0.4)">Company</div><div style="color:rgba(255,255,255,0.65)">${esc(partner.user?.company || '—')}</div>
          </div>
        </div>

        <!-- Credits summary -->
        <div class="partner-detail-section">
          <div class="partner-detail-section-title">Credits</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;margin-bottom:1rem;">
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#6ee7b7">${(credits.balance || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-top:0.2rem">Balance</div>
            </div>
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#fcd34d">${(credits.packageBonusTotal || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-top:0.2rem">Pkg Bonuses</div>
            </div>
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:#a5b4fc">${(credits.subscriptionBonusTotal || 0).toLocaleString()}</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);margin-top:0.2rem">Sub Bonuses</div>
            </div>
          </div>

          ${
            txnRows
              ? `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Type</th>
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Amount</th>
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Date</th>
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Notes</th>
                </tr>
              </thead>
              <tbody>${txnRows}</tbody>
            </table>
          </div>`
              : '<p style="color:rgba(255,255,255,0.35);font-size:0.8rem;padding:0.5rem 0">No transactions yet.</p>'
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
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Supplier</th>
                  <th style="text-align:left;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Signed Up</th>
                  <th style="text-align:center;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Pkg</th>
                  <th style="text-align:center;padding:0.4rem;color:rgba(255,255,255,0.35);font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07)">Sub</th>
                </tr>
              </thead>
              <tbody>${refRows}</tbody>
            </table>
          </div>`
              : '<p style="color:rgba(255,255,255,0.35);font-size:0.8rem;padding:0.5rem 0">No referrals yet.</p>'
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
      statusEl.style.display = 'none';
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

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    setupEventListeners();
    loadPartners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
