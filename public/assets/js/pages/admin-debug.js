/**
 * Admin Debug Page — System Checks
 *
 * Fetches the check catalog and run history from the admin API and renders:
 *   - Overview tab: latest run summary + per-check breakdown
 *   - Coverage tab: full list of pages/APIs with last known status + filter bar
 *   - History tab: run history table with expandable check rows
 *   - "Run Now" button that triggers an immediate check and refreshes data
 */
(function () {
  'use strict';

  const API_URL = '/api/admin/system-checks';
  const RUN_URL = '/api/admin/system-checks/run';
  const CATALOG_URL = '/api/admin/system-checks/catalog';

  /* ── DOM refs ──────────────────────────────────────────────────────────── */
  const summaryEl = document.getElementById('sc-summary');
  const checksListEl = document.getElementById('sc-checks-list');
  const historyBody = document.getElementById('sc-history-body');
  const runBtn = document.getElementById('sc-run-btn');
  const runStatus = document.getElementById('sc-run-status');
  const statsBar = document.getElementById('sc-stats-bar');
  const coverageEl = document.getElementById('sc-coverage-list');
  const coverageRunTime = document.getElementById('sc-coverage-run-time');

  /* ── State ─────────────────────────────────────────────────────────────── */
  let _catalog = [];
  let _latestRun = null;
  let _activeFilter = 'all';

  /* ── Formatting helpers ─────────────────────────────────────────────────── */
  function fmtDate(dateStr) {
    if (!dateStr) {
      return '—';
    }
    try {
      return new Date(dateStr).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return dateStr;
    }
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined) {
      return '—';
    }
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function escHtml(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Tab switching ──────────────────────────────────────────────────────── */
  const tabBtns = document.querySelectorAll('.sc-tab-btn');
  const tabPanels = document.querySelectorAll('.sc-tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('aria-controls');
      tabBtns.forEach(b => b.setAttribute('aria-selected', 'false'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(targetId);
      if (panel) {
        panel.classList.add('active');
      }
    });
  });

  /* ── Stats bar ──────────────────────────────────────────────────────────── */
  function renderStats(run, total) {
    if (!statsBar) {
      return;
    }
    if (!run) {
      statsBar.innerHTML = '';
      return;
    }
    const checks = Array.isArray(run.checks) ? run.checks : [];
    const passed = checks.filter(c => c.ok).length;
    const failed = checks.filter(c => !c.ok).length;
    const untested = total - checks.length;

    statsBar.innerHTML = `
      <div class="sc-stat sc-stat--total">
        <span class="sc-stat-value">${escHtml(String(total))}</span>
        <span class="sc-stat-label">Total</span>
      </div>
      <div class="sc-stat sc-stat--pass">
        <span class="sc-stat-value">${escHtml(String(passed))}</span>
        <span class="sc-stat-label">Passing</span>
      </div>
      <div class="sc-stat sc-stat--fail">
        <span class="sc-stat-value">${escHtml(String(failed))}</span>
        <span class="sc-stat-label">Failing</span>
      </div>
      ${
        untested > 0
          ? `
      <div class="sc-stat sc-stat--skip">
        <span class="sc-stat-value">${escHtml(String(untested))}</span>
        <span class="sc-stat-label">Untested</span>
      </div>`
          : ''
      }`;
  }

  /* ── Summary card ───────────────────────────────────────────────────────── */
  function renderSummary(run) {
    if (!summaryEl) {
      return;
    }
    if (!run) {
      summaryEl.innerHTML = `
        <div class="sc-summary-card">
          <div class="sc-badge sc-badge--none" aria-hidden="true">📭</div>
          <div class="sc-summary-meta">
            <p class="sc-summary-title">No runs recorded yet</p>
            <p class="sc-summary-subtitle">Click "Run Now" to perform the first system check.</p>
          </div>
        </div>`;
      return;
    }

    const isPassed = run.status === 'pass';
    const badgeCls = isPassed ? 'sc-badge--pass' : 'sc-badge--fail';
    const icon = isPassed ? '✅' : '❌';
    const label = isPassed ? 'PASS' : 'FAIL';
    const checks = Array.isArray(run.checks) ? run.checks : [];
    const failed = checks.filter(c => !c.ok).length;
    const subtitle = isPassed
      ? `All ${checks.length} checks passed · ${fmtDate(run.startedAt)} · ${fmtDuration(run.durationMs)}`
      : `${failed} of ${checks.length} checks failed · ${fmtDate(run.startedAt)} · ${fmtDuration(run.durationMs)}`;

    summaryEl.innerHTML = `
      <div class="sc-summary-card">
        <div class="sc-badge ${escHtml(badgeCls)}" aria-hidden="true">${icon}</div>
        <div class="sc-summary-meta">
          <p class="sc-summary-title">${label}</p>
          <p class="sc-summary-subtitle">${escHtml(subtitle)}</p>
        </div>
        <div class="sc-summary-env">${escHtml(run.environment || '')} &bull; ${escHtml(run.baseUrl || '')}</div>
      </div>`;
  }

  /* ── Check detail list (overview tab) ──────────────────────────────────── */
  function renderChecks(run) {
    if (!checksListEl) {
      return;
    }
    if (!run || !Array.isArray(run.checks) || run.checks.length === 0) {
      checksListEl.innerHTML = `
        <div class="sc-empty">
          <div class="sc-empty-icon" aria-hidden="true">📋</div>
          <p>No check details available</p>
        </div>`;
      return;
    }

    checksListEl.innerHTML = run.checks
      .map(c => {
        const codeStr =
          c.statusCode !== null && c.statusCode !== undefined ? String(c.statusCode) : '—';
        const resultHtml = c.error
          ? `<span class="sc-check-err">${escHtml(c.error)}</span>`
          : `<span class="sc-check-ok">OK</span>`;
        return `
        <div class="sc-check-row">
          <span class="sc-check-status" aria-label="${c.ok ? 'Pass' : 'Fail'}">${c.ok ? '✅' : '❌'}</span>
          <span class="sc-check-name">${escHtml(c.name)}</span>
          <span class="sc-check-type">${escHtml(c.type)}</span>
          <span class="sc-check-code">${escHtml(codeStr)}</span>
          <span class="sc-check-dur">${fmtDuration(c.durationMs)}</span>
          ${resultHtml}
        </div>`;
      })
      .join('');
  }

  /* ── Coverage tab ───────────────────────────────────────────────────────── */
  const GROUP_LABELS = {
    infrastructure: '🔧 Infrastructure',
    public: '🌐 Public Pages',
    protected: '🔒 Protected Pages',
    admin: '🛡️ Admin Pages',
    'api-public': '📡 Public APIs',
    'api-auth': '🔑 Auth-Required APIs',
  };

  function renderCoverage() {
    if (!coverageEl) {
      return;
    }

    // Build result map from latest run
    const resultMap = {};
    if (_latestRun && Array.isArray(_latestRun.checks)) {
      _latestRun.checks.forEach(c => {
        resultMap[c.name] = c;
      });
    }

    // Apply filter
    const filtered = _catalog.filter(item => {
      if (_activeFilter === 'page') {
        return item.type === 'page';
      }
      if (_activeFilter === 'api') {
        return item.type === 'api';
      }
      if (_activeFilter === 'fail') {
        const r = resultMap[item.name];
        return r && !r.ok;
      }
      if (_activeFilter === 'untested') {
        return !resultMap[item.name];
      }
      return true;
    });

    if (filtered.length === 0) {
      coverageEl.innerHTML = `
        <div class="sc-empty">
          <div class="sc-empty-icon" aria-hidden="true">✅</div>
          <p>No items match this filter.</p>
        </div>`;
      return;
    }

    // Group by group
    const groups = {};
    filtered.forEach(item => {
      if (!groups[item.group]) {
        groups[item.group] = [];
      }
      groups[item.group].push(item);
    });

    const ORDER = ['infrastructure', 'public', 'protected', 'admin', 'api-public', 'api-auth'];
    const orderIndex = grp => {
      const i = ORDER.indexOf(grp);
      return i === -1 ? 99 : i;
    };
    const sortedGroups = Object.keys(groups).sort((a, b) => orderIndex(a) - orderIndex(b));

    let html = '';
    sortedGroups.forEach(grp => {
      const label = GROUP_LABELS[grp] || escHtml(grp);
      const items = groups[grp];
      html += `<div class="sc-group-header">${label} <span style="font-weight:400;opacity:.7;">(${items.length})</span></div>`;
      items.forEach(item => {
        const r = resultMap[item.name];
        let statusIcon, resultHtml;
        if (!r) {
          statusIcon = '⬜';
          resultHtml = `<span class="sc-check-untested">Not yet tested</span>`;
        } else if (r.ok) {
          statusIcon = '✅';
          const codeStr =
            r.statusCode !== null && r.statusCode !== undefined ? String(r.statusCode) : '—';
          resultHtml = `<span class="sc-check-ok">${escHtml(codeStr)} · ${fmtDuration(r.durationMs)}</span>`;
        } else {
          statusIcon = '❌';
          resultHtml = `<span class="sc-check-err">${escHtml(r.error || String(r.statusCode || 'Error'))}</span>`;
        }
        html += `
          <div class="sc-check-row">
            <span class="sc-check-status" aria-label="${!r ? 'Untested' : r.ok ? 'Pass' : 'Fail'}">${statusIcon}</span>
            <span class="sc-check-name">${escHtml(item.name)}</span>
            <span class="sc-check-path">${escHtml(item.path)}</span>
            <span class="sc-check-group">${escHtml(item.group)}</span>
            ${resultHtml}
          </div>`;
      });
    });

    coverageEl.innerHTML = html;

    // Update run time note
    if (coverageRunTime) {
      coverageRunTime.textContent = _latestRun
        ? `Last run: ${fmtDate(_latestRun.startedAt)}.`
        : 'No run recorded yet — click "Run Now" to test all.';
    }
  }

  /* ── Filter bar ─────────────────────────────────────────────────────────── */
  document.querySelectorAll('.sc-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.filter || 'all';
      document
        .querySelectorAll('.sc-filter-btn')
        .forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      renderCoverage();
    });
  });

  /* ── History table ──────────────────────────────────────────────────────── */
  function renderHistory(runs) {
    if (!historyBody) {
      return;
    }
    if (!runs || runs.length === 0) {
      historyBody.innerHTML = `
        <tr><td colspan="6" class="sc-empty">
          <div class="sc-empty-icon" aria-hidden="true">📭</div>
          <p>No run history yet</p>
        </td></tr>`;
      return;
    }

    historyBody.innerHTML = runs
      .map((run, idx) => {
        const checks = Array.isArray(run.checks) ? run.checks : [];
        const failed = checks.filter(c => !c.ok).length;
        const pillCls = run.status === 'pass' ? 'sc-pill--pass' : 'sc-pill--fail';
        const rowId = `sc-detail-${idx}`;

        const detailRows = checks
          .map(c => {
            const icon = c.ok ? '✅' : '❌';
            const code =
              c.statusCode !== null && c.statusCode !== undefined ? String(c.statusCode) : '—';
            return `<tr>
          <td>${icon} ${escHtml(c.name)}</td>
          <td>${escHtml(c.type)}</td>
          <td>${escHtml(code)}</td>
          <td>${fmtDuration(c.durationMs)}</td>
          <td>${escHtml(c.error || 'OK')}</td>
        </tr>`;
          })
          .join('');

        return `
        <tr>
          <td><span class="sc-pill ${escHtml(pillCls)}">${escHtml((run.status || '').toUpperCase())}</span></td>
          <td>${escHtml(fmtDate(run.startedAt))}</td>
          <td>${fmtDuration(run.durationMs)}</td>
          <td>${escHtml(run.environment || '—')}</td>
          <td>${checks.length - failed}/${checks.length}</td>
          <td>
            <button class="sc-expand-btn" type="button" aria-expanded="false" aria-controls="${escHtml(rowId)}" data-target="${escHtml(rowId)}">
              ▼ Details
            </button>
          </td>
        </tr>
        <tr id="${escHtml(rowId)}" class="sc-details-row hidden">
          <td colspan="6">
            <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
              <thead><tr>
                <th style="text-align:left;padding:.25rem .5rem;">Check</th>
                <th>Type</th><th>Status</th><th>Duration</th><th>Result</th>
              </tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </td>
        </tr>`;
      })
      .join('');
  }

  /* ── API calls ──────────────────────────────────────────────────────────── */
  async function loadData() {
    try {
      // Fetch catalog and latest runs in parallel
      const [catalogData, runsData] = await Promise.all([
        AdminShared.api(CATALOG_URL),
        AdminShared.api(`${API_URL}?limit=30`),
      ]);

      _catalog = Array.isArray(catalogData.catalog) ? catalogData.catalog : [];
      const runs = Array.isArray(runsData.runs) ? runsData.runs : [];
      _latestRun = runs[0] || null;

      renderStats(_latestRun, _catalog.length);
      renderSummary(_latestRun);
      renderChecks(_latestRun);
      renderCoverage();
      renderHistory(runs);
    } catch (err) {
      const msg = escHtml(err.message || 'Unknown error');
      if (summaryEl) {
        summaryEl.innerHTML = `
          <div class="sc-summary-card">
            <div class="sc-badge sc-badge--fail" aria-hidden="true">⚠️</div>
            <div class="sc-summary-meta">
              <p class="sc-summary-title">Failed to load</p>
              <p class="sc-summary-subtitle">${msg}</p>
            </div>
          </div>`;
      }
      if (checksListEl) {
        checksListEl.innerHTML = `<div class="sc-empty"><p>Could not load check data</p></div>`;
      }
      if (historyBody) {
        historyBody.innerHTML = `<tr><td colspan="6" class="sc-empty"><p>Could not load history</p></td></tr>`;
      }
      if (coverageEl) {
        coverageEl.innerHTML = `<div class="sc-empty"><p>Could not load catalog</p></div>`;
      }
    }
  }

  async function triggerRun() {
    if (!runBtn) {
      return;
    }
    runBtn.disabled = true;
    if (runStatus) {
      runStatus.textContent = 'Running checks…';
    }

    try {
      await AdminShared.adminFetch(RUN_URL, { method: 'POST' });
      if (runStatus) {
        runStatus.textContent = 'Run complete. Refreshing…';
      }
      await loadData();
      if (runStatus) {
        runStatus.textContent = '';
      }
    } catch (err) {
      if (runStatus) {
        runStatus.textContent = `Error: ${err.message || 'Run failed'}`;
      }
    } finally {
      runBtn.disabled = false;
    }
  }

  /* ── Bootstrap ──────────────────────────────────────────────────────────── */
  if (runBtn) {
    runBtn.addEventListener('click', triggerRun);
  }

  // Delegated expand/collapse for history rows
  if (historyBody) {
    historyBody.addEventListener('click', e => {
      const btn = e.target.closest('.sc-expand-btn');
      if (!btn) {
        return;
      }
      const targetId = btn.getAttribute('data-target');
      const row = targetId ? document.getElementById(targetId) : null;
      if (!row) {
        return;
      }
      const isOpen = row.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      btn.textContent = isOpen ? '▲ Hide' : '▼ Details';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
  } else {
    loadData();
  }
})();
