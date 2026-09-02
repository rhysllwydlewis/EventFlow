'use strict';
(function () {
  const SUMMARY_ENDPOINT = '/api/v1/analytics/behaviour/admin/summary';
  const STATUS_ENDPOINT = '/api/v1/analytics/behaviour/admin/status';
  const STYLE_PATH = '/assets/css/admin-behaviour-analytics.css?v=2';

  const EVENT_LABELS = {
    page_view: 'Page views',
    page_engagement: 'Engagement updates',
    scroll_depth: 'Scroll milestones',
    outbound_click: 'Outbound clicks',
    form_submit: 'Form submissions',
    web_vital: 'Performance readings',
    client_error: 'Browser errors',
    search_performed: 'Searches',
    filter_changed: 'Filter changes',
    result_clicked: 'Search result clicks',
    shortlist_add: 'Items shortlisted',
    shortlist_remove: 'Items removed',
    quote_request_started: 'Quote requests started',
    quote_request_submitted: 'Quote requests sent',
    supplier_profile_view: 'Supplier profile views',
    package_view: 'Package views',
    package_add_to_plan: 'Packages added to plan',
    enquiry_started: 'Enquiries started',
    enquiry_submitted: 'Enquiries sent',
    registration_started: 'Registrations started',
    registration_completed: 'Registrations completed',
    supplier_registration_started: 'Supplier registrations started',
    supplier_profile_completed: 'Supplier profiles completed',
    package_created: 'Packages created',
    package_published: 'Packages published',
    checkout_started: 'Checkout starts',
    conversion_completed: 'Completed conversions',
    toc_click: 'Guide section clicks',
    share_click: 'Share clicks',
  };

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
    if (total < 60) {
      return `${total}s`;
    }
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes < 60) {
      return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const minuteRemainder = minutes % 60;
    return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
  }

  function formatDateTime(value) {
    if (!value) {
      return 'No events yet';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatShortDate(value) {
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  }

  function friendlyKey(value) {
    const raw = String(value || 'other');
    return EVENT_LABELS[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
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
    if (document.querySelector(`link[href^="${STYLE_PATH.split('?')[0]}"]`)) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_PATH;
    document.head.appendChild(link);
  }

  function buildKpi(icon, tone, label, valueId, note) {
    return `
      <article class="behaviour-kpi" data-tone="${tone}">
        <div class="behaviour-kpi__topline">
          <span class="behaviour-kpi__icon" aria-hidden="true">${icon}</span>
          <span class="behaviour-kpi__label">${label}</span>
        </div>
        <strong id="${valueId}" class="behaviour-kpi__value">—</strong>
        <span class="behaviour-kpi__note">${note}</span>
      </article>`;
  }

  function buildSection() {
    const section = document.createElement('section');
    section.id = 'behaviourAnalyticsSection';
    section.className = 'container behaviour-analytics-section';
    section.setAttribute('aria-labelledby', 'behaviourAnalyticsTitle');
    section.innerHTML = `
      <div class="behaviour-overview">
        <div class="behaviour-overview__main">
          <div>
            <span class="behaviour-overview__eyebrow">Behaviour analytics</span>
            <h2 id="behaviourAnalyticsTitle">See how visitors actually use EventFlow</h2>
            <p>Active time, page quality, marketplace journeys and conversion signals in one clear view.</p>
            <div class="behaviour-overview__trust" aria-label="Analytics privacy controls">
              <span>Consent gated</span>
              <span>Active time only</span>
              <span>Admin traffic excluded</span>
            </div>
          </div>
          <div class="behaviour-overview__controls">
            <span id="behaviourAnalyticsStatus" class="analytics-provider-status" data-state="loading">
              <span class="analytics-provider-status__dot" aria-hidden="true"></span>
              <span>Checking analytics…</span>
            </span>
            <label class="behaviour-range-control">
              <span>Reporting period</span>
              <select id="behaviourAnalyticsRange" aria-label="Behaviour analytics reporting period">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <a id="behaviourPosthogLink" class="btn-secondary behaviour-posthog-link" href="#" target="_blank" rel="noopener noreferrer" hidden>Open PostHog ↗</a>
          </div>
        </div>
        <div class="behaviour-coverage" aria-label="Analytics data coverage">
          <span><strong>Latest event</strong><span id="baLatestEvent">Checking…</span></span>
          <span><strong>Retention</strong><span id="baRetention">—</span></span>
          <span><strong>Measurement</strong><span id="baHeartbeat">—</span></span>
          <span><strong>Last refreshed</strong><span id="baLastRefreshed">—</span></span>
        </div>
      </div>

      <div class="behaviour-kpi-grid" aria-label="Behaviour analytics headline metrics">
        ${buildKpi('↗', 'teal', 'Page views', 'baPageViews', 'Consented page views')}
        ${buildKpi('◎', 'blue', 'Sessions', 'baSessions', 'Unique browser sessions')}
        ${buildKpi('◷', 'purple', 'Average active time', 'baActiveTime', 'Visible and focused time')}
        ${buildKpi('✓', 'green', 'Engaged sessions', 'baEngaged', '10 seconds or 2+ pages')}
        ${buildKpi('★', 'amber', 'Conversions', 'baConversions', 'Completed key actions')}
        ${buildKpi('!', 'red', 'Browser errors', 'baErrors', 'Client-side error signals')}
      </div>

      <div class="behaviour-analytics-grid behaviour-analytics-grid--lead">
        <article class="behaviour-analytics-card behaviour-analytics-card--trend">
          <div class="behaviour-analytics-card__header">
            <div>
              <span class="behaviour-card-kicker">Engagement trend</span>
              <h3>Daily active time per session</h3>
              <p>Time counts only while EventFlow is visible and the browser is focused.</p>
            </div>
            <strong id="baTrendSummary" class="behaviour-card-metric">—</strong>
          </div>
          <div id="baTrend" class="behaviour-trend" aria-label="Daily active engagement chart">
            <div class="behaviour-empty">Loading engagement trend…</div>
          </div>
        </article>

        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header">
            <div>
              <span class="behaviour-card-kicker">Conversion journey</span>
              <h3>Marketplace funnel</h3>
              <p>Sessions that move through each step in the correct order.</p>
            </div>
          </div>
          <div id="baFunnel" class="behaviour-funnel">
            <div class="behaviour-empty">Loading marketplace journey…</div>
          </div>
        </article>
      </div>

      <article class="behaviour-analytics-card behaviour-page-card">
        <div class="behaviour-analytics-card__header">
          <div>
            <span class="behaviour-card-kicker">Page-by-page detail</span>
            <h3>Where visitors engage or leave</h3>
            <p>Compare active time, engagement, exits and quick single-page sessions.</p>
          </div>
          <span class="behaviour-card-help">Scroll the table to review up to 50 pages</span>
        </div>
        <div class="behaviour-table-wrap">
          <table class="behaviour-table" aria-label="Behaviour analytics by page">
            <thead>
              <tr><th>Page</th><th>Health</th><th>Views</th><th>Sessions</th><th>Avg active</th><th>Engaged</th><th>Exit</th><th>Bounce</th></tr>
            </thead>
            <tbody id="baPagesBody"><tr><td colspan="8" class="behaviour-empty">Loading page analytics…</td></tr></tbody>
          </table>
        </div>
      </article>

      <div class="behaviour-analytics-grid behaviour-analytics-grid--three">
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header">
            <div><span class="behaviour-card-kicker">Signup acquisition</span><h3>Where registrations came from</h3><p>First-touch channel and source for consented completed registrations.</p></div>
            <strong id="baRegistrationTotal" class="behaviour-card-metric">—</strong>
          </div>
          <h4 class="behaviour-breakdown-heading">Channels</h4>
          <div id="baRegistrationChannels" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading signup channels…</div></div>
          <h4 class="behaviour-breakdown-heading">Sources</h4>
          <div id="baRegistrationSources" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading signup sources…</div></div>
        </article>
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header">
            <div><span class="behaviour-card-kicker">Acquisition</span><h3>Traffic sources</h3><p>Entry source for each measured session.</p></div>
          </div>
          <div id="baReferrers" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading sources…</div></div>
        </article>
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header">
            <div><span class="behaviour-card-kicker">Audience</span><h3>Device mix</h3><p>Broad device category for each session.</p></div>
          </div>
          <div id="baDevices" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading devices…</div></div>
        </article>
        <article class="behaviour-analytics-card">
          <div class="behaviour-analytics-card__header">
            <div><span class="behaviour-card-kicker">Interaction</span><h3>Top actions</h3><p>The events visitors trigger most often.</p></div>
          </div>
          <div id="baEvents" class="behaviour-breakdown-list"><div class="behaviour-empty">Loading actions…</div></div>
        </article>
      </div>

      <article class="behaviour-analytics-card behaviour-recommendations-card">
        <div class="behaviour-analytics-card__header">
          <div>
            <span class="behaviour-card-kicker">What to improve</span>
            <h3>Recommended checks</h3>
            <p>Practical prompts based on engagement, exits, bounces, funnel loss and errors.</p>
          </div>
        </div>
        <div id="baRecommendations" class="behaviour-recommendations"><div class="behaviour-empty">Loading recommendations…</div></div>
      </article>

      <div class="behaviour-privacy-note" role="note">
        <span class="behaviour-privacy-note__icon" aria-hidden="true">✓</span>
        <span><strong>Privacy-first measurement is active.</strong> Analytics starts only after consent. Query strings, form values, message content, raw IP addresses and raw user-agent strings are not stored.</span>
      </div>
    `;
    return section;
  }

  function insertSection() {
    if (document.getElementById('behaviourAnalyticsSection')) {
      return;
    }
    const main = document.getElementById('main-content');
    const header = main && main.querySelector('.dashboard-header');
    if (!main) {
      return;
    }
    const section = buildSection();
    if (header && header.nextSibling) {
      main.insertBefore(section, header.nextSibling);
    } else {
      main.prepend(section);
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function pageHealth(page) {
    if (Number(page.views) < 5) {
      return { label: 'Low data', tone: 'neutral' };
    }
    if (Number(page.avgActiveSeconds) < 12 && Number(page.exitRate) >= 50) {
      return { label: 'Review', tone: 'danger' };
    }
    if (Number(page.bounceRate) >= 60 || Number(page.exitRate) >= 60) {
      return { label: 'Watch', tone: 'warning' };
    }
    if (Number(page.engagedRate) >= 60 && Number(page.exitRate) < 45) {
      return { label: 'Healthy', tone: 'success' };
    }
    return { label: 'Monitor', tone: 'info' };
  }

  function renderPages(pages) {
    const pagesBody = document.getElementById('baPagesBody');
    if (!pagesBody) {
      return;
    }
    const rows = Array.isArray(pages) ? pages : [];
    pagesBody.innerHTML = rows.length
      ? rows
          .slice(0, 50)
          .map(page => {
            const health = pageHealth(page);
            return `<tr>
              <td><strong>${escapeHtml(page.pagePath)}</strong><br><small>${escapeHtml(page.pageType)}</small></td>
              <td><span class="behaviour-health" data-tone="${health.tone}">${health.label}</span></td>
              <td>${formatNumber(page.views)}</td>
              <td>${formatNumber(page.sessions)}</td>
              <td>${formatDuration(page.avgActiveSeconds)}</td>
              <td>${Number(page.engagedRate || 0).toFixed(1)}%</td>
              <td>${Number(page.exitRate || 0).toFixed(1)}%</td>
              <td>${Number(page.bounceRate || 0).toFixed(1)}%</td>
            </tr>`;
          })
          .join('')
      : '<tr><td colspan="8" class="behaviour-empty">No consented page data for this period.</td></tr>';
  }

  function renderTrend(rows) {
    const container = document.getElementById('baTrend');
    if (!container) {
      return;
    }
    const data = (Array.isArray(rows) ? rows : []).slice(-14);
    if (data.length === 0) {
      container.innerHTML =
        '<div class="behaviour-empty">No daily engagement data for this period.</div>';
      setText('baTrendSummary', 'No data yet');
      return;
    }

    const enriched = data.map(row => ({
      ...row,
      average: Number(row.sessions) > 0 ? Number(row.activeSeconds || 0) / Number(row.sessions) : 0,
    }));
    const maximum = Math.max(...enriched.map(row => row.average), 1);
    const periodAverage =
      enriched.reduce((sum, row) => sum + row.average, 0) / Math.max(enriched.length, 1);
    setText('baTrendSummary', `${formatDuration(periodAverage)} daily average`);

    container.innerHTML = `
      <div class="behaviour-trend__plot">
        ${enriched
          .map((row, index) => {
            const height = Math.max(4, (row.average / maximum) * 100);
            const showLabel =
              enriched.length <= 7 || index % 2 === 0 || index === enriched.length - 1;
            return `<div class="behaviour-trend__column" title="${escapeHtml(formatShortDate(row.date))}: ${escapeHtml(formatDuration(row.average))} average active time">
              <span class="behaviour-trend__value">${escapeHtml(formatDuration(row.average))}</span>
              <span class="behaviour-trend__track"><span class="behaviour-trend__bar" style="height:${height.toFixed(1)}%"></span></span>
              <span class="behaviour-trend__label">${showLabel ? escapeHtml(formatShortDate(row.date)) : ''}</span>
            </div>`;
          })
          .join('')}
      </div>`;
  }

  function renderFunnel(rows) {
    const container = document.getElementById('baFunnel');
    if (!container) {
      return;
    }
    const funnelRows = Array.isArray(rows) ? rows : [];
    const maximum = Math.max(...funnelRows.map(row => Number(row.sessions) || 0), 1);
    container.innerHTML = funnelRows.length
      ? funnelRows
          .map((row, index) => {
            const previous = index > 0 ? Number(funnelRows[index - 1].sessions) || 0 : 0;
            const current = Number(row.sessions) || 0;
            const drop = previous > 0 ? Math.max(0, 100 - (current / previous) * 100) : 0;
            const width = Math.max(2, (current / maximum) * 100);
            return `<div class="behaviour-funnel__row">
              <span class="behaviour-funnel__step">${index + 1}</span>
              <span class="behaviour-funnel__content">
                <span class="behaviour-funnel__heading"><strong>${escapeHtml(row.label)}</strong><span>${formatNumber(current)} sessions</span></span>
                <span class="behaviour-funnel__bar"><span class="behaviour-funnel__fill" style="width:${width.toFixed(1)}%"></span></span>
                <span class="behaviour-funnel__meta">${Number(row.rateFromSearch || 0).toFixed(1)}% of search sessions${index > 0 ? ` · ${drop.toFixed(1)}% drop from prior step` : ''}</span>
              </span>
            </div>`;
          })
          .join('')
      : '<div class="behaviour-empty">No funnel data for this period.</div>';
  }

  function renderBreakdown(id, rows, emptyText, labelFormatter = value => value) {
    const container = document.getElementById(id);
    if (!container) {
      return;
    }
    const data = Array.isArray(rows) ? rows.slice(0, 8) : [];
    if (data.length === 0) {
      container.innerHTML = `<div class="behaviour-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }
    const maximum = Math.max(...data.map(row => Number(row.count) || 0), 1);
    container.innerHTML = data
      .map(row => {
        const width = Math.max(2, ((Number(row.count) || 0) / maximum) * 100);
        return `<div class="behaviour-breakdown-row">
          <div class="behaviour-breakdown-row__heading"><span>${escapeHtml(labelFormatter(row.key))}</span><strong>${formatNumber(row.count)}</strong></div>
          <span class="behaviour-breakdown-row__track"><span style="width:${width.toFixed(1)}%"></span></span>
        </div>`;
      })
      .join('');
  }

  function renderRecommendations(rows) {
    const container = document.getElementById('baRecommendations');
    if (!container) {
      return;
    }
    const recommendations = Array.isArray(rows) ? rows : [];
    const severityLabels = {
      high: 'Priority',
      medium: 'Review',
      info: 'Information',
    };
    container.innerHTML = recommendations.length
      ? recommendations
          .map(
            item => `<article class="behaviour-recommendation" data-severity="${escapeHtml(item.severity || 'info')}">
              <div class="behaviour-recommendation__heading">
                <span>${escapeHtml(severityLabels[item.severity] || 'Information')}</span>
                <strong>${escapeHtml(item.title)}</strong>
              </div>
              <p>${escapeHtml(item.detail)}</p>
            </article>`
          )
          .join('')
      : '<div class="behaviour-empty">No improvement signals were triggered for this period.</div>';
  }

  function registrationLabel(value) {
    return String(value || 'unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function renderRegistrationSources(registrations) {
    const data = registrations || {};
    setText('baRegistrationTotal', `${formatNumber(data.total)} registrations`);
    renderBreakdown(
      'baRegistrationChannels',
      data.byChannel,
      'No attributed registrations for this period.',
      registrationLabel
    );
    renderBreakdown(
      'baRegistrationSources',
      data.bySource,
      'No signup-source detail for this period.',
      key => (key === 'direct' ? 'Direct / unknown' : registrationLabel(key))
    );
  }

  function renderSummary(summary) {
    const totals = summary.totals || {};
    setText('baPageViews', formatNumber(totals.pageViews));
    setText('baSessions', formatNumber(totals.sessions));
    setText('baActiveTime', formatDuration(totals.avgActiveSecondsPerSession));
    setText('baEngaged', `${Number(totals.engagedSessionRate || 0).toFixed(1)}%`);
    setText('baConversions', formatNumber(totals.conversions));
    setText('baErrors', formatNumber(totals.clientErrors));

    renderTrend(summary.daily);
    renderPages(summary.pages);
    renderFunnel(summary.funnel);
    renderRegistrationSources(summary.registrations);
    renderBreakdown(
      'baReferrers',
      summary.referrers,
      'No traffic-source data for this period.',
      key =>
        key === 'direct' ? 'Direct / unknown' : key === 'internal' ? 'Internal navigation' : key
    );
    renderBreakdown('baDevices', summary.devices, 'No device data for this period.', key =>
      String(key || 'other').replace(/\b\w/g, char => char.toUpperCase())
    );
    renderBreakdown(
      'baEvents',
      summary.events,
      'No interaction data for this period.',
      friendlyKey
    );
    renderRecommendations(summary.recommendations);
  }

  function renderStatus(status) {
    const badge = document.getElementById('behaviourAnalyticsStatus');
    const posthogLink = document.getElementById('behaviourPosthogLink');
    if (badge) {
      if (!status.enabled) {
        badge.dataset.state = 'warning';
        badge.lastElementChild.textContent = 'First-party analytics disabled';
      } else if (status.eventCount > 0) {
        badge.dataset.state = 'active';
        badge.lastElementChild.textContent = `${formatNumber(status.eventCount)} events collected`;
      } else {
        badge.dataset.state = 'ready';
        badge.lastElementChild.textContent = 'Ready · awaiting consented traffic';
      }
    }

    setText('baLatestEvent', formatDateTime(status.latestEventAt));
    setText('baRetention', `${formatNumber(status.retentionDays)} days`);
    setText('baHeartbeat', `Every ${formatNumber(status.heartbeatSeconds)} seconds while active`);

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
      badge.lastElementChild.textContent = 'Analytics unavailable';
      badge.title = message;
    }
    const pages = document.getElementById('baPagesBody');
    if (pages) {
      pages.innerHTML = `<tr><td colspan="8" class="behaviour-empty">${escapeHtml(message)}</td></tr>`;
    }
    [
      'baTrend',
      'baFunnel',
      'baRegistrationChannels',
      'baRegistrationSources',
      'baReferrers',
      'baDevices',
      'baEvents',
      'baRecommendations',
    ].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.innerHTML = `<div class="behaviour-empty">${escapeHtml(message)}</div>`;
      }
    });
  }

  async function load() {
    const section = document.getElementById('behaviourAnalyticsSection');
    const range = document.getElementById('behaviourAnalyticsRange');
    const days = range ? Number(range.value) || 30 : 30;
    section?.classList.add('is-loading');
    try {
      const [statusPayload, summaryPayload] = await Promise.all([
        fetchJson(STATUS_ENDPOINT),
        fetchJson(`${SUMMARY_ENDPOINT}?days=${encodeURIComponent(days)}`),
      ]);
      renderStatus(statusPayload.status || {});
      renderSummary(summaryPayload.summary || {});
      setText('baLastRefreshed', formatDateTime(new Date().toISOString()));
    } catch (error) {
      renderError(error.message || 'Failed to load behaviour analytics.');
    } finally {
      section?.classList.remove('is-loading');
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
