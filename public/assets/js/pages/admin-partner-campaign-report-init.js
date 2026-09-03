'use strict';
(function () {
  let report = null;
  let filteredItems = [];

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) {
      return '—';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function text(value, fallback) {
    return value && value !== 'direct_or_unknown' && value !== 'unknown_medium' ? value : fallback;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function qualifierPills(item) {
    const pills = [];
    if (item.packageQualified) {
      pills.push('<span class="pcr-pill">Package</span>');
    }
    if (item.subscriptionQualified) {
      pills.push('<span class="pcr-pill">Subscription</span>');
    }
    if (item.firstReviewQualified) {
      pills.push('<span class="pcr-pill">Review</span>');
    }
    return pills.length ? pills.join(' ') : '<span class="pcr-muted">None yet</span>';
  }

  function renderCampaignSummary() {
    const body = document.getElementById('pcr-campaign-body');
    if (!body) {
      return;
    }
    const rows = (report.campaignSummary || []).slice(0, 25);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="pcr-empty">No campaign data yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(
        row => `<tr>
      <td>${esc(text(row.source, 'Direct / unknown'))}</td>
      <td>${esc(text(row.medium, 'Unknown'))}</td>
      <td>${esc(text(row.campaign, 'No campaign'))}</td>
      <td><strong>${esc(row.referrals)}</strong></td>
      <td>${esc(row.packageQualified)}</td>
      <td>${esc(row.subscriptionQualified)}</td>
      <td><strong>${esc(row.pointsAwarded)}</strong></td>
    </tr>`
      )
      .join('');
  }

  function renderPartnerSummary() {
    const body = document.getElementById('pcr-partner-body');
    if (!body) {
      return;
    }
    const rows = (report.partnerSummary || []).slice(0, 25);
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="pcr-empty">No partner referral data yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(
        row => `<tr>
      <td><strong>${esc(row.partnerName)}</strong>${row.partnerEmail ? `<div class="pcr-muted">${esc(row.partnerEmail)}</div>` : ''}</td>
      <td><code>${esc(row.partnerRefCode || '—')}</code></td>
      <td><strong>${esc(row.referrals)}</strong></td>
      <td>${esc(row.packageQualified)}</td>
      <td>${esc(row.subscriptionQualified)}</td>
      <td><strong>${esc(row.pointsAwarded)}</strong></td>
    </tr>`
      )
      .join('');
  }

  function renderItems() {
    const body = document.getElementById('pcr-items-body');
    if (!body) {
      return;
    }
    if (!filteredItems.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="pcr-empty">No referrals match your search.</td></tr>';
      return;
    }
    body.innerHTML = filteredItems
      .slice(0, 100)
      .map(
        item => `<tr>
      <td><strong>${esc(item.partnerName)}</strong><div class="pcr-muted">${esc(item.partnerRefCode || '—')}</div></td>
      <td><strong>${esc(item.supplierName)}</strong>${item.supplierCompany ? `<div class="pcr-muted">${esc(item.supplierCompany)}</div>` : ''}</td>
      <td>${esc(text(item.source, 'Direct / unknown'))}<div class="pcr-muted">${esc(text(item.medium, 'Unknown'))}</div></td>
      <td>${esc(text(item.campaign, 'No campaign'))}${item.content ? `<div class="pcr-muted">${esc(item.content)}</div>` : ''}</td>
      <td>${qualifierPills(item)}</td>
      <td><strong>${esc(item.pointsAwarded)}</strong></td>
      <td>${esc(fmtDate(item.supplierCreatedAt || item.createdAt))}</td>
    </tr>`
      )
      .join('');
  }

  function applySearch() {
    const q = (document.getElementById('pcr-search')?.value || '').toLowerCase().trim();
    const items = report?.items || [];
    filteredItems = !q
      ? items
      : items.filter(item =>
          [
            item.partnerName,
            item.partnerEmail,
            item.partnerRefCode,
            item.supplierName,
            item.supplierEmail,
            item.supplierCompany,
            item.source,
            item.medium,
            item.campaign,
            item.content,
            item.term,
          ].some(value =>
            String(value || '')
              .toLowerCase()
              .includes(q)
          )
        );
    renderItems();
  }

  function renderReport(data) {
    report = data || { totals: {}, items: [], campaignSummary: [], partnerSummary: [] };
    filteredItems = report.items || [];
    const totals = report.totals || {};
    setText('pcr-total-referrals', (totals.referrals || 0).toLocaleString());
    setText('pcr-total-campaigns', (totals.campaignCount || 0).toLocaleString());
    setText('pcr-total-partners', (totals.partnerCount || 0).toLocaleString());
    setText('pcr-total-points', (totals.pointsAwarded || 0).toLocaleString());
    renderCampaignSummary();
    renderPartnerSummary();
    applySearch();
  }

  async function loadReport() {
    const campaignBody = document.getElementById('pcr-campaign-body');
    const partnerBody = document.getElementById('pcr-partner-body');
    const itemBody = document.getElementById('pcr-items-body');
    if (campaignBody) {
      campaignBody.innerHTML = '<tr><td colspan="7" class="pcr-empty">Loading…</td></tr>';
    }
    if (partnerBody) {
      partnerBody.innerHTML = '<tr><td colspan="6" class="pcr-empty">Loading…</td></tr>';
    }
    if (itemBody) {
      itemBody.innerHTML = '<tr><td colspan="7" class="pcr-empty">Loading…</td></tr>';
    }

    try {
      const data = await AdminShared.api('/api/admin/partners/campaign-report');
      renderReport(data);
    } catch (err) {
      const msg = esc(err.message || 'Failed to load campaign report.');
      if (campaignBody) {
        campaignBody.innerHTML = `<tr><td colspan="7" class="pcr-empty">${msg}</td></tr>`;
      }
      if (partnerBody) {
        partnerBody.innerHTML = `<tr><td colspan="6" class="pcr-empty">${msg}</td></tr>`;
      }
      if (itemBody) {
        itemBody.innerHTML = `<tr><td colspan="7" class="pcr-empty">${msg}</td></tr>`;
      }
    }
  }

  function init() {
    document.getElementById('pcr-refresh')?.addEventListener('click', loadReport);
    document.getElementById('pcr-search')?.addEventListener('input', applySearch);
    loadReport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
