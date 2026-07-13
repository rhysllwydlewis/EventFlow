(function () {
  'use strict';

  const SUMMARY_ENDPOINT = '/api/v1/analytics/behaviour/admin/summary';
  const STATUS_ENDPOINT = '/api/v1/analytics/behaviour/admin/status';
  const STYLE_PATH = '/assets/css/admin-behaviour-analytics.css?v=1';

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-GB').format(Number(value) || 0);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes < 60) return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const minuteRemainder = minutes % 60;
    return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
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

  function ensureStyles() {
    if (document.querySelector(`link[href^="${STYLE_PATH.split('?')[0]}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_PATH;
    document.head.appendChild(link);
  }

  function buildSection() {
    const section = document.createElement('section');
    section.id = 'behaviourAnalyticsSection';
    section.className = 'container behaviour-analytics-section';
    section.setAttribute('aria-labelledby', 'behaviourAnalyticsTitle');
    section.innerHTML = `
      <div class="section-header section-spacer">
        <div class="behaviour-analytics-toolbar">
          <div>
            <h2 class="section-title" id="behaviourAnalyticsTitle">Visitor Behaviour &amp; Engagement</h2>
            <p class="section-description">Consented active time, page performance, journeys and conversion signals.</p>
          </div>
          <div class="behaviour-analytics-toolbar__controls">
            <span id="behaviourAnalyticsStatus" class="analytics-provider-status" data-state="warning">Checking analytics…</span>
            <label>
              Period
              <select id="behaviourAnalyticsRange" aria-label="Behaviour analytics period">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <a id="behaviourPosthogLink" class="btn-secondary" href="#" target="_blank" rel="noopener noreferrer" hidden>Open PostHog ↗</a>
          </div>
        </div>
      </div>

      <div class="behaviour-kpi-grid" aria-label="Behaviour analytics headline metrics">
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Page views</span><strong id="baPageViews" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">Consented views</span></div>
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Sessions</span><strong id="baSessions" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">Anonymous or signed-in</span></div>
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Avg active time</span><strong id="baActiveTime" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">Visible and focused</span></div>
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Engaged sessions</span><strong id="baEngaged" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">10s+ or 2+ pages</span></div>
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Conversions</span><strong id="baConversions" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">Completed key actions</span></div>
        <div class="behaviour-kpi"><span class="behaviour-kpi__label">Browser errors</span><strong id="baErrors" class="behaviour-kpi__value">—</strong><span class="behaviour-kpi__note">Client-side signals</span></div>
      </div>

      <div class="behaviour-analytics-grid">
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header"><div><h3>Page performance</h3><p>Active engagement, exits and short single-page sessions.</p></div></div>
          <div class="behaviour-table-wrap">
            <table class="behaviour-table" aria-label="Behaviour analytics by page">
              <thead><tr><th>Page</th><th>Views</th><th>Sessions</th><th>Avg active</th><th>Engaged</th><th>Exit</th><th>Bounce</th></tr></thead>
              <tbody id="baPagesBody"><tr><td colspan="7" class="behaviour-empty">Loading page analytics…</td></tr></tbody>
            </table>
          </div>
        </article>
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header"><div><h3>Marketplace journey</h3><p>Unique sessions reaching each step.</p></div></div>
          <div id="baFunnel" class="behaviour-funnel"><div class="behaviour-empty">Loading funnel…</div></div>
        </article>
      </div>

      <div class="behaviour-analytics-grid">
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header"><div><h3>Traffic sources</h3><p>Referring domains only; full URLs and query strings are not stored.</p></div></div>
          <div id="baReferrers" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading sources…</div></div>
        </article>
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header"><div><h3>Device mix</h3><p>Broad device categories derived in the browser.</p></div></div>
          <div id="baDevices" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading devices…</div></div>
        </article>
      </div>

      <article class="behaviour-analytics-card">
        <div class="behaviour-analytics-card__header"><div><h3>Improvement signals</h3><p>Automated prompts based on engagement, exits, bounces and errors.</p></div></div>
        <div id="baRecommendations" class="behaviour-recommendations"><div class="behaviour-empty">Loading recommendations…</div></div>
      </article>

      <div class="behaviour-privacy-note" role="note">
        <span aria-hidden="true">🔒</span>
        <span><strong>Privacy-first measurement:</strong> analytics starts only after consent. Active time pauses when the tab is hidden or unfocused. The first-party store does not retain raw IP addresses, raw user agents, form values, message content or URL query strings.</span>
      </div>
    `;
    return section;
  }

  function insertSection() {
    if (document.getElementById('behaviourAnalyticsSection')) return;
    const main = document.getElementById('main-content');
    const header = main && main.querySelector('.dashboard-header');
    if (!main) return;
    const section = buildSection();
    if (header && header.nextSibling) {
      main.insertBefore(section, header.nextSibling);
    } else {
      main.prepend(section);
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function renderBreakdown(id, rows, emptyText) {
    const container = document.getElementById(id);
    if (!container) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      container.innerHTML = `<div class="behaviour-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }
    container.innerHTML = rows
      .slice(0, 10)
      .map(
        row =>
          `<div class="behaviour-breakdown-row"><span>${escapeHtml(row.key)}</span><strong>${formatNumber(row.count)}</strong></div>`
      )
      .join('');
  }

  function renderSummary(summary) {
    const totals = summary.totals || {};
    setText('baPageViews', formatNumber(totals.pageViews));
    setText('baSessions', formatNumber(totals.sessions));
    setText('baActiveTime', formatDuration(totals.avgActiveSecondsPerSession));
    setText('baEngaged', `${Number(totals.engagedSessionRate || 0).toFixed(1)}%`);
    setText('baConversions', formatNumber(totals.conversions));
    setText('baErrors', formatNumber(totals.clientErrors));

    const pagesBody = document.getElementById('baPagesBody');
    const pages = Array.isArray(summary.pages) ? summary.pages : [];
    pagesBody.innerHTML = pages.length
      ? pages
          .slice(0, 30)
          .map(
            page => `<tr>
              <td><strong>${escapeHtml(page.pagePath)}</strong><br><small>${escapeHtml(page.pageType)}</small></td>
              <td>${formatNumber(page.views)}</td>
              <td>${formatNumber(page.sessions)}</td>
              <td>${formatDuration(page.avgActiveSeconds)}</td>
              <td>${Number(page.engagedRate || 0).toFixed(1)}%</td>
              <td>${Number(page.exitRate || 0).toFixed(1)}%</td>
              <td>${Number(page.bounceRate || 0).toFixed(1)}%</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="7" class="behaviour-empty">No consented page data for this period.</td></tr>';

    const funnel = document.getElementById('baFunnel');
    const funnelRows = Array.isArray(summary.funnel) ? summary.funnel : [];
    const maximum = Math.max(...funnelRows.map(row => Number(row.sessions) || 0), 1);
    funnel.innerHTML = funnelRows.length
      ? funnelRows
          .map(row => {
            const width = Math.max(2, ((Number(row.sessions) || 0) / maximum) * 100);
            return `<div class="behaviour-funnel__row">
              <span class="behaviour-funnel__label">${escapeHtml(row.label)}</span>
              <span class="behaviour-funnel__bar"><span class="behaviour-funnel__fill" style="width:${width.toFixed(1)}%"></span></span>
              <span class="behaviour-funnel__value">${formatNumber(row.sessions)} · ${Number(row.rateFromSearch || 0).toFixed(1)}%</span>
            </div>`;
          })
          .join('')
      : '<div class="behaviour-empty">No funnel data for this period.</div>';

    renderBreakdown('baReferrers', summary.referrers, 'No referrer data for this period.');
    renderBreakdown('baDevices', summary.devices, 'No device data for this period.');

    const recommendations = document.getElementById('baRecommendations');
    const rows = Array.isArray(summary.recommendations) ? summary.recommendations : [];
    recommendations.innerHTML = rows.length
      ? rows
          .map(
            item => `<div class="behaviour-recommendation" data-severity="${escapeHtml(item.severity || 'info')}">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.detail)}</p>
            </div>`
          )
          .join('')
      : '<div class="behaviour-empty">No improvement signals were triggered for this period.</div>';
  }

  function renderStatus(status) {
    const badge = document.getElementById('behaviourAnalyticsStatus');
    const posthogLink = document.getElementById('behaviourPosthogLink');
    if (!badge) return;

    if (!status.enabled) {
      badge.dataset.state = 'warning';
      badge.textContent = 'First-party analytics disabled';
    } else if (status.eventCount > 0) {
      badge.dataset.state = 'active';
      badge.textContent = `${formatNumber(status.eventCount)} events collected`;
    } else {
      badge.dataset.state = 'warning';
      badge.textContent = 'Ready · awaiting consented traffic';
    }

    if (posthogLink && status.posthogConfigured && status.posthogDashboardUrl) {
      posthogLink.href = status.posthogDashboardUrl;
      posthogLink.hidden = false;
      posthogLink.textContent = status.sessionRecordingEnabled
        ? 'Open PostHog recordings ↗'
        : 'Open PostHog ↗';
    } else if (posthogLink) {
      posthogLink.hidden = true;
    }
  }

  function renderError(message) {
    const badge = document.getElementById('behaviourAnalyticsStatus');
    if (badge) {
      badge.dataset.state = 'warning';
      badge.textContent = 'Analytics unavailable';
      badge.title = message;
    }
    const pages = document.getElementById('baPagesBody');
    if (pages) {
      pages.innerHTML = `<tr><td colspan="7" class="behaviour-empty">${escapeHtml(message)}</td></tr>`;
    }
  }

  async function load() {
    const range = document.getElementById('behaviourAnalyticsRange');
    const days = range ? Number(range.value) || 30 : 30;
    try {
      const [statusPayload, summaryPayload] = await Promise.all([
        fetchJson(STATUS_ENDPOINT),
        fetchJson(`${SUMMARY_ENDPOINT}?days=${encodeURIComponent(days)}`),
      ]);
      renderStatus(statusPayload.status || {});
      renderSummary(summaryPayload.summary || {});
    } catch (error) {
      renderError(error.message || 'Failed to load behaviour analytics.');
    }
  }

  function init() {
    ensureStyles();
    insertSection();
    const subtitle = document.querySelector('.dashboard-subtitle');
    if (subtitle) {
      subtitle.textContent =
        'Visitor behaviour, conversions, revenue, user growth and platform performance.';
    }
    document.getElementById('behaviourAnalyticsRange')?.addEventListener('change', load);
    document.getElementById('analyticsRefreshBtn')?.addEventListener('click', load);
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
