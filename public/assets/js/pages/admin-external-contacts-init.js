/**
 * EventFlow Admin — External Contacts
 * Drives /admin-external-contacts — enquiries from VEXI, Chlo etc.
 */
'use strict';
(function () {
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  function safeExternalHref(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.origin);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function fmtDate(dt) {
    if (!dt) {
      return '—';
    }
    try {
      return new Date(dt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  const SOURCE_COLOURS = {
    vexi: { bg: '#eff6ff', color: '#1d4ed8', label: 'VEXI' },
    chlo: { bg: '#fdf4ff', color: '#7c3aed', label: 'Chlo' },
  };

  const STATUS_COLOURS = {
    new: { bg: '#fee2e2', color: '#991b1b', label: 'New' },
    in_review: { bg: '#fef3c7', color: '#92400e', label: 'In review' },
    replied: { bg: '#d1fae5', color: '#065f46', label: 'Replied' },
    archived: { bg: '#f3f4f6', color: '#6b7280', label: 'Archived' },
  };

  function sourceBadge(source) {
    const c = SOURCE_COLOURS[source] || { bg: '#f3f4f6', color: '#374151', label: esc(source) };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;background:${c.bg};color:${c.color};">From ${c.label}</span>`;
  }

  function statusBadge(status) {
    const c = STATUS_COLOURS[status] || { bg: '#f3f4f6', color: '#374151', label: esc(status) };
    return `<span style="padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${c.bg};color:${c.color};">${c.label}</span>`;
  }

  let allContacts = [];
  let summaryData = null;
  let debounceTimer = null;
  const $ = id => document.getElementById(id);

  // ── Summary cards ──────────────────────────────────────────────────────────
  function renderSummaryCards(s) {
    const grid = $('ecSummaryGrid');
    if (!grid || !s) {
      return;
    }
    const cards = [
      { value: s.new, label: 'New enquiries', accent: 'red', href: '?status=new' },
      { value: s.vexi, label: 'From VEXI', accent: 'blue', href: '?source=vexi' },
      { value: s.chlo, label: 'From Chlo', accent: 'purple', href: '?source=chlo' },
      { value: s.archived, label: 'Archived', accent: 'grey', href: '?status=archived' },
    ];
    grid.innerHTML = cards
      .map(
        c => `
      <a href="${c.href}" class="uc-summary-card uc-summary-card--${c.accent}" title="Filter">
        <div class="uc-summary-card__value">${c.value}</div>
        <div class="uc-summary-card__label">${c.label}</div>
      </a>`
      )
      .join('');
  }

  // ── Table rendering ────────────────────────────────────────────────────────
  function renderTable(contacts) {
    const tbody = $('ecTableBody');
    if (!tbody) {
      return;
    }

    if (!contacts.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="uc-empty-cell">
        <div class="admin-empty-state"><p>No enquiries match the current filters.</p>
        <button type="button" class="btn btn-ghost btn-sm" id="ecEmptyClearBtn">Clear filters</button></div>
      </td></tr>`;
      const btn = $('ecEmptyClearBtn');
      if (btn) {
        btn.addEventListener('click', clearFilters);
      }
      return;
    }

    tbody.innerHTML = contacts
      .map(c => {
        const preview = (c.subject || c.message || '').slice(0, 60);
        return `<tr class="ec-contact-row" tabindex="0" role="button" data-id="${esc(c.id)}" aria-label="View enquiry from ${esc(c.name || c.email || 'external contact')}">
        <td>${sourceBadge(c.source)}</td>
        <td class="uc-name-cell">
          <span class="uc-user-link">${esc(c.name || '—')}</span>
          <span class="uc-user-email">${esc(c.email || '')}</span>
        </td>
        <td style="font-size:13px;color:#374151;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(preview)}">${esc(preview) || '—'}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="uc-date-cell">${fmtDate(c.receivedAt || c.createdAt)}</td>
        <td class="uc-actions-cell">
          <button type="button" class="btn btn-ghost btn-xs ec-view-btn" data-id="${esc(c.id)}">View</button>
        </td>
      </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.ec-view-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openDetail(btn.dataset.id);
      });
    });

    tbody.querySelectorAll('.ec-contact-row').forEach(row => {
      row.addEventListener('click', () => openDetail(row.dataset.id));
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(row.dataset.id);
        }
      });
    });
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  function applyFilters() {
    const search = ($('ecSearch') || {}).value || '';
    const source = ($('ecSourceFilter') || {}).value || '';
    const status = ($('ecStatusFilter') || {}).value || '';
    const s = search.toLowerCase();

    const filtered = allContacts.filter(c => {
      if (source && c.source !== source) {
        return false;
      }
      if (status && c.status !== status) {
        return false;
      }
      if (
        s &&
        !(c.name || '').toLowerCase().includes(s) &&
        !(c.email || '').toLowerCase().includes(s) &&
        !(c.subject || '').toLowerCase().includes(s) &&
        !(c.message || '').toLowerCase().includes(s)
      ) {
        return false;
      }
      return true;
    });

    const statusEl = $('ecFilterStatus');
    if (statusEl) {
      statusEl.textContent =
        filtered.length === allContacts.length
          ? `${filtered.length} enquir${filtered.length !== 1 ? 'ies' : 'y'}`
          : `${filtered.length} of ${allContacts.length}`;
    }

    renderTable(filtered);
  }

  function clearFilters() {
    ['ecSearch', 'ecSourceFilter', 'ecStatusFilter'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
      }
    });
    applyFilters();
  }

  // Apply URL params on load
  function applyUrlFilters() {
    const p = new URLSearchParams(window.location.search);
    const map = { source: 'ecSourceFilter', status: 'ecStatusFilter', id: null };
    Object.entries(map).forEach(([param, id]) => {
      if (!id) {
        return;
      }
      const val = p.get(param);
      const el = $(id);
      if (val && el) {
        el.value = val;
      }
    });
    const idParam = p.get('id');
    if (idParam) {
      setTimeout(() => openDetail(idParam), 400);
    }
  }

  // ── Detail modal ───────────────────────────────────────────────────────────
  async function openDetail(id) {
    const modal = $('ecDetailModal');
    const body = $('ecDetailBody');
    if (!modal || !body) {
      return;
    }

    modal.hidden = false;
    body.innerHTML = '<div class="skeleton" style="height:200px;border-radius:8px;"></div>';

    try {
      const data = await AdminShared.api(`/api/admin/external-contacts/${encodeURIComponent(id)}`);
      const c = data.contact;
      if (!c) {
        throw new Error('Not found');
      }

      const src = SOURCE_COLOURS[c.source] || {
        bg: '#f3f4f6',
        color: '#374151',
        label: esc(c.source),
      };
      const pageHref = safeExternalHref(c.pageUrl);

      body.innerHTML = `
        <!-- Source banner -->
        <div style="padding:12px 16px;background:${src.bg};border-radius:10px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${src.color}" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <strong style="color:${src.color};font-size:13px;">From ${src.label}</strong>
          <span style="margin-left:auto;font-size:12px;color:#6b7280;">${fmtDate(c.receivedAt || c.createdAt)}</span>
        </div>

        <!-- Details grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-bottom:16px;">
          <div><div class="ud-info-label">Name</div><div class="ud-info-value">${esc(c.name || '—')}</div></div>
          <div><div class="ud-info-label">Email</div><div class="ud-info-value"><a href="mailto:${esc(c.email)}">${esc(c.email || '—')}</a></div></div>
          ${c.phone ? `<div><div class="ud-info-label">Phone</div><div class="ud-info-value">${esc(c.phone)}</div></div>` : ''}
          ${c.company ? `<div><div class="ud-info-label">Company</div><div class="ud-info-value">${esc(c.company)}</div></div>` : ''}
          ${pageHref ? `<div style="grid-column:1/-1"><div class="ud-info-label">Page URL</div><div class="ud-info-value"><a href="${esc(pageHref)}" target="_blank" rel="noopener noreferrer">${esc(c.pageUrl)}</a></div></div>` : ''}
        </div>

        ${c.subject ? `<div style="margin-bottom:12px;"><div class="ud-info-label">Subject</div><div class="ud-info-value">${esc(c.subject)}</div></div>` : ''}

        <!-- Message -->
        <div style="margin-bottom:16px;">
          <div class="ud-info-label">Message</div>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.65;color:#1f2937;white-space:pre-wrap;margin-top:4px;">${esc(c.message || '')}</div>
        </div>

        <!-- Status + notes -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <label for="ecStatusSelect" style="font-size:13px;font-weight:600;">Status:</label>
          <select id="ecStatusSelect" class="uc-filter-select" style="font-size:13px;">
            <option value="new"       ${c.status === 'new' ? 'selected' : ''}>New</option>
            <option value="in_review" ${c.status === 'in_review' ? 'selected' : ''}>In review</option>
            <option value="replied"   ${c.status === 'replied' ? 'selected' : ''}>Replied</option>
            <option value="archived"  ${c.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="ecSaveStatusBtn">Save status</button>
        </div>

        ${c.adminNotes ? `<div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;">${esc(c.adminNotes)}</div>` : ''}
      `;

      // Status save
      $('ecSaveStatusBtn').addEventListener('click', async () => {
        const newStatus = $('ecStatusSelect').value;
        try {
          await AdminShared.api(`/api/admin/external-contacts/${encodeURIComponent(id)}`, 'PATCH', {
            status: newStatus,
          });
          AdminShared.showToast('Status updated.', 'success');
          await loadData();
          openDetail(id);
        } catch (err) {
          AdminShared.showToast(`Failed: ${err.message}`, 'error');
        }
      });
    } catch (err) {
      body.innerHTML = `<p class="small">Failed to load: ${esc(err.message)}</p>`;
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadData() {
    try {
      const data = await AdminShared.api('/api/admin/external-contacts');
      allContacts = data.items || [];
      summaryData = data.summary || null;
      renderSummaryCards(summaryData);
      applyFilters();
    } catch {
      const tbody = $('ecTableBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="uc-empty-cell">Failed to load. Please refresh.</td></tr>';
      }
      AdminShared.showToast('Failed to load external contacts.', 'error');
    }
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    applyUrlFilters();

    $('ecRefreshBtn') && $('ecRefreshBtn').addEventListener('click', loadData);
    $('ecClearFilters') && $('ecClearFilters').addEventListener('click', clearFilters);
    $('ecCloseModal') &&
      $('ecCloseModal').addEventListener('click', () => {
        $('ecDetailModal').hidden = true;
      });
    $('ecModalBackdrop') &&
      $('ecModalBackdrop').addEventListener('click', () => {
        $('ecDetailModal').hidden = true;
      });

    document.addEventListener('keydown', e => {
      if (
        (e.key === 'Escape' || e.key === 'Esc') &&
        $('ecDetailModal') &&
        !$('ecDetailModal').hidden
      ) {
        $('ecDetailModal').hidden = true;
      }
    });

    ['ecSearch', 'ecSourceFilter', 'ecStatusFilter'].forEach(id => {
      const el = $(id);
      if (!el) {
        return;
      }
      el.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(applyFilters, 250);
      });
      el.addEventListener('change', applyFilters);
    });

    loadData();
  });
})();
