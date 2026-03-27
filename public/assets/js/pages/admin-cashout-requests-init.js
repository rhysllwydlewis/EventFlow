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
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }

    function showToast(msg, type) {
      const el = document.getElementById('acr-toast');
      if (!el) return;
      el.textContent = msg;
      el.className = 'show' + (type === 'error' ? ' toast--error' : type === 'success' ? ' toast--success' : '');
      clearTimeout(el._timer);
      el._timer = setTimeout(() => { el.className = ''; }, 4000);
    }

    async function getCsrfToken() {
      const r = await fetch('/api/v1/auth/csrf-token', { credentials: 'include' });
      const b = await r.json().catch(() => ({}));
      return b.csrfToken || b.token || '';
    }

    function statusBadge(status) {
      const labels = { submitted: 'Submitted', approved: 'Approved', processing: 'Processing', delivered: 'Delivered', rejected: 'Rejected' };
      const cls = 'acr-badge acr-badge--' + (status || 'submitted');
      return `<span class="${esc(cls)}">${esc(labels[status] || status || 'Unknown')}</span>`;
    }

    function methodLabel(method) {
      if (method === 'amazon_voucher') return 'Amazon Voucher';
      if (method === 'prepaid_debit_card') return 'Pre-Paid Debit Card';
      return method || '—';
    }

    let _currentRequest = null;

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

        const res = await fetch(`/api/v1/admin/cashout-requests?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load cashout requests');
        const { items } = await res.json();

        const countBadge = document.getElementById('acr-count-badge');
        if (countBadge) countBadge.textContent = `${(items || []).length} request${(items || []).length === 1 ? '' : 's'}`;

        // Update stats bar (always counts across all statuses even when filtered)
        if (!statusFilter) {
          const counts = { submitted: 0, approved: 0, processing: 0, delivered: 0, rejected: 0 };
          (items || []).forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
          ['submitted','approved','processing','delivered','rejected'].forEach(s => {
            const el = document.getElementById(`acr-stat-${s}`);
            if (el) el.textContent = counts[s];
          });
        }
        if (!items || items.length === 0) {
          if (tbody) tbody.innerHTML = `<tr><td colspan="7"><div class="acr-empty"><div class="acr-empty-icon">📭</div><p class="acr-empty-text">No cashout requests found.</p></div></td></tr>`;
          return;
        }

        const rows = items.map(r => {
          const partner = r.partnerUser || {};
          const partnerName = esc(partner.name || partner.email || r.partnerId || '—');
          const partnerEmail = esc(partner.email || '');
          return `<tr data-id="${esc(r.id)}">
            <td>
              <div style="font-weight:600;">${partnerName}</div>
              ${partnerEmail ? `<div style="font-size:0.8rem;color:#6b7280;">${partnerEmail}</div>` : ''}
              ${r.partnerRefCode ? `<div style="font-size:0.75rem;color:#9ca3af;font-family:monospace;">${esc(r.partnerRefCode)}</div>` : ''}
            </td>
            <td>${esc(methodLabel(r.method))}</td>
            <td style="font-weight:700;">£${esc(String(r.denominationGbp || '?'))}</td>
            <td style="font-size:0.85rem;color:#6b7280;">${esc(String(r.pointsHeld || '?'))} pts</td>
            <td>${statusBadge(r.status)}</td>
            <td style="font-size:0.82rem;white-space:nowrap;">${esc(fmtDate(r.createdAt))}</td>
            <td>
              <button type="button" class="acr-action-btn acr-open-btn" data-id="${esc(r.id)}" aria-label="View request ${esc(r.id)}">
                ✏️ Manage
              </button>
            </td>
          </tr>`;
        }).join('');

        if (tbody) tbody.innerHTML = rows;

        // Attach open handlers
        document.querySelectorAll('.acr-open-btn').forEach(btn => {
          btn.addEventListener('click', () => openModal(btn.dataset.id, items));
        });
      } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7"><div class="acr-empty"><div class="acr-empty-icon">⚠️</div><p class="acr-empty-text">${esc(err.message || 'Error loading data')}</p></div></td></tr>`;
        showToast(err.message || 'Failed to load cashout requests', 'error');
      }
    }

    // ── Modal ────────────────────────────────────────────────────────────────

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
      const deliveryRef = document.getElementById('acr-modal-delivery-ref');
      const statusMsg = document.getElementById('acr-modal-status-msg');

      // Populate detail fields
      const partner = r.partnerUser || {};
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
        ${r.partnerMessage ? `<div class="acr-modal-field"><span class="acr-modal-label">Partner message</span><div class="acr-modal-value" style="background:#f9fafb;padding:0.6rem;border-radius:8px;font-style:italic;">${esc(r.partnerMessage)}</div></div>` : ''}
        ${r.adminResponseMessage ? `<div class="acr-modal-field"><span class="acr-modal-label">Current response message</span><div class="acr-modal-value" style="background:#f0fdf4;padding:0.6rem;border-radius:8px;">${esc(r.adminResponseMessage)}</div></div>` : ''}
        ${r.adminInternalNotes ? `<div class="acr-modal-field"><span class="acr-modal-label">Current internal notes</span><div class="acr-modal-value" style="background:#fefce8;padding:0.6rem;border-radius:8px;">${esc(r.adminInternalNotes)}</div></div>` : ''}
        ${r.deliveryDetails ? `<div class="acr-modal-field"><span class="acr-modal-label">Delivery details</span><div class="acr-modal-value" style="background:#f0fdf4;padding:0.6rem;border-radius:8px;font-family:monospace;font-size:0.85rem;">${esc(typeof r.deliveryDetails === 'object' ? JSON.stringify(r.deliveryDetails) : String(r.deliveryDetails))}</div></div>` : ''}
      `;

      // Pre-populate fields
      if (responseMsg) responseMsg.value = r.adminResponseMessage || '';
      if (internalNotes) internalNotes.value = r.adminInternalNotes || '';
      if (statusSelect) statusSelect.value = '';
      if (statusMsg) { statusMsg.textContent = ''; statusMsg.className = 'acr-modal-status'; }

      // Show delivery details field only when delivered is chosen
      function toggleDelivery() {
        if (deliveryWrap) deliveryWrap.style.display = (statusSelect && statusSelect.value === 'delivered') ? 'block' : 'none';
      }
      if (statusSelect) { statusSelect.removeEventListener('change', toggleDelivery); statusSelect.addEventListener('change', toggleDelivery); }

      // Filter status options based on current state
      if (statusSelect) {
        const allowed = { submitted: ['approved','rejected'], approved: ['processing','rejected'], processing: ['delivered','rejected'], rejected: [], delivered: [] };
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
        if (statusMsg) { statusMsg.textContent = 'No changes to save.'; statusMsg.className = 'acr-modal-status'; }
        return;
      }

      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      if (statusMsg) { statusMsg.textContent = ''; statusMsg.className = 'acr-modal-status'; }

      try {
        const csrfToken = await getCsrfToken();
        const body = {};
        if (newStatus) body.status = newStatus;
        if (adminResponseMessage !== undefined) body.adminResponseMessage = adminResponseMessage;
        if (adminInternalNotes !== undefined) body.adminInternalNotes = adminInternalNotes;
        if (newStatus === 'delivered' && deliveryRefVal) {
          body.deliveryDetails = { reference: deliveryRefVal };
        }

        const res = await fetch(`/api/v1/admin/cashout-requests/${encodeURIComponent(_currentRequest.id)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to update request');

        if (statusMsg) { statusMsg.textContent = 'Saved successfully.'; statusMsg.className = 'acr-modal-status acr-modal-status--success'; }
        showToast('Cashout request updated.', 'success');

        // Refresh list
        setTimeout(() => {
          closeModal();
          loadRequests();
        }, 800);
      } catch (err) {
        if (statusMsg) { statusMsg.textContent = err.message || 'Failed to save.'; statusMsg.className = 'acr-modal-status acr-modal-status--error'; }
        showToast(err.message || 'Failed to save', 'error');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save changes'; }
      }
    }

    // ── Wire up ──────────────────────────────────────────────────────────────

    function init() {
      loadRequests();

      const refreshBtn = document.getElementById('acr-refresh-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', loadRequests);

      const filterStatus = document.getElementById('acr-filter-status');
      if (filterStatus) filterStatus.addEventListener('change', loadRequests);

      const modalClose = document.getElementById('acr-modal-close');
      if (modalClose) modalClose.addEventListener('click', closeModal);

      const modalCancel = document.getElementById('acr-modal-cancel-btn');
      if (modalCancel) modalCancel.addEventListener('click', closeModal);

      const overlay = document.getElementById('acr-modal-overlay');
      if (overlay) {
        overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
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
