(function () {
  'use strict';

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/London',
      }) +
      ' ' +
      d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      })
    );
  }

  function showToast(msg, type) {
    const el = document.getElementById('acr-toast');
    if (!el) return;
    el.textContent = msg;
    el.className =
      'show' + (type === 'error' ? ' toast--error' : type === 'success' ? ' toast--success' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.className = '';
    }, 4000);
  }

  async function getCsrfToken() {
    const r = await fetch('/api/v1/auth/csrf-token', { credentials: 'include' });
    const b = await r.json().catch(() => ({}));
    return b.csrfToken || b.token || '';
  }

  async function apiWrite(url, method, body) {
    const csrfToken = await getCsrfToken();
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || 'The operation failed.');
      error.code = data.code;
      error.data = data;
      throw error;
    }
    return data;
  }

  function statusBadge(status) {
    const labels = {
      submitted: 'Submitted',
      approved: 'Approved',
      processing: 'Processing',
      delivered: 'Delivered',
      rejected: 'Rejected',
    };
    const cls = 'acr-badge acr-badge--' + (status || 'submitted');
    return `<span class="${esc(cls)}">${esc(labels[status] || status || 'Unknown')}</span>`;
  }

  function methodLabel(method) {
    if (method === 'amazon_voucher') return 'Amazon Voucher';
    if (method === 'prepaid_debit_card') return 'Pre-Paid Debit Card';
    return method || '—';
  }

  function safetyPill(label, tone) {
    const palette = {
      good: 'background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;',
      warn: 'background:#fffbeb;color:#b45309;border:1px solid #fde68a;',
      bad: 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;',
      neutral: 'background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb;',
    };
    return `<span style="display:inline-flex;align-items:center;padding:.22rem .55rem;border-radius:999px;font-size:.72rem;font-weight:700;${palette[tone] || palette.neutral}">${esc(label)}</span>`;
  }

  function identityPresentation(summary) {
    if (!summary) return { label: 'Identity: unknown', tone: 'neutral' };
    if (summary.eligibleSnapshot) return { label: 'Identity verified', tone: 'good' };
    if (summary.status === 'rejected') return { label: 'Identity rejected', tone: 'bad' };
    if (summary.expired) return { label: 'Identity expired', tone: 'warn' };
    if (summary.reason === 'PARTNER_CASHOUT_IDENTITY_CHANGED') {
      return { label: 'Identity changed', tone: 'bad' };
    }
    if (summary.reason === 'PARTNER_CASHOUT_EMAIL_UNVERIFIED') {
      return { label: 'Email unverified', tone: 'bad' };
    }
    return { label: 'Identity review needed', tone: 'warn' };
  }

  function reconciliationPresentation(summary) {
    if (!summary || summary.status === 'not_run') return { label: 'Ledger not checked', tone: 'neutral' };
    if (summary.status === 'ok') {
      return {
        label:
          summary.recoveryState && summary.recoveryState !== 'none'
            ? `Ledger OK · recovery ${summary.recoveryState}`
            : 'Ledger reconciled',
        tone: 'good',
      };
    }
    return { label: 'Ledger check failed', tone: 'bad' };
  }

  function fraudPresentation(summary) {
    const level = summary?.riskLevel || 'not_assessed';
    if (level === 'high') return { label: 'Fraud risk high', tone: 'bad' };
    if (level === 'review') return { label: 'Fraud review required', tone: 'warn' };
    if (level === 'low') return { label: 'Fraud risk low', tone: 'good' };
    return { label: 'Fraud not assessed', tone: 'neutral' };
  }

  let _currentRequest = null;

  // ── Operational controls ──────────────────────────────────────────────────

  function ensureOperationsPanel() {
    let panel = document.getElementById('acr-ops-panel');
    if (panel) return panel;
    const stats = document.getElementById('acr-stats-bar');
    if (!stats || !stats.parentNode) return null;
    panel = document.createElement('section');
    panel.id = 'acr-ops-panel';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText =
      'background:#fff;border:1px solid #d1d5db;border-radius:16px;padding:1rem 1.1rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.05);';
    stats.parentNode.insertBefore(panel, stats);
    return panel;
  }

  async function updatePauseControl(field, paused) {
    const reasonInput = document.getElementById('acr-ops-reason');
    const reason = String(reasonInput?.value || '').trim();
    if (reason.length < 10) {
      showToast('Add an operational reason of at least 10 characters first.', 'error');
      reasonInput?.focus();
      return;
    }
    try {
      await apiWrite('/api/v1/admin/cashout-requests/ops/controls', 'PATCH', {
        [field]: paused,
        reason,
      });
      showToast(paused ? 'Cashout safety pause enabled.' : 'Cashout safety pause lifted.', 'success');
      await loadOperationsPanel();
    } catch (error) {
      showToast(error.message || 'Failed to update cashout controls.', 'error');
    }
  }

  async function loadOperationsPanel() {
    const panel = ensureOperationsPanel();
    if (!panel) return;
    panel.innerHTML = '<div style="color:#6b7280;font-size:.875rem;">Loading cashout safety controls…</div>';
    try {
      const res = await fetch('/api/v1/admin/cashout-requests/ops/controls', {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load safety controls.');
      const controls = data.controls || {};
      const config = data.config || {};
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;">
          <div>
            <div style="font-weight:750;color:#111827;margin-bottom:.35rem;">Cashout safety controls</div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
              ${safetyPill(controls.cashoutsPaused ? 'Cashouts paused' : 'Cashouts active', controls.cashoutsPaused ? 'bad' : 'good')}
              ${safetyPill(controls.programmePaused ? 'Master payout pause active' : 'Master payout pause off', controls.programmePaused ? 'bad' : 'neutral')}
            </div>
            <div style="margin-top:.55rem;font-size:.78rem;color:#6b7280;line-height:1.5;">
              Limits: single £${esc(config.maxSingleCashoutGbp ?? '—')} · first £${esc(config.firstCashoutMaxGbp ?? '—')} · 24h £${esc(config.rolling24hMaxGbp ?? '—')} · 30d £${esc(config.rolling30dMaxGbp ?? '—')} · open requests ${esc(config.maxOpenRequests ?? '—')}
            </div>
            ${controls.reason ? `<div style="margin-top:.35rem;font-size:.78rem;color:#4b5563;">Last control reason: ${esc(controls.reason)}</div>` : ''}
          </div>
          <div style="min-width:min(100%,420px);flex:1;max-width:560px;">
            <label for="acr-ops-reason" style="display:block;font-size:.76rem;font-weight:700;color:#4b5563;margin-bottom:.3rem;">Operational reason</label>
            <input id="acr-ops-reason" maxlength="1000" placeholder="Required when pausing or resuming…" style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:.5rem .65rem;margin-bottom:.55rem;">
            <div style="display:flex;gap:.45rem;flex-wrap:wrap;">
              <button type="button" class="ef-cta acr-action-btn ${controls.cashoutsPaused ? '' : 'acr-action-btn--danger'}" id="acr-toggle-cashouts">${controls.cashoutsPaused ? 'Resume cashouts' : 'Pause cashouts'}</button>
              <button type="button" class="ef-cta acr-action-btn ${controls.programmePaused ? '' : 'acr-action-btn--danger'}" id="acr-toggle-master-payout">${controls.programmePaused ? 'Lift master payout pause' : 'Master-pause payouts'}</button>
            </div>
          </div>
        </div>`;
      document.getElementById('acr-toggle-cashouts')?.addEventListener('click', () =>
        updatePauseControl('cashoutsPaused', !controls.cashoutsPaused)
      );
      document.getElementById('acr-toggle-master-payout')?.addEventListener('click', () =>
        updatePauseControl('programmePaused', !controls.programmePaused)
      );
    } catch (error) {
      panel.innerHTML = `<div style="color:#b91c1c;font-size:.875rem;font-weight:650;">Safety controls unavailable: ${esc(error.message || 'Unknown error')}</div>`;
    }
  }

  // ── Load & render list ───────────────────────────────────────────────────

  async function loadRequests() {
    const tbody = document.getElementById('acr-tbody');
    const statusFilter = (document.getElementById('acr-filter-status') || {}).value || '';

    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="acr-empty"><div class="acr-empty-icon">⏳</div><p class="acr-empty-text">Loading…</p></div></td></tr>`;
    }

    try {
      const params = new URLSearchParams({ limit: '200' });
      if (statusFilter) params.append('status', statusFilter);

      const res = await fetch(`/api/v1/admin/cashout-requests?${params}`, {
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to load cashout requests');
      const items = payload.items || [];

      const countBadge = document.getElementById('acr-count-badge');
      if (countBadge)
        countBadge.textContent = `${items.length} request${items.length === 1 ? '' : 's'}`;

      if (!statusFilter) {
        const counts = { submitted: 0, approved: 0, processing: 0, delivered: 0, rejected: 0 };
        items.forEach(r => {
          if (counts[r.status] !== undefined) counts[r.status]++;
        });
        ['submitted', 'approved', 'processing', 'delivered', 'rejected'].forEach(s => {
          const el = document.getElementById(`acr-stat-${s}`);
          if (el) el.textContent = counts[s];
        });
      }
      if (items.length === 0) {
        if (tbody)
          tbody.innerHTML = `<tr><td colspan="7"><div class="acr-empty"><div class="acr-empty-icon">📭</div><p class="acr-empty-text">No cashout requests found.</p></div></td></tr>`;
        return;
      }

      const rows = items
        .map(r => {
          const partner = r.partnerUser || {};
          const partnerName = esc(partner.name || partner.email || r.partnerId || '—');
          const partnerEmail = esc(partner.email || '');
          const identity = identityPresentation(r.cashoutIdentitySummary);
          const reconciliation = reconciliationPresentation(r.reconciliationSummary);
          const fraud = fraudPresentation(r.fraudSummary);
          return `<tr data-id="${esc(r.id)}">
            <td>
              <div style="font-weight:600;">${partnerName}</div>
              ${partnerEmail ? `<div style="font-size:0.8rem;color:#6b7280;">${partnerEmail}</div>` : ''}
              ${r.partnerRefCode ? `<div style="font-size:0.75rem;color:#9ca3af;font-family:monospace;">${esc(r.partnerRefCode)}</div>` : ''}
            </td>
            <td>${esc(methodLabel(r.method))}</td>
            <td style="font-weight:700;">£${esc(String(r.denominationGbp || '?'))}</td>
            <td style="font-size:0.85rem;color:#6b7280;">${esc(String(r.pointsHeld || '?'))} pts</td>
            <td>
              ${statusBadge(r.status)}
              <div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.4rem;">${safetyPill(identity.label, identity.tone)}${safetyPill(reconciliation.label, reconciliation.tone)}${safetyPill(fraud.label, fraud.tone)}</div>
            </td>
            <td style="font-size:0.82rem;white-space:nowrap;">${esc(fmtDate(r.createdAt))}</td>
            <td>
              <button type="button" class="ef-cta acr-action-btn acr-open-btn" data-id="${esc(r.id)}" aria-label="View request ${esc(r.id)}">
                ✏️ Manage
              </button>
            </td>
          </tr>`;
        })
        .join('');

      if (tbody) tbody.innerHTML = rows;

      document.querySelectorAll('.acr-open-btn').forEach(btn => {
        btn.addEventListener('click', () => openModal(btn.dataset.id, items));
      });
    } catch (err) {
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="7"><div class="acr-empty"><div class="acr-empty-icon">⚠️</div><p class="acr-empty-text">${esc(err.message || 'Error loading data')}</p></div></td></tr>`;
      showToast(err.message || 'Failed to load cashout requests', 'error');
    }
  }

  // ── Modal ────────────────────────────────────────────────────────────────

  function safetyTargetStatus(requestItem) {
    const next = {
      submitted: 'approved',
      approved: 'processing',
      processing: 'delivered',
    };
    return next[requestItem?.status] || null;
  }

  function currentInternalNote() {
    return String(document.getElementById('acr-modal-internal-notes')?.value || '').trim();
  }

  async function setIdentityReview(status) {
    if (!_currentRequest) return;
    const reason = currentInternalNote();
    if (reason.length < 20) {
      showToast('Add an internal review note of at least 20 characters first.', 'error');
      document.getElementById('acr-modal-internal-notes')?.focus();
      return;
    }
    if (status === 'rejected' && !window.confirm('Mark this partner cashout identity review as rejected?')) {
      return;
    }
    try {
      await apiWrite(
        `/api/v1/admin/cashout-requests/ops/identity/${encodeURIComponent(_currentRequest.partnerId)}`,
        'PATCH',
        { status, reason }
      );
      showToast(status === 'verified' ? 'Cashout identity verified.' : 'Cashout identity rejected.', 'success');
      closeModal();
      await loadRequests();
    } catch (error) {
      showToast(error.message || 'Identity review update failed.', 'error');
    }
  }

  async function runReconciliation() {
    if (!_currentRequest) return;
    const reason = currentInternalNote() || 'Manual reconciliation from the cashout administration screen.';
    try {
      const data = await apiWrite(
        `/api/v1/admin/cashout-requests/ops/reconcile/${encodeURIComponent(_currentRequest.id)}`,
        'POST',
        { reason, targetStatus: safetyTargetStatus(_currentRequest) }
      );
      if (data.reconciliation?.ok) {
        showToast(
          data.reconciliation.recoveryState && data.reconciliation.recoveryState !== 'none'
            ? `Ledger reconciled; recoverable state: ${data.reconciliation.recoveryState}.`
            : 'Ledger reconciliation passed.',
          'success'
        );
      } else {
        const codes = (data.reconciliation?.issues || []).map(item => item.code).filter(Boolean);
        showToast(`Ledger reconciliation failed${codes.length ? `: ${codes.join(', ')}` : '.'}`, 'error');
      }
      closeModal();
      await loadRequests();
    } catch (error) {
      showToast(error.message || 'Ledger reconciliation failed.', 'error');
    }
  }

  function openModal(id, items) {
    const r = items.find(x => x.id === id);
    if (!r) return;
    _currentRequest = r;

    const overlay = document.getElementById('acr-modal-overlay');
    const content = document.getElementById('acr-modal-content');
    const statusSelect = document.getElementById('acr-modal-status-select');
    const responseMsg = document.getElementById('acr-modal-response-msg');
    const internalNotes = document.getElementById('acr-modal-internal-notes');
    const deliveryWrap = document.getElementById('acr-delivery-details-wrap');
    const statusMsg = document.getElementById('acr-modal-status-msg');

    const partner = r.partnerUser || {};
    const identity = identityPresentation(r.cashoutIdentitySummary);
    const reconciliation = reconciliationPresentation(r.reconciliationSummary);
    const fraud = fraudPresentation(r.fraudSummary);
    const issueCodes = r.reconciliationSummary?.issueCodes || [];
    content.innerHTML = `
        <div class="acr-modal-field">
          <span class="acr-modal-label">Request ID</span>
          <span class="acr-modal-value" style="font-family:monospace;font-size:0.85rem;">${esc(r.id)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="acr-modal-field">
            <span class="acr-modal-label">Partner</span>
            <span class="acr-modal-value">${esc(partner.name || r.partnerId || '—')}</span>
            ${partner.email ? `<div style="font-size:0.82rem;color:#6b7280;">${esc(partner.email)}</div>` : ''}
          </div>
          <div class="acr-modal-field">
            <span class="acr-modal-label">Method</span>
            <span class="acr-modal-value">${esc(methodLabel(r.method))}</span>
          </div>
          <div class="acr-modal-field">
            <span class="acr-modal-label">Amount</span>
            <span class="acr-modal-value" style="font-size:1.3rem;font-weight:700;">£${esc(String(r.denominationGbp || '?'))}</span>
          </div>
          <div class="acr-modal-field">
            <span class="acr-modal-label">Points held</span>
            <span class="acr-modal-value">${esc(String(r.pointsHeld || '?'))} pts</span>
          </div>
          <div class="acr-modal-field">
            <span class="acr-modal-label">Status</span>
            <span class="acr-modal-value">${statusBadge(r.status)}</span>
          </div>
          <div class="acr-modal-field">
            <span class="acr-modal-label">Submitted</span>
            <span class="acr-modal-value" style="font-size:0.85rem;">${esc(fmtDate(r.createdAt))}</span>
          </div>
          ${r.approvedAt ? `<div class="acr-modal-field"><span class="acr-modal-label">Approved</span><span class="acr-modal-value" style="font-size:0.85rem;">${esc(fmtDate(r.approvedAt))}</span></div>` : ''}
          ${r.rejectedAt ? `<div class="acr-modal-field"><span class="acr-modal-label">Rejected</span><span class="acr-modal-value" style="font-size:0.85rem;color:#dc2626;">${esc(fmtDate(r.rejectedAt))}</span></div>` : ''}
          ${r.processingAt ? `<div class="acr-modal-field"><span class="acr-modal-label">Processing since</span><span class="acr-modal-value" style="font-size:0.85rem;">${esc(fmtDate(r.processingAt))}</span></div>` : ''}
          ${r.deliveredAt ? `<div class="acr-modal-field"><span class="acr-modal-label">Delivered</span><span class="acr-modal-value" style="font-size:0.85rem;color:#059669;">${esc(fmtDate(r.deliveredAt))}</span></div>` : ''}
        </div>
        <div style="border:1px solid #d1d5db;border-radius:12px;padding:.85rem;margin:1rem 0;background:#f9fafb;">
          <div style="font-size:.78rem;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.55rem;">Safety review</div>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.65rem;">${safetyPill(identity.label, identity.tone)}${safetyPill(reconciliation.label, reconciliation.tone)}${safetyPill(fraud.label, fraud.tone)}</div>
          <div style="font-size:.78rem;color:#6b7280;line-height:1.55;">
            ${r.cashoutIdentitySummary?.reviewedAt ? `Identity reviewed ${esc(fmtDate(r.cashoutIdentitySummary.reviewedAt))}. ` : ''}
            ${r.reconciliationSummary?.reconciledAt ? `Ledger checked ${esc(fmtDate(r.reconciliationSummary.reconciledAt))}. ` : ''}
            ${issueCodes.length ? `Issues: ${esc(issueCodes.join(', '))}.` : ''}
          </div>
          <div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.7rem;">
            <button type="button" class="ef-cta acr-action-btn" id="acr-identity-verify-btn">Verify identity</button>
            <button type="button" class="ef-cta acr-action-btn acr-action-btn--danger" id="acr-identity-reject-btn">Reject identity</button>
            <button type="button" class="ef-cta acr-action-btn" id="acr-reconcile-btn">Run ledger reconciliation</button>
          </div>
          <div style="font-size:.73rem;color:#6b7280;margin-top:.5rem;">Identity actions use the internal review note below as the required audit reason.</div>
        </div>
        ${r.partnerMessage ? `<div class="acr-modal-field"><span class="acr-modal-label">Partner message</span><div class="acr-modal-value" style="background:#f9fafb;padding:0.6rem;border-radius:8px;font-style:italic;">${esc(r.partnerMessage)}</div></div>` : ''}
        ${r.adminResponseMessage ? `<div class="acr-modal-field"><span class="acr-modal-label">Current response message</span><div class="acr-modal-value" style="background:#f0fdf4;padding:0.6rem;border-radius:8px;">${esc(r.adminResponseMessage)}</div></div>` : ''}
        ${r.adminInternalNotes ? `<div class="acr-modal-field"><span class="acr-modal-label">Current internal notes</span><div class="acr-modal-value" style="background:#fefce8;padding:0.6rem;border-radius:8px;">${esc(r.adminInternalNotes)}</div></div>` : ''}
        ${r.deliveryDetails ? `<div class="acr-modal-field"><span class="acr-modal-label">Delivery details</span><div class="acr-modal-value" style="background:#f0fdf4;padding:0.6rem;border-radius:8px;font-family:monospace;font-size:0.85rem;">${esc(typeof r.deliveryDetails === 'object' ? JSON.stringify(r.deliveryDetails) : String(r.deliveryDetails))}</div></div>` : ''}
      `;

    document.getElementById('acr-identity-verify-btn')?.addEventListener('click', () =>
      setIdentityReview('verified')
    );
    document.getElementById('acr-identity-reject-btn')?.addEventListener('click', () =>
      setIdentityReview('rejected')
    );
    document.getElementById('acr-reconcile-btn')?.addEventListener('click', runReconciliation);

    if (responseMsg) responseMsg.value = r.adminResponseMessage || '';
    if (internalNotes) internalNotes.value = r.adminInternalNotes || '';
    if (statusSelect) statusSelect.value = '';
    if (statusMsg) {
      statusMsg.textContent = '';
      statusMsg.className = 'acr-modal-status';
    }

    function toggleDelivery() {
      if (deliveryWrap)
        deliveryWrap.style.display =
          statusSelect && statusSelect.value === 'delivered' ? 'block' : 'none';
    }
    if (statusSelect) {
      statusSelect.removeEventListener('change', toggleDelivery);
      statusSelect.addEventListener('change', toggleDelivery);
    }

    if (statusSelect) {
      const allowed = {
        submitted: ['approved', 'rejected'],
        approved: ['processing', 'rejected'],
        processing: ['delivered', 'rejected'],
        rejected: [],
        delivered: [],
      };
      const opts = allowed[r.status] || [];
      Array.from(statusSelect.options).forEach(opt => {
        if (opt.value === '') return;
        opt.disabled = !opts.includes(opt.value);
      });
    }

    overlay.style.display = 'flex';
    overlay.focus && overlay.focus();
  }

  function closeModal() {
    const overlay = document.getElementById('acr-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    _currentRequest = null;
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function saveChanges() {
    if (!_currentRequest) return;

    const statusSelect = document.getElementById('acr-modal-status-select');
    const responseMsg = document.getElementById('acr-modal-response-msg');
    const internalNotes = document.getElementById('acr-modal-internal-notes');
    const deliveryRef = document.getElementById('acr-modal-delivery-ref');
    const statusMsg = document.getElementById('acr-modal-status-msg');
    const saveBtn = document.getElementById('acr-modal-save-btn');

    const newStatus = (statusSelect && statusSelect.value) || undefined;
    const adminResponseMessage = (responseMsg && responseMsg.value.trim()) || undefined;
    const adminInternalNotes = (internalNotes && internalNotes.value.trim()) || undefined;
    const deliveryRefVal = (deliveryRef && deliveryRef.value.trim()) || undefined;

    if (!newStatus && !adminResponseMessage && !adminInternalNotes) {
      if (statusMsg) {
        statusMsg.textContent = 'No changes to save.';
        statusMsg.className = 'acr-modal-status';
      }
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }
    if (statusMsg) {
      statusMsg.textContent = '';
      statusMsg.className = 'acr-modal-status';
    }

    try {
      const body = {};
      if (newStatus) body.status = newStatus;
      if (adminResponseMessage !== undefined) body.adminResponseMessage = adminResponseMessage;
      if (adminInternalNotes !== undefined) body.adminInternalNotes = adminInternalNotes;
      if (newStatus === 'delivered' && deliveryRefVal) {
        body.deliveryDetails = { reference: deliveryRefVal };
      }

      await apiWrite(
        `/api/v1/admin/cashout-requests/${encodeURIComponent(_currentRequest.id)}`,
        'PATCH',
        body
      );

      if (statusMsg) {
        statusMsg.textContent = 'Saved successfully.';
        statusMsg.className = 'acr-modal-status acr-modal-status--success';
      }
      showToast('Cashout request updated.', 'success');

      setTimeout(() => {
        closeModal();
        loadRequests();
        loadOperationsPanel();
      }, 800);
    } catch (err) {
      if (statusMsg) {
        statusMsg.textContent = err.message || 'Failed to save.';
        statusMsg.className = 'acr-modal-status acr-modal-status--error';
      }
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save changes';
      }
    }
  }

  // ── Wire up ──────────────────────────────────────────────────────────────

  function init() {
    loadOperationsPanel();
    loadRequests();

    const refreshBtn = document.getElementById('acr-refresh-btn');
    if (refreshBtn)
      refreshBtn.addEventListener('click', () => {
        loadOperationsPanel();
        loadRequests();
      });

    const filterStatus = document.getElementById('acr-filter-status');
    if (filterStatus) filterStatus.addEventListener('change', loadRequests);

    const modalClose = document.getElementById('acr-modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);

    const modalCancel = document.getElementById('acr-modal-cancel-btn');
    if (modalCancel) modalCancel.addEventListener('click', closeModal);

    const overlay = document.getElementById('acr-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) closeModal();
      });
    }

    const saveBtn = document.getElementById('acr-modal-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveChanges);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
