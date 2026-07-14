(function () {
  'use strict';

  const SUMMARY_ENDPOINT = '/api/v1/analytics/behaviour/admin/summary';
  const HOMEPAGE_MANAGER_ENDPOINT = '/api/v1/admin/homepage/manager';
  const state = {
    current: null,
    previous: null,
    manager: null,
    loading: false,
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function number(value) {
    return Number(value) || 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-GB').format(number(value));
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(number(seconds)));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  function formatPercent(value) {
    return `${number(value).toFixed(1)}%`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return response.json();
  }

  function reportingDays() {
    const range = document.getElementById('behaviourAnalyticsRange');
    return range ? Number(range.value) || 30 : 30;
  }

  function correctRevenueDefinition() {
    const cardValue = document.getElementById('an-totalRevenue');
    const card = cardValue && cardValue.closest('.stat-card');
    const label = card && card.querySelector('.stat-label');
    if (label) {
      label.textContent = 'Stripe Revenue (Latest Charges)';
    }
    const note = document.getElementById('an-totalRevenueNote');
    if (note && !note.textContent) {
      note.textContent = 'Latest available Stripe charge sample';
    }
  }

  function buildSection() {
    const section = document.createElement('section');
    section.id = 'analyticsDecisionSection';
    section.className = 'container analytics-decision-section';
    section.setAttribute('aria-labelledby', 'analyticsDecisionTitle');
    section.innerHTML = `
      <div class="analytics-decision-header">
        <div>
          <span class="analytics-decision-eyebrow">Decision dashboard</span>
          <h2 id="analyticsDecisionTitle">What changed, what converted and what needs attention</h2>
          <p>Period comparisons and EventFlow-specific performance using the same consented first-party data.</p>
        </div>
        <button id="analyticsExportCsv" type="button" class="btn-secondary">Export current period CSV</button>
      </div>

      <div id="analyticsComparisonGrid" class="analytics-comparison-grid" aria-label="Current versus previous period">
        <div class="analytics-decision-empty">Loading period comparison…</div>
      </div>

      <div class="analytics-decision-grid analytics-decision-grid--two">
        <article class="analytics-decision-card">
          <div class="analytics-decision-card__header">
            <div><span>Conversion quality</span><h3>Completed actions by type</h3></div>
            <strong id="analyticsConversionRate">—</strong>
          </div>
          <p class="analytics-decision-card__intro">Actions and unique converting sessions are shown separately so repeated actions are not mistaken for unique customers.</p>
          <div id="analyticsConversionBreakdown" class="analytics-decision-list"><div class="analytics-decision-empty">Loading conversions…</div></div>
        </article>

        <article class="analytics-decision-card">
          <div class="analytics-decision-card__header">
            <div><span>Homepage performance</span><h3>Live and preview homepage paths</h3></div>
            <strong id="analyticsActiveHomepage">—</strong>
          </div>
          <p class="analytics-decision-card__intro">Preview paths are version-specific. Historic visits to the live root path remain labelled as live because the active version can change later.</p>
          <div id="analyticsHomepageTable" class="analytics-decision-table-wrap"><div class="analytics-decision-empty">Loading homepage performance…</div></div>
        </article>
      </div>

      <div class="analytics-decision-grid analytics-decision-grid--two">
        <article class="analytics-decision-card">
          <div class="analytics-decision-card__header"><div><span>Marketplace intelligence</span><h3>Supplier signals</h3></div></div>
          <div id="analyticsSupplierPerformance" class="analytics-decision-table-wrap"><div class="analytics-decision-empty">Loading supplier signals…</div></div>
        </article>
        <article class="analytics-decision-card">
          <div class="analytics-decision-card__header"><div><span>Marketplace intelligence</span><h3>Package signals</h3></div></div>
          <div id="analyticsPackagePerformance" class="analytics-decision-table-wrap"><div class="analytics-decision-empty">Loading package signals…</div></div>
        </article>
      </div>

      <article class="analytics-decision-card analytics-definition-card">
        <div class="analytics-decision-card__header"><div><span>Data confidence</span><h3>Definitions and limits</h3></div></div>
        <div id="analyticsDefinitions" class="analytics-definition-grid"><div class="analytics-decision-empty">Loading definitions…</div></div>
      </article>
    `;
    return section;
  }

  function ensureSection() {
    let section = document.getElementById('analyticsDecisionSection');
    if (section) return section;
    const behaviour = document.getElementById('behaviourAnalyticsSection');
    if (!behaviour || !behaviour.parentNode) return null;
    section = buildSection();
    behaviour.insertAdjacentElement('afterend', section);
    document.getElementById('analyticsExportCsv')?.addEventListener('click', exportCsv);
    return section;
  }

  function delta(current, previous, lowerIsBetter) {
    const currentValue = number(current);
    const previousValue = number(previous);
    if (previousValue === 0) {
      return {
        label: currentValue === 0 ? 'No change' : 'New activity',
        tone: currentValue === 0 ? 'neutral' : lowerIsBetter ? 'warning' : 'positive',
      };
    }
    const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
    const improved = lowerIsBetter ? change < 0 : change > 0;
    return {
      label: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
      tone: Math.abs(change) < 0.05 ? 'neutral' : improved ? 'positive' : 'warning',
    };
  }

  function comparisonMetric(label, current, previous, formatter, lowerIsBetter) {
    const change = delta(current, previous, lowerIsBetter);
    return `
      <article class="analytics-comparison-card" data-tone="${change.tone}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatter(current))}</strong>
        <small><b>${escapeHtml(change.label)}</b> vs previous period · ${escapeHtml(formatter(previous))}</small>
      </article>`;
  }

  function renderComparisons(current, previous) {
    const grid = document.getElementById('analyticsComparisonGrid');
    if (!grid) return;
    const currentTotals = current.totals || {};
    const previousTotals = previous.totals || {};
    const currentConversions = current.decision?.conversions || {};
    const previousConversions = previous.decision?.conversions || {};
    grid.innerHTML = [
      comparisonMetric('Sessions', currentTotals.sessions, previousTotals.sessions, formatNumber, false),
      comparisonMetric('Page views', currentTotals.pageViews, previousTotals.pageViews, formatNumber, false),
      comparisonMetric(
        'Average active time',
        currentTotals.avgActiveSecondsPerSession,
        previousTotals.avgActiveSecondsPerSession,
        formatDuration,
        false
      ),
      comparisonMetric(
        'Engaged sessions',
        currentTotals.engagedSessionRate,
        previousTotals.engagedSessionRate,
        formatPercent,
        false
      ),
      comparisonMetric(
        'Converting sessions',
        currentConversions.uniqueSessions,
        previousConversions.uniqueSessions,
        formatNumber,
        false
      ),
      comparisonMetric(
        'Browser errors',
        currentTotals.clientErrors,
        previousTotals.clientErrors,
        formatNumber,
        true
      ),
    ].join('');
  }

  function renderConversions(decision) {
    const conversions = decision?.conversions || {};
    const container = document.getElementById('analyticsConversionBreakdown');
    const rate = document.getElementById('analyticsConversionRate');
    if (rate) {
      rate.textContent = `${formatNumber(conversions.uniqueSessions)} sessions · ${formatPercent(conversions.sessionRate)}`;
    }
    if (!container) return;
    const rows = Array.isArray(conversions.byType) ? conversions.byType : [];
    container.innerHTML = rows
      .map(
        row => `<div class="analytics-decision-list__row"><span>${escapeHtml(row.label)}</span><strong>${formatNumber(row.count)}</strong></div>`
      )
      .join('') || '<div class="analytics-decision-empty">No completed conversion actions in this period.</div>';
  }

  function renderHomepage(decision, manager) {
    const active = manager?.manager?.activeVersion || manager?.activeVersion || 'unknown';
    const badge = document.getElementById('analyticsActiveHomepage');
    if (badge) badge.textContent = active === 'unknown' ? 'Active version unavailable' : `${String(active).toUpperCase()} currently live`;
    const container = document.getElementById('analyticsHomepageTable');
    if (!container) return;
    const rows = Array.isArray(decision?.homepagePerformance) ? decision.homepagePerformance : [];
    if (!rows.length) {
      container.innerHTML = '<div class="analytics-decision-empty">No homepage behaviour data in this period.</div>';
      return;
    }
    container.innerHTML = `
      <table class="analytics-decision-table">
        <thead><tr><th>Homepage path</th><th>Views</th><th>Sessions</th><th>Avg active</th><th>Engaged</th><th>Exit</th><th>Bounce</th></tr></thead>
        <tbody>${rows
          .map(
            row => `<tr>
              <td><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml((row.paths || []).join(', '))}</small></td>
              <td>${formatNumber(row.views)}</td><td>${formatNumber(row.sessions)}</td><td>${formatDuration(row.avgActiveSeconds)}</td>
              <td>${formatPercent(row.engagedRate)}</td><td>${formatPercent(row.exitRate)}</td><td>${formatPercent(row.bounceRate)}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table>`;
  }

  function entityLink(type, id) {
    if (type === 'supplier') return `/supplier/${encodeURIComponent(id)}`;
    return `/package/${encodeURIComponent(id)}`;
  }

  function renderEntities(id, rows, type) {
    const container = document.getElementById(id);
    if (!container) return;
    const data = Array.isArray(rows) ? rows : [];
    if (!data.length) {
      container.innerHTML = `<div class="analytics-decision-empty">No ${escapeHtml(type)} IDs were attached to measured actions in this period.</div>`;
      return;
    }
    container.innerHTML = `
      <table class="analytics-decision-table">
        <thead><tr><th>${type === 'supplier' ? 'Supplier' : 'Package'}</th><th>Views</th><th>Saves</th><th>Enquiries</th><th>Rate</th></tr></thead>
        <tbody>${data
          .map(
            row => `<tr><td><a href="${escapeHtml(entityLink(type, row.id))}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.id)}</a><small>${formatNumber(row.sessions)} measured sessions</small></td><td>${formatNumber(row.views)}</td><td>${formatNumber(row.saves)}</td><td>${formatNumber(row.enquiries)}</td><td>${formatPercent(row.enquiryRate)}</td></tr>`
          )
          .join('')}</tbody>
      </table>`;
  }

  function renderDefinitions(decision) {
    const container = document.getElementById('analyticsDefinitions');
    if (!container) return;
    const definitions = decision?.definitions || {};
    const labels = {
      conversions: 'Conversions',
      sessions: 'Sessions',
      homepage: 'Homepage versions',
      consent: 'Traffic coverage',
    };
    container.innerHTML = Object.entries(definitions)
      .map(([key, value]) => `<div><strong>${escapeHtml(labels[key] || key)}</strong><p>${escapeHtml(value)}</p></div>`)
      .join('');
  }

  function csvCell(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!state.current) return;
    const rows = [['section', 'label', 'value', 'secondary_value']];
    const totals = state.current.totals || {};
    Object.entries(totals).forEach(([key, value]) => rows.push(['totals', key, value, '']));
    (state.current.decision?.conversions?.byType || []).forEach(row =>
      rows.push(['conversion', row.label, row.count, row.event])
    );
    (state.current.decision?.homepagePerformance || []).forEach(row =>
      rows.push(['homepage', row.label, row.sessions, row.views])
    );
    (state.current.decision?.entities?.suppliers || []).forEach(row =>
      rows.push(['supplier', row.id, row.enquiries, row.views])
    );
    (state.current.decision?.entities?.packages || []).forEach(row =>
      rows.push(['package', row.id, row.enquiries, row.views])
    );
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `eventflow-analytics-${reportingDays()}-days.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function render() {
    if (!state.current || !state.previous) return;
    renderComparisons(state.current, state.previous);
    renderConversions(state.current.decision);
    renderHomepage(state.current.decision, state.manager);
    renderEntities(
      'analyticsSupplierPerformance',
      state.current.decision?.entities?.suppliers,
      'supplier'
    );
    renderEntities(
      'analyticsPackagePerformance',
      state.current.decision?.entities?.packages,
      'package'
    );
    renderDefinitions(state.current.decision);
  }

  async function load() {
    if (state.loading || !ensureSection()) return;
    state.loading = true;
    document.getElementById('analyticsDecisionSection')?.classList.add('is-loading');
    const days = reportingDays();
    try {
      const [currentPayload, previousPayload, managerPayload] = await Promise.all([
        fetchJson(`${SUMMARY_ENDPOINT}?days=${encodeURIComponent(days)}`),
        fetchJson(`${SUMMARY_ENDPOINT}?days=${encodeURIComponent(days)}&offsetDays=${encodeURIComponent(days)}`),
        fetchJson(HOMEPAGE_MANAGER_ENDPOINT).catch(() => null),
      ]);
      state.current = currentPayload.summary || {};
      state.previous = previousPayload.summary || {};
      state.manager = managerPayload;
      render();
    } catch (error) {
      const grid = document.getElementById('analyticsComparisonGrid');
      if (grid) {
        grid.innerHTML = `<div class="analytics-decision-empty analytics-decision-error">${escapeHtml(error.message || 'Decision analytics could not be loaded.')}</div>`;
      }
    } finally {
      state.loading = false;
      document.getElementById('analyticsDecisionSection')?.classList.remove('is-loading');
    }
  }

  function bind() {
    correctRevenueDefinition();
    const observer = new MutationObserver(function () {
      if (ensureSection()) {
        observer.disconnect();
        document.getElementById('behaviourAnalyticsRange')?.addEventListener('change', load);
        document.getElementById('analyticsRefreshBtn')?.addEventListener('click', load);
        load();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (ensureSection()) {
      observer.disconnect();
      document.getElementById('behaviourAnalyticsRange')?.addEventListener('change', load);
      document.getElementById('analyticsRefreshBtn')?.addEventListener('click', load);
      load();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
