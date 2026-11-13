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
    archived: { bg: '#f0eee9', color: '#566176', label: 'Archived' },
  };

  function sourceBadge(source) {
    const c = SOURCE_COLOURS[source] || { bg: '#f0eee9', color: '#3d4955', label: esc(source) };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;background:${c.bg};color:${c.color};">From ${c.label}</span>`;
  }

  function statusBadge(status) {
    const c = STATUS_COLOURS[status] || { bg: '#f0eee9', color: '#3d4955', label: esc(status) };
    return `<span style="padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${c.bg};color:${c.color};">${c.label}</span>`;
  }

  let allContacts = [];
  let currentPage = 1;
  const CONTACT_PAGE_SIZE = 50;
  // The server allows at most 100 per request
  const REQUEST_SIZE = 100;
  const MAX_REQUESTS = 50;
  let contactPager = {
    update() {
      /* replaced once the pager is created */
    },
  };
  let summaryData = null;
  let debounceTimer = null;
  let detailRequest = 0;
  let detailTrigger = null;
  const byId = id => document.getElementById(id);

  function closeDetail() {
    byId('ecDetailModal').hidden = true;
    document.body.style.overflow = '';
    detailRequest++;
    detailTrigger?.focus();
    detailTrigger = null;
  }

  // ── Summary cards ──────────────────────────────────────────────────────────
  function renderSummaryCards(s) {
    const grid = byId('ecSummaryGrid');
    if (!grid || !s) {
      return;
    }
    const cards = [
      { value: s.new, label: 'New enquiries', accent: 'red', href: '?tab=external&status=new' },
      { value: s.vexi, label: 'From VEXI', accent: 'blue', href: '?tab=external&source=vexi' },
      { value: s.chlo, label: 'From Chlo', accent: 'purple', href: '?tab=external&source=chlo' },
      {
        value: s.archived,
        label: 'Archived',
        accent: 'grey',
        href: '?tab=external&status=archived',
      },
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
    const tbody = byId('ecTableBody');
    if (!tbody) {
      return;
    }

    if (!contacts.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="uc-empty-cell">
        <div class="admin-empty-state"><p>No enquiries match the current filters.</p>
        <button type="button" class="btn btn-ghost btn-sm" id="ecEmptyClearBtn">Clear filters</button></div>
      </td></tr>`;
      const btn = byId('ecEmptyClearBtn');
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
        <td style="font-size:13px;color:#3d4955;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(preview)}">${esc(preview) || '—'}</td>
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
  function applyFilters(options) {
    // Only a reload or a page change keeps the page; a filter or search change starts again at 1
    const keepPage = Boolean(options && options.keepPage === true);
    const search = (byId('ecSearch') || {}).value || '';
    const source = (byId('ecSourceFilter') || {}).value || '';
    const status = (byId('ecStatusFilter') || {}).value || '';
    const needle = search.toLowerCase();

    const filtered = allContacts.filter(c => {
      if (source && c.source !== source) {
        return false;
      }
      if (status && c.status !== status) {
        return false;
      }
      return (
        !needle ||
        [c.name, c.email, c.subject, c.message].some(value =>
          (value || '').toLowerCase().includes(needle)
        )
      );
    });

    const statusEl = byId('ecFilterStatus');
    if (statusEl) {
      statusEl.textContent =
        filtered.length === allContacts.length
          ? `${filtered.length} enquir${filtered.length !== 1 ? 'ies' : 'y'}`
          : `${filtered.length} of ${allContacts.length}`;
    }

    // Changing a filter or the search starts again from the first page
    if (!keepPage) {
      currentPage = 1;
    }
    const info = AdminPager.range(currentPage, CONTACT_PAGE_SIZE, filtered.length);
    currentPage = info.page;
    renderTable(AdminPager.slice(filtered, currentPage, CONTACT_PAGE_SIZE));
    contactPager.update({
      page: currentPage,
      size: CONTACT_PAGE_SIZE,
      total: filtered.length,
      noun: 'enquiries',
    });
  }

  function clearFilters() {
    ['ecSearch', 'ecSourceFilter', 'ecStatusFilter'].forEach(id => {
      const el = byId(id);
      if (el) {
        el.value = '';
      }
    });
    applyFilters();
  }

  // Apply URL params on load
  function applyUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    const map = { source: 'ecSourceFilter', status: 'ecStatusFilter', id: null };
    Object.entries(map).forEach(([param, id]) => {
      if (!id) {
        return;
      }
      const val = params.get(param);
      const el = byId(id);
      if (val && el) {
        el.value = val;
      }
    });
    const idParam = params.get('id');
    if (idParam) {
      setTimeout(() => openDetail(idParam), 400);
    }
  }

  // ── Detail modal ───────────────────────────────────────────────────────────
  async function openDetail(id) {
    const modal = byId('ecDetailModal');
    const body = byId('ecDetailBody');
    if (!modal || !body) {
      return;
    }

    if (modal.hidden) {
      detailTrigger = document.activeElement;
    }
    const request = ++detailRequest;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    byId('ecCloseModal').focus();
    body.innerHTML = '<div class="skeleton" style="height:200px;border-radius:8px;"></div>';

    try {
      const data = await AdminShared.api(`/api/admin/external-contacts/${encodeURIComponent(id)}`);
      if (request !== detailRequest || modal.hidden) {
        return;
      }
      const contact = data.contact;
      if (!contact) {
        throw new Error('Not found');
      }

      const src = SOURCE_COLOURS[contact.source] || {
        bg: '#f0eee9',
        color: '#3d4955',
        label: esc(contact.source),
      };
      const pageHref = safeExternalHref(contact.pageUrl);

      body.innerHTML = `
        <!-- Source banner -->
        <div style="padding:12px 16px;background:${src.bg};border-radius:10px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${src.color}" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <strong style="color:${src.color};font-size:13px;">From ${src.label}</strong>
          <span style="margin-left:auto;font-size:12px;color:#566176;">${fmtDate(contact.receivedAt || contact.createdAt)}</span>
        </div>

        <!-- Details grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-bottom:16px;">
          <div><div class="ud-info-label">Name</div><div class="ud-info-value">${esc(contact.name || '—')}</div></div>
          <div><div class="ud-info-label">Email</div><div class="ud-info-value"><a href="mailto:${esc(contact.email)}">${esc(contact.email || '—')}</a></div></div>
          ${contact.phone ? `<div><div class="ud-info-label">Phone</div><div class="ud-info-value">${esc(contact.phone)}</div></div>` : ''}
          ${contact.company ? `<div><div class="ud-info-label">Company</div><div class="ud-info-value">${esc(contact.company)}</div></div>` : ''}
          ${pageHref ? `<div style="grid-column:1/-1"><div class="ud-info-label">Page URL</div><div class="ud-info-value"><a href="${esc(pageHref)}" target="_blank" rel="noopener noreferrer">${esc(contact.pageUrl)}</a></div></div>` : ''}
        </div>

        ${contact.subject ? `<div style="margin-bottom:12px;"><div class="ud-info-label">Subject</div><div class="ud-info-value">${esc(contact.subject)}</div></div>` : ''}

        <!-- Message -->
        <div style="margin-bottom:16px;">
          <div class="ud-info-label">Message</div>
          <div style="background:#f7f6f3;border:1px solid #e8e5de;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.65;color:#17202f;white-space:pre-wrap;margin-top:4px;">${esc(contact.message || '')}</div>
        </div>

        <!-- Status + notes -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
          <label for="ecStatusSelect" style="font-size:13px;font-weight:600;">Status:</label>
          <select id="ecStatusSelect" class="uc-filter-select" style="font-size:13px;">
            <option value="new"       ${contact.status === 'new' ? 'selected' : ''}>New</option>
            <option value="in_review" ${contact.status === 'in_review' ? 'selected' : ''}>In review</option>
            <option value="replied"   ${contact.status === 'replied' ? 'selected' : ''}>Replied</option>
            <option value="archived"  ${contact.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="ecSaveStatusBtn">Save status</button>
        </div>

        ${contact.adminNotes ? `<div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;">${esc(contact.adminNotes)}</div>` : ''}
      `;

      // Status save
      byId('ecSaveStatusBtn').addEventListener('click', async () => {
        const newStatus = byId('ecStatusSelect').value;
        const saveButton = byId('ecSaveStatusBtn');
        saveButton.disabled = true;
        try {
          await AdminShared.api(`/api/admin/external-contacts/${encodeURIComponent(id)}`, 'PATCH', {
            status: newStatus,
          });
          AdminShared.showToast('Status updated.', 'success');
          // Update the copy already loaded instead of downloading every enquiry again: the list
          // and detail requests share a limit of 50 every five minutes
          applyStatusChange(id, newStatus);
          if (!modal.hidden) {
            openDetail(id);
          }
        } catch (err) {
          AdminShared.showToast(`Failed: ${err.message}`, 'error');
          saveButton.disabled = false;
        }
      });
    } catch (err) {
      if (request !== detailRequest || modal.hidden) {
        return;
      }
      body.innerHTML = `<p class="small">Failed to load: ${esc(err.message)}</p>`;
    }
  }

  // ── Local update after a status change ─────────────────────────────────────
  function summaryFrom(contacts) {
    const count = predicate => contacts.filter(predicate).length;
    return {
      total: contacts.length,
      new: count(c => c.status === 'new'),
      in_review: count(c => c.status === 'in_review'),
      replied: count(c => c.status === 'replied'),
      archived: count(c => c.status === 'archived'),
      vexi: count(c => c.source === 'vexi'),
      chlo: count(c => c.source === 'chlo'),
    };
  }

  function applyStatusChange(id, status) {
    const contact = allContacts.find(item => item.id === id);
    if (contact) {
      contact.status = status;
    }
    summaryData = summaryFrom(allContacts);
    renderSummaryCards(summaryData);
    showTabBadge();
    applyFilters({ keepPage: true });
  }

  let started = false;

  // The number of new enquiries, on the tab itself
  function showTabBadge(count) {
    const badge = byId('externalContactsBadge');
    if (!badge) {
      return;
    }
    const waiting = typeof count === 'number' ? count : summaryData?.new || 0;
    badge.textContent = String(waiting);
    badge.style.display = waiting > 0 ? '' : 'none';
  }

  // Before the tab is opened nothing of ours is loaded, so the badge uses the count the navbar
  // already fetched for the menu; once the list loads, its own summary takes over.
  function showNavbarCount(pending) {
    if (!started && pending && typeof pending.externalContacts === 'number') {
      showTabBadge(pending.externalContacts);
    }
  }
  document.addEventListener('admin:pending-counts', event => showNavbarCount(event.detail));

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadData() {
    try {
      // The server returns at most 100 a request, and used to hand back only the first 50, so
      // ask page by page until every enquiry is here
      let first = null;
      const everything = [];
      for (let requests = 0; requests < MAX_REQUESTS; requests += 1) {
        const data = await AdminShared.api(
          `/api/admin/external-contacts?limit=${REQUEST_SIZE}&skip=${everything.length}`
        );
        first = first || data;
        const batch = data.items || [];
        everything.push(...batch);
        if (batch.length < REQUEST_SIZE || everything.length >= (data.total || 0)) {
          break;
        }
      }
      const data = first || {};
      if (everything.length < (data.total || 0)) {
        AdminShared.showToast(
          `Showing the newest ${everything.length} of ${data.total} enquiries. Narrow the list with the filters to see the rest.`,
          'warning'
        );
      }
      allContacts = everything;
      summaryData = data.summary || null;
      renderSummaryCards(summaryData);
      showTabBadge();
      applyFilters({ keepPage: true });
    } catch {
      const tbody = byId('ecTableBody');
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="uc-empty-cell">Failed to load. Please refresh.</td></tr>';
      }
      AdminShared.showToast('Failed to load external contacts.', 'error');
    }
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  // These enquiries are the "External" tab of the Enquiries page (/admin-tickets?tab=external).
  // Nothing is loaded until that tab is first opened: the list and the detail share a limit of 50
  // requests every five minutes, so it should not be spent by people who only look at tickets.
  function start() {
    if (started) {
      return;
    }
    started = true;
    contactPager = AdminPager.mount({
      after: byId('ecTableBody').closest('table').parentElement,
      onChange(page) {
        currentPage = page;
        applyFilters({ keepPage: true });
      },
    });
    applyUrlFilters();

    byId('ecRefreshBtn') && byId('ecRefreshBtn').addEventListener('click', loadData);
    byId('ecClearFilters') && byId('ecClearFilters').addEventListener('click', clearFilters);
    byId('ecCloseModal')?.addEventListener('click', closeDetail);
    byId('ecModalBackdrop')?.addEventListener('click', closeDetail);

    document.addEventListener('keydown', e => {
      if (
        (e.key === 'Escape' || e.key === 'Esc') &&
        byId('ecDetailModal') &&
        !byId('ecDetailModal').hidden
      ) {
        closeDetail();
      }
      if (e.key === 'Tab' && !byId('ecDetailModal').hidden) {
        const controls = [
          ...byId('ecDetailModal').querySelectorAll(
            'button:not([disabled]), select:not([disabled]), a[href]'
          ),
        ];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    ['ecSearch', 'ecSourceFilter', 'ecStatusFilter'].forEach(id => {
      const el = byId(id);
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
  }

  showNavbarCount(window.AdminPendingCounts);
  window.AdminExternalContacts = { start };
})();
