/**
 * Admin Debug Page — System Checks
 *
 * Fetches system-check run history from the admin API and renders:
 *   - A summary card for the latest run
 *   - A detailed check-by-check breakdown for the latest run
 *   - A history table of recent runs with expandable details
 *   - A "Run Now" button that triggers an immediate check
 */
(function () {
  'use strict';

  const API_URL = '/api/admin/system-checks';
  const RUN_URL = '/api/admin/system-checks/run';

  /* ── DOM refs ──────────────────────────────────────────────────────────── */
  const summaryEl = document.getElementById('sc-summary');
  const checksListEl = document.getElementById('sc-checks-list');
  const historyBody = document.getElementById('sc-history-body');
  const runBtn = document.getElementById('sc-run-btn');
  const runStatus = document.getElementById('sc-run-status');

  /* ── Formatting helpers ─────────────────────────────────────────────────── */
  function fmtDate(dateStr) {
    if (!dateStr) {
      return '—';
    }
    try {
      return new Date(dateStr).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return dateStr;
    }
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined) {
      return '—';
    }
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
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

  /* ── Summary card ────────────────────────────────────────────────────────── */
  function renderSummary(run) {
    if (!run) {
      summaryEl.innerHTML = `
        <div class="sc-summary-card">
          <div class="sc-badge sc-badge--none">📭</div>
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
        <div class="sc-badge ${escHtml(badgeCls)}">${icon}</div>
        <div class="sc-summary-meta">
          <p class="sc-summary-title">${label}</p>
          <p class="sc-summary-subtitle">${escHtml(subtitle)}</p>
        </div>
        <div style="font-size:.75rem;color:#9ca3af;">
          ${escHtml(run.environment || '')} &bull; ${escHtml(run.baseUrl || '')}
        </div>
      </div>`;
  }

  /* ── Check detail list ────────────────────────────────────────────────────── */
  function renderChecks(run) {
    if (!run || !Array.isArray(run.checks) || run.checks.length === 0) {
      checksListEl.innerHTML = `
        <div class="sc-empty">
          <div class="sc-empty-icon">📋</div>
          <p>No check details available</p>
        </div>`;
      return;
    }

    const rows = run.checks
      .map(c => {
        const statusIcon = c.ok ? '✅' : '❌';
        const codeStr =
          c.statusCode !== null && c.statusCode !== undefined ? String(c.statusCode) : '—';
        const errorStr = c.error
          ? `<span class="sc-check-err">${escHtml(c.error)}</span>`
          : `<span class="sc-check-ok">OK</span>`;
        return `
        <div class="sc-check-row">
          <span class="sc-check-status" aria-label="${c.ok ? 'Pass' : 'Fail'}">${statusIcon}</span>
          <span class="sc-check-name">${escHtml(c.name)}</span>
          <span class="sc-check-type">${escHtml(c.type)}</span>
          <span class="sc-check-code">${escHtml(codeStr)}</span>
          <span class="sc-check-dur">${fmtDuration(c.durationMs)}</span>
          ${errorStr}
        </div>`;
      })
      .join('');

    checksListEl.innerHTML = rows;
  }

  /* ── History table ────────────────────────────────────────────────────────── */
  function renderHistory(runs) {
    if (!runs || runs.length === 0) {
      historyBody.innerHTML = `
        <tr><td colspan="6" class="sc-empty">
          <div class="sc-empty-icon">📭</div>
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
            return `<tr><td>${icon} ${escHtml(c.name)}</td><td>${escHtml(c.type)}</td><td>${escHtml(c.statusCode !== null && c.statusCode !== undefined ? String(c.statusCode) : '—')}</td><td>${fmtDuration(c.durationMs)}</td><td>${escHtml(c.error || 'OK')}</td></tr>`;
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
            <button class="sc-expand-btn" aria-expanded="false" aria-controls="${escHtml(rowId)}" data-target="${escHtml(rowId)}">
              ▼ Details
            </button>
          </td>
        </tr>
        <tr id="${escHtml(rowId)}" class="sc-details-row hidden">
          <td colspan="6">
            <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
              <thead><tr><th style="text-align:left;padding:.25rem .5rem;">Check</th><th>Type</th><th>Status</th><th>Duration</th><th>Result</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </td>
        </tr>`;
      })
      .join('');
  }

  /* ── API calls ────────────────────────────────────────────────────────────── */
  async function loadRuns() {
    try {
      const data = await AdminShared.api(`${API_URL}?limit=30`);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const latest = runs[0] || null;

      renderSummary(latest);
      renderChecks(latest);
      renderHistory(runs);
    } catch (err) {
      const msg = escHtml(err.message || 'Unknown error');
      summaryEl.innerHTML = `<div class="sc-summary-card"><div class="sc-badge sc-badge--fail">⚠️</div><div class="sc-summary-meta"><p class="sc-summary-title">Failed to load</p><p class="sc-summary-subtitle">${msg}</p></div></div>`;
      checksListEl.innerHTML = `<div class="sc-empty"><p>Could not load check data</p></div>`;
      historyBody.innerHTML = `<tr><td colspan="6" class="sc-empty"><p>Could not load history</p></td></tr>`;
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
      await loadRuns();
      if (runStatus) {
        runStatus.textContent = '';
      }
    } catch (err) {
      const msg = err.message || 'Run failed';
      if (runStatus) {
        runStatus.textContent = `Error: ${msg}`;
      }
    } finally {
      runBtn.disabled = false;
    }
  }

  /* ── Bootstrap ────────────────────────────────────────────────────────────── */
  if (runBtn) {
    runBtn.addEventListener('click', triggerRun);
  }

  // Delegated click handler for history expand/collapse buttons
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

  // Load on DOMContentLoaded (AdminShared is loaded before this script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRuns);
  } else {
    loadRuns();
  }
})();
