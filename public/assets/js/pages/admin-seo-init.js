/**
 * Admin SEO Insights page initialisation
 * Fetches Search Console / keyword-gap data and renders the dashboard.
 */

(function () {
  'use strict';

  function formatNumber(value) {
    if (value === null || value === undefined) {
      return '—';
    }
    return Number(value).toLocaleString('en-GB');
  }

  function formatPercent(value) {
    if (value === null || value === undefined) {
      return '—';
    }
    return `${(Number(value) * 100).toFixed(1)}%`;
  }

  function formatGBP(value) {
    if (value === null || value === undefined) {
      return '—';
    }
    return `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      ch =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]
    );
  }

  async function loadStatus() {
    const bar = document.getElementById('seoSourceBar');
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/status');
      const gscBadge = data.gscConfigured
        ? '<span class="seo-source-badge ok">Search Console: connected</span>'
        : '<span class="seo-source-badge warn">Search Console: not configured</span>';
      const adsBadge = data.googleAdsConfigured
        ? '<span class="seo-source-badge ok">Google Ads API: connected</span>'
        : '<span class="seo-source-badge warn">Google Ads API: not configured — use CSV import</span>';

      const csvStatus = (data.ingestionStatus || []).find(s => s.id === 'keyword_csv');
      const csvBadge = csvStatus
        ? `<span class="seo-source-badge ok">CSV fallback: last imported ${new Date(csvStatus.lastRunAt).toLocaleDateString('en-GB')}</span>`
        : '';

      bar.innerHTML = `${gscBadge} ${adsBadge} ${csvBadge}`;
    } catch (error) {
      bar.textContent = `Could not load data source status: ${error.message}`;
    }
  }

  async function loadOverview() {
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/overview');
      document.getElementById('seo-totalQueries').textContent = formatNumber(
        data.totalNonBrandedQueries
      );
      document.getElementById('seo-totalImpressions').textContent = formatNumber(
        data.totalImpressions
      );
      document.getElementById('seo-strikingCount').textContent = formatNumber(
        data.strikingDistanceCount
      );
      document.getElementById('seo-lowCtrCount').textContent = formatNumber(data.lowCtrCount);
      document.getElementById('seo-gapCount').textContent = formatNumber(data.contentGapCount);
    } catch (error) {
      AdminShared.showToast(`Could not load overview: ${error.message}`, 'error');
    }
  }

  async function loadFinancialEstimate() {
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/financial-estimate');
      const el = document.getElementById('seo-financialEstimate');
      el.textContent = data.needsValuePerClick
        ? 'Set value/click below'
        : formatGBP(data.estimatedMonthlyValue);
    } catch (error) {
      document.getElementById('seo-financialEstimate').textContent = '—';
    }
  }

  async function loadSettings() {
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/settings');
      const input = document.getElementById('seo-valuePerClick');
      if (data.valuePerClick !== null && data.valuePerClick !== undefined) {
        input.value = data.valuePerClick;
      }
    } catch (_error) {
      // Non-fatal — leave the field blank
    }
  }

  function renderTable(tableEl, columns, rows, emptyMessage) {
    if (!rows || rows.length === 0) {
      tableEl.innerHTML = `<tr><td class="seo-empty">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }
    const head = `<thead><tr>${columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows
      .map(
        row =>
          `<tr>${columns.map(c => `<td class="${c.wrap ? 'wrap' : ''}">${c.render ? c.render(row) : escapeHtml(row[c.key])}</td>`).join('')}</tr>`
      )
      .join('')}</tbody>`;
    tableEl.innerHTML = head + body;
  }

  async function loadStrikingDistance() {
    const table = document.getElementById('seo-strikingTable');
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/striking-distance');
      renderTable(
        table,
        [
          { key: 'query', label: 'Query', wrap: true },
          { key: 'position', label: 'Position', render: r => Number(r.position).toFixed(1) },
          { key: 'impressions', label: 'Impressions', render: r => formatNumber(r.impressions) },
          { key: 'ctr', label: 'CTR', render: r => formatPercent(r.ctr) },
          {
            key: 'opportunityScore',
            label: 'Opportunity score',
            render: r => formatNumber(r.opportunityScore),
          },
        ],
        data.rows,
        'No striking-distance queries yet — pull Search Console data above.'
      );
    } catch (error) {
      table.innerHTML = `<tr><td class="seo-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadLowCtr() {
    const table = document.getElementById('seo-lowCtrTable');
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/low-ctr');
      renderTable(
        table,
        [
          { key: 'query', label: 'Query', wrap: true },
          { key: 'position', label: 'Position', render: r => Number(r.position).toFixed(1) },
          { key: 'ctr', label: 'Actual CTR', render: r => formatPercent(r.ctr) },
          { key: 'expectedCtr', label: 'Expected CTR', render: r => formatPercent(r.expectedCtr) },
          { key: 'impressions', label: 'Impressions', render: r => formatNumber(r.impressions) },
        ],
        data.rows,
        'No low-CTR opportunities yet — pull Search Console data above.'
      );
    } catch (error) {
      table.innerHTML = `<tr><td class="seo-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadContentGaps() {
    const table = document.getElementById('seo-gapsTable');
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/content-gaps');
      renderTable(
        table,
        [
          { key: 'keyword', label: 'Keyword', wrap: true },
          {
            key: 'avgMonthlySearches',
            label: 'Avg. monthly searches',
            render: r =>
              `${formatNumber(r.avgMonthlySearches)}${r.volumeIsBucketed ? ' (range)' : ''}`,
          },
          { key: 'competition', label: 'Competition' },
          { key: 'source', label: 'Source' },
        ],
        data.rows,
        'No content gaps found yet — import keyword volume data above.'
      );
    } catch (error) {
      table.innerHTML = `<tr><td class="seo-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function markNoise(query) {
    try {
      await AdminShared.api('/api/v2/admin/seo/noise', 'POST', {
        query,
        reason: 'Marked from dashboard',
      });
      AdminShared.showToast(`Marked "${query}" as noise`, 'success');
      await Promise.all([loadQueries(), loadOverview(), loadStrikingDistance(), loadLowCtr()]);
    } catch (error) {
      AdminShared.showToast(`Could not mark as noise: ${error.message}`, 'error');
    }
  }

  async function loadQueries() {
    const table = document.getElementById('seo-queriesTable');
    try {
      const { data } = await AdminShared.api('/api/v2/admin/seo/queries');
      renderTable(
        table,
        [
          { key: 'query', label: 'Query', wrap: true },
          { key: 'clicks', label: 'Clicks', render: r => formatNumber(r.clicks) },
          { key: 'impressions', label: 'Impressions', render: r => formatNumber(r.impressions) },
          { key: 'ctr', label: 'CTR', render: r => formatPercent(r.ctr) },
          { key: 'position', label: 'Position', render: r => Number(r.position).toFixed(1) },
          {
            key: 'actions',
            label: '',
            render: r =>
              `<button class="seo-btn-link" data-noise-query="${escapeHtml(r.query)}">Mark as noise</button>`,
          },
        ],
        data.rows,
        'No Search Console data yet — pull it above.'
      );
      table.querySelectorAll('[data-noise-query]').forEach(btn => {
        btn.addEventListener('click', () => markNoise(btn.getAttribute('data-noise-query')));
      });
    } catch (error) {
      table.innerHTML = `<tr><td class="seo-empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadAll() {
    await Promise.all([
      loadStatus(),
      loadOverview(),
      loadFinancialEstimate(),
      loadSettings(),
      loadStrikingDistance(),
      loadLowCtr(),
      loadContentGaps(),
      loadQueries(),
    ]);
  }

  function wireActions() {
    document.getElementById('seo-runGsc').addEventListener('click', async event => {
      event.target.disabled = true;
      try {
        const { data } = await AdminShared.api('/api/v2/admin/seo/ingest/gsc', 'POST');
        AdminShared.showToast(
          `Pulled ${data.rowsWritten} query rows from Search Console`,
          'success'
        );
        await loadAll();
      } catch (error) {
        AdminShared.showToast(`Search Console pull failed: ${error.message}`, 'error');
      } finally {
        event.target.disabled = false;
      }
    });

    document.getElementById('seo-runKeywordPlanner').addEventListener('click', async event => {
      event.target.disabled = true;
      try {
        const { data } = await AdminShared.api('/api/v2/admin/seo/ingest/keyword-planner', 'POST');
        AdminShared.showToast(
          `Pulled ${data.rowsWritten} keyword ideas from Google Ads`,
          'success'
        );
        await loadAll();
      } catch (error) {
        AdminShared.showToast(
          `Google Ads pull failed: ${error.message} — try the CSV import instead`,
          'error'
        );
      } finally {
        event.target.disabled = false;
      }
    });

    document.getElementById('seo-csvInput').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      try {
        const response = await fetch('/api/v2/admin/seo/ingest/keyword-csv', {
          method: 'POST',
          credentials: 'include',
          headers: window.__CSRF_TOKEN__ ? { 'X-CSRF-Token': window.__CSRF_TOKEN__ } : {},
          body: formData,
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Import failed');
        }
        AdminShared.showToast(
          `Imported ${result.data.rowsWritten} keyword rows from CSV`,
          'success'
        );
        await loadAll();
      } catch (error) {
        AdminShared.showToast(`CSV import failed: ${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    document.getElementById('seo-saveValuePerClick').addEventListener('click', async () => {
      const raw = document.getElementById('seo-valuePerClick').value;
      const valuePerClick = raw === '' ? null : Number(raw);
      try {
        await AdminShared.api('/api/v2/admin/seo/settings', 'PUT', { valuePerClick });
        AdminShared.showToast('Saved', 'success');
        await loadFinancialEstimate();
      } catch (error) {
        AdminShared.showToast(`Could not save: ${error.message}`, 'error');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireActions();
    loadAll();
  });
})();
