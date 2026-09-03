/**
 * Admin Debug — Background Jobs tab
 * Read-only operational visibility for scheduled EventFlow processes.
 */
'use strict';
(function () {
  const API_URL = '/api/admin/background-jobs?limit=6';
  const HEALTH_LABELS = {
    healthy: ['Healthy', '✅'],
    warning: ['Warning', '⚠️'],
    failed: ['Failed', '❌'],
    overdue: ['Overdue', '⏰'],
    unknown: ['No run recorded', '❔'],
    disabled: ['Disabled', '⏸️'],
  };

  const listEl = document.getElementById('bj-jobs-list');
  const statsEl = document.getElementById('bj-stats-bar');
  const generatedEl = document.getElementById('bj-generated-at');
  const refreshBtn = document.getElementById('bj-refresh-btn');
  let activeFilter = 'all';
  let currentData = null;
  let loaded = false;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatDuration(value) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (value < 1000) {
      return `${value}ms`;
    }
    if (value < 60000) {
      return `${(value / 1000).toFixed(1)}s`;
    }
    return `${(value / 60000).toFixed(1)}m`;
  }

  function metricRows(metrics) {
    const entries = Object.entries(metrics || {});
    if (!entries.length) {
      return '<span class="bj-muted">No metrics recorded</span>';
    }
    return entries
      .map(
        ([key, value]) =>
          `<span class="bj-metric"><strong>${escapeHtml(key)}</strong> ${escapeHtml(value)}</span>`
      )
      .join('');
  }

  function renderStats(summary) {
    if (!statsEl) {
      return;
    }
    const values = [
      ['Total', summary.total, 'total'],
      ['Healthy', summary.healthy, 'healthy'],
      ['Needs attention', summary.attention, 'attention'],
      ['Failed', summary.failed, 'failed'],
      ['Overdue', summary.overdue, 'overdue'],
      ['Limited telemetry', summary.limitedTelemetry, 'limited'],
    ];
    statsEl.innerHTML = values
      .map(
        ([label, value, type]) => `
        <div class="bj-stat bj-stat--${type}">
          <span class="bj-stat-value">${escapeHtml(value)}</span>
          <span class="bj-stat-label">${escapeHtml(label)}</span>
        </div>`
      )
      .join('');
  }

  function historyMarkup(history) {
    if (!Array.isArray(history) || !history.length) {
      return '<p class="bj-muted">No execution history is available yet.</p>';
    }
    return `
      <div class="bj-history-wrap">
        <table class="bj-history-table">
          <thead><tr><th>Status</th><th>Finished</th><th>Duration</th><th>Trigger</th><th>Source</th></tr></thead>
          <tbody>${history
            .map(run => {
              const label = HEALTH_LABELS[run.status === 'success' ? 'healthy' : run.status] || [
                run.status,
                '•',
              ];
              return `<tr>
                <td>${label[1]} ${escapeHtml(label[0])}</td>
                <td>${escapeHtml(formatDate(run.finishedAt || run.startedAt))}</td>
                <td>${escapeHtml(formatDuration(run.durationMs))}</td>
                <td>${escapeHtml(run.trigger || 'scheduler')}</td>
                <td>${escapeHtml(run.source || 'background_job_runs')}</td>
              </tr>`;
            })
            .join('')}</tbody>
        </table>
      </div>`;
  }

  function renderJobs() {
    if (!listEl || !currentData) {
      return;
    }
    const jobs = (currentData.jobs || []).filter(job => {
      if (activeFilter === 'attention') {
        return ['failed', 'overdue', 'warning', 'unknown'].includes(job.health);
      }
      if (activeFilter === 'disabled') {
        return job.health === 'disabled';
      }
      if (activeFilter === 'healthy') {
        return job.health === 'healthy';
      }
      return true;
    });

    if (!jobs.length) {
      listEl.innerHTML =
        '<div class="sc-empty"><div class="sc-empty-icon">✅</div><p>No jobs match this filter.</p></div>';
      return;
    }

    listEl.innerHTML = jobs
      .map(job => {
        const [label, icon] = HEALTH_LABELS[job.health] || [job.health, '•'];
        const telemetryLabel =
          job.telemetry === 'full'
            ? 'Full telemetry'
            : job.telemetry === 'partial'
              ? 'Partial telemetry'
              : 'Configuration only';
        return `
          <article class="bj-job-card bj-job-card--${escapeHtml(job.health)}">
            <div class="bj-job-header">
              <div>
                <div class="bj-job-title-row">
                  <h3>${escapeHtml(job.name)}</h3>
                  <span class="bj-health-pill bj-health-pill--${escapeHtml(job.health)}">${icon} ${escapeHtml(label)}</span>
                  <span class="bj-telemetry-pill bj-telemetry-pill--${escapeHtml(job.telemetry)}">${escapeHtml(telemetryLabel)}</span>
                </div>
                <p>${escapeHtml(job.description)}</p>
              </div>
              <span class="bj-enabled">${job.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div class="bj-job-grid">
              <div><span>Schedule</span><strong>${escapeHtml(job.schedule || '—')}</strong><small>${escapeHtml(job.scheduleSource || '')}</small></div>
              <div><span>Next expected run</span><strong>${escapeHtml(formatDate(job.nextRun))}</strong></div>
              <div><span>Last attempt</span><strong>${escapeHtml(formatDate(job.lastAttempt))}</strong></div>
              <div><span>Last success</span><strong>${escapeHtml(formatDate(job.lastSuccess))}</strong></div>
              <div><span>Last failure</span><strong>${escapeHtml(formatDate(job.lastFailure))}</strong></div>
              <div><span>Latest duration</span><strong>${escapeHtml(formatDuration(job.latestDurationMs))}</strong></div>
            </div>
            <div class="bj-metrics">${metricRows(job.latestMetrics)}</div>
            ${job.latestError ? `<div class="bj-error" role="alert">${escapeHtml(job.latestError)}</div>` : ''}
            ${job.telemetry !== 'full' ? `<div class="bj-limited-note">This legacy job does not yet persist every execution. The status uses the best available operational evidence${job.legacyTelemetry ? ` (${escapeHtml(job.legacyTelemetry)})` : ''}.</div>` : ''}
            <details class="bj-history">
              <summary>Recent execution evidence</summary>
              ${historyMarkup(job.history)}
            </details>
            <div class="bj-source">Source: <code>${escapeHtml(job.source)}</code></div>
          </article>`;
      })
      .join('');
  }

  async function loadBackgroundJobs(force) {
    if (loaded && !force) {
      return;
    }
    if (!listEl) {
      return;
    }
    listEl.innerHTML =
      '<div class="sc-empty"><div class="sc-empty-icon">⏳</div><p>Loading background jobs…</p></div>';
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }
    try {
      currentData = await AdminShared.api(API_URL);
      loaded = true;
      renderStats(currentData.summary || {});
      renderJobs();
      if (generatedEl) {
        generatedEl.textContent = `Updated ${formatDate(currentData.generatedAt)}`;
      }
    } catch (error) {
      listEl.innerHTML = `<div class="sc-info-banner sc-info-banner--error" role="alert">Could not load background jobs: ${escapeHtml(error.message || 'Unknown error')}</div>`;
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
    }
  }

  document.querySelectorAll('.bj-filter-btn').forEach(button => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      document
        .querySelectorAll('.bj-filter-btn')
        .forEach(item => item.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      renderJobs();
    });
  });

  const tabButton = document.getElementById('tab-btn-background-jobs');
  if (tabButton) {
    tabButton.addEventListener('click', () => loadBackgroundJobs(false));
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadBackgroundJobs(true));
  }
})();

(function loadAdminDebugMobileImprovements() {
  const version = '18.6.1';
  const stylesheetPath = `/assets/css/admin-debug-mobile-improvements.css?v=${version}`;
  const scriptPath = `/assets/js/pages/admin-debug-mobile-improvements.js?v=${version}`;

  if (!document.querySelector('link[data-admin-debug-mobile-improvements]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = stylesheetPath;
    stylesheet.dataset.adminDebugMobileImprovements = 'true';
    document.head.appendChild(stylesheet);
  }

  if (!document.querySelector('script[data-admin-debug-mobile-improvements]')) {
    const script = document.createElement('script');
    script.src = scriptPath;
    script.defer = true;
    script.dataset.adminDebugMobileImprovements = 'true';
    document.head.appendChild(script);
  }
})();
