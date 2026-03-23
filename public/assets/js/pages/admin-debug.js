/**
 * Admin Debug Page — System Checks + Account Tools
 *
 * Fetches the check catalog and run history from the admin API and renders:
 *   - Overview tab: latest run summary + per-check breakdown
 *   - Coverage tab: full list of pages/APIs with last known status + filter bar
 *   - History tab: run history table with expandable check rows and triggeredBy
 *   - Account Tools tab: emergency auth debug tools (gated by debug status endpoint)
 *
 * New features:
 *   - Better error states (409 = already running, 403 = CSRF, 500 = server error)
 *   - "Re-run failed checks only" button
 *   - "Copy/Download latest run as JSON" button
 *   - Shows redirect warnings for admin page checks
 *   - Shows triggeredBy in history table
 *   - Account Tools tab with all emergency debug endpoints
 */
(function () {
  'use strict';

  const API_URL = '/api/admin/system-checks';
  const RUN_URL = '/api/admin/system-checks/run';
  const CATALOG_URL = '/api/admin/system-checks/catalog';
  const DEBUG_STATUS_URL = '/api/admin/debug/status';
  const DEBUG_BASE_URL = '/api/admin/debug';

  /* ── DOM refs ──────────────────────────────────────────────────────────── */
  const summaryEl = document.getElementById('sc-summary');
  const checksListEl = document.getElementById('sc-checks-list');
  const historyBody = document.getElementById('sc-history-body');
  const runBtn = document.getElementById('sc-run-btn');
  const runStatus = document.getElementById('sc-run-status');
  const statsBar = document.getElementById('sc-stats-bar');
  const coverageEl = document.getElementById('sc-coverage-list');
  const coverageRunTime = document.getElementById('sc-coverage-run-time');
  const copyBtn = document.getElementById('sc-copy-btn');
  const rerunFailedBtn = document.getElementById('sc-rerun-failed-btn');

  /* ── State ─────────────────────────────────────────────────────────────── */
  let _catalog = [];
  let _latestRun = null;
  let _allRuns = [];
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

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('aria-controls');
      tabBtns.forEach(b => b.setAttribute('aria-selected', 'false'));
      // Use a live query so the Account Tools panel (present from load) is included
      document.querySelectorAll('.sc-tab-panel').forEach(p => p.classList.remove('active'));
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
    const warned = checks.filter(c => c.ok && c.warning).length;
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
        warned > 0
          ? `
      <div class="sc-stat sc-stat--warn">
        <span class="sc-stat-value">${escHtml(String(warned))}</span>
        <span class="sc-stat-label">Warnings</span>
      </div>`
          : ''
      }
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
    const warned = checks.filter(c => c.ok && c.warning).length;
    const subtitle = isPassed
      ? `All ${checks.length} checks passed${warned > 0 ? ` (${warned} with warnings)` : ''} · ${fmtDate(run.startedAt)} · ${fmtDuration(run.durationMs)}`
      : `${failed} of ${checks.length} checks failed · ${fmtDate(run.startedAt)} · ${fmtDuration(run.durationMs)}`;

    const triggeredByHtml = run.triggeredBy
      ? `<div class="sc-summary-triggered">Triggered by: ${escHtml(run.triggeredBy.email || run.triggeredBy.id || 'unknown')}</div>`
      : '';

    summaryEl.innerHTML = `
      <div class="sc-summary-card">
        <div class="sc-badge ${escHtml(badgeCls)}" aria-hidden="true">${icon}</div>
        <div class="sc-summary-meta">
          <p class="sc-summary-title">${label}</p>
          <p class="sc-summary-subtitle">${escHtml(subtitle)}</p>
          ${triggeredByHtml}
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
        let resultHtml;
        if (c.error) {
          resultHtml = `<span class="sc-check-err">${escHtml(c.error)}</span>`;
        } else if (c.warning) {
          resultHtml = `<span class="sc-check-warn" title="${escHtml(c.warning)}">⚠️ WARN</span>`;
        } else {
          resultHtml = `<span class="sc-check-ok">OK</span>`;
        }
        const redirectHtml =
          c.redirected && c.redirectUrl
            ? `<span class="sc-check-redirect" title="Redirected to: ${escHtml(c.redirectUrl)}">↪ redirect</span>`
            : '';
        return `
        <div class="sc-check-row${c.warning && c.ok ? ' sc-check-row--warn' : ''}">
          <span class="sc-check-status" aria-label="${c.ok ? 'Pass' : 'Fail'}">${c.ok ? (c.warning ? '⚠️' : '✅') : '❌'}</span>
          <span class="sc-check-name">${escHtml(c.name)}</span>
          <span class="sc-check-type">${escHtml(c.type)}</span>
          <span class="sc-check-code">${escHtml(codeStr)}</span>
          <span class="sc-check-dur">${fmtDuration(c.durationMs)}</span>
          ${resultHtml}
          ${redirectHtml}
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
      if (_activeFilter === 'warn') {
        const r = resultMap[item.name];
        return r && r.ok && r.warning;
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
        } else if (!r.ok) {
          statusIcon = '❌';
          resultHtml = `<span class="sc-check-err">${escHtml(r.error || String(r.statusCode || 'Error'))}</span>`;
        } else if (r.warning) {
          statusIcon = '⚠️';
          const codeStr =
            r.statusCode !== null && r.statusCode !== undefined ? String(r.statusCode) : '—';
          resultHtml = `<span class="sc-check-warn" title="${escHtml(r.warning)}">${escHtml(codeStr)} · ${fmtDuration(r.durationMs)} · WARN</span>`;
        } else {
          statusIcon = '✅';
          const codeStr =
            r.statusCode !== null && r.statusCode !== undefined ? String(r.statusCode) : '—';
          resultHtml = `<span class="sc-check-ok">${escHtml(codeStr)} · ${fmtDuration(r.durationMs)}</span>`;
        }
        html += `
          <div class="sc-check-row${r && r.warning && r.ok ? ' sc-check-row--warn' : ''}">
            <span class="sc-check-status" aria-label="${!r ? 'Untested' : r.ok ? (r.warning ? 'Warning' : 'Pass') : 'Fail'}">${statusIcon}</span>
            <span class="sc-check-name">${escHtml(item.name)}</span>
            <span class="sc-check-path">${escHtml(item.path)}</span>
            <span class="sc-check-group">${escHtml(item.group)}</span>
            ${resultHtml}
          </div>`;
      });
    });

    coverageEl.innerHTML = html;

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
        <tr><td colspan="7" class="sc-empty">
          <div class="sc-empty-icon" aria-hidden="true">📭</div>
          <p>No run history yet</p>
        </td></tr>`;
      return;
    }

    historyBody.innerHTML = runs
      .map((run, idx) => {
        const checks = Array.isArray(run.checks) ? run.checks : [];
        const failed = checks.filter(c => !c.ok).length;
        const warned = checks.filter(c => c.ok && c.warning).length;
        const pillCls = run.status === 'pass' ? 'sc-pill--pass' : 'sc-pill--fail';
        const rowId = `sc-detail-${idx}`;
        const triggeredBy = run.triggeredBy
          ? escHtml(run.triggeredBy.email || run.triggeredBy.id || 'unknown')
          : '<span style="opacity:.5;">scheduler</span>';

        const detailRows = checks
          .map(c => {
            const icon = c.ok ? (c.warning ? '⚠️' : '✅') : '❌';
            const code =
              c.statusCode !== null && c.statusCode !== undefined ? String(c.statusCode) : '—';
            const note = c.warning
              ? `<span class="sc-check-warn" title="${escHtml(c.warning)}">WARN</span>`
              : c.error
                ? escHtml(c.error)
                : 'OK';
            return `<tr>
          <td>${icon} ${escHtml(c.name)}</td>
          <td>${escHtml(c.type)}</td>
          <td>${escHtml(code)}</td>
          <td>${fmtDuration(c.durationMs)}</td>
          <td>${note}</td>
        </tr>`;
          })
          .join('');

        return `
        <tr>
          <td><span class="sc-pill ${escHtml(pillCls)}">${escHtml((run.status || '').toUpperCase())}</span></td>
          <td>${escHtml(fmtDate(run.startedAt))}</td>
          <td>${fmtDuration(run.durationMs)}</td>
          <td>${escHtml(run.environment || '—')}</td>
          <td>${checks.length - failed}/${checks.length}${warned > 0 ? ` <span class="sc-check-warn">(${warned}⚠)</span>` : ''}</td>
          <td>${triggeredBy}</td>
          <td>
            <button class="sc-expand-btn" type="button" aria-expanded="false" aria-controls="${escHtml(rowId)}" data-target="${escHtml(rowId)}">
              ▼ Details
            </button>
          </td>
        </tr>
        <tr id="${escHtml(rowId)}" class="sc-details-row hidden">
          <td colspan="7">
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

  /* ── Copy/Download JSON ─────────────────────────────────────────────────── */
  function setupCopyBtn() {
    if (!copyBtn) {
      return;
    }
    copyBtn.addEventListener('click', () => {
      if (!_latestRun) {
        return;
      }
      const json = JSON.stringify(_latestRun, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(json)
          .then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
              copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy JSON`;
            }, 2000);
          })
          .catch(() => downloadJson(json));
      } else {
        downloadJson(json);
      }
    });
  }

  function downloadJson(json) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-check-run-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── Re-run failed checks button ────────────────────────────────────────── */
  function setupRerunFailedBtn() {
    if (!rerunFailedBtn) {
      return;
    }
    rerunFailedBtn.addEventListener('click', async () => {
      if (!_latestRun) {
        return;
      }
      const failed = (Array.isArray(_latestRun.checks) ? _latestRun.checks : []).filter(c => !c.ok);
      if (failed.length === 0) {
        setRunStatus('✓ No failed checks in the latest run.', false);
        return;
      }
      const names = failed.map(c => c.name).join(', ');
      const confirmed = await AdminShared.confirm(
        `Re-run all checks now?\n\nFailed checks: ${names}\n\nNote: selective re-run is not yet supported; this triggers a full run.`
      );
      if (!confirmed) {
        return;
      }
      await triggerRun();
    });
  }

  /* ── API calls ──────────────────────────────────────────────────────────── */
  async function loadData() {
    try {
      const [catalogData, runsData] = await Promise.all([
        AdminShared.api(CATALOG_URL),
        AdminShared.api(`${API_URL}?limit=30`),
      ]);

      _catalog = Array.isArray(catalogData.catalog) ? catalogData.catalog : [];
      const runs = Array.isArray(runsData.runs) ? runsData.runs : [];
      _allRuns = runs;
      _latestRun = runs[0] || null;

      renderStats(_latestRun, _catalog.length);
      renderSummary(_latestRun);
      renderChecks(_latestRun);
      renderCoverage();
      renderHistory(runs);

      // Show/hide extra action buttons
      if (copyBtn) {
        copyBtn.style.display = _latestRun ? '' : 'none';
      }
      if (rerunFailedBtn) {
        const hasFailed =
          _latestRun && Array.isArray(_latestRun.checks) && _latestRun.checks.some(c => !c.ok);
        rerunFailedBtn.style.display = hasFailed ? '' : 'none';
      }
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
        historyBody.innerHTML = `<tr><td colspan="7" class="sc-empty"><p>Could not load history</p></td></tr>`;
      }
      if (coverageEl) {
        coverageEl.innerHTML = `<div class="sc-empty"><p>Could not load catalog</p></div>`;
      }
    }
  }

  function setRunStatus(msg, isError) {
    if (!runStatus) {
      return;
    }
    runStatus.textContent = msg;
    runStatus.style.color = isError ? 'var(--color-danger, #dc2626)' : '';
  }

  async function triggerRun(options = {}) {
    if (!runBtn) {
      return;
    }
    runBtn.disabled = true;
    if (rerunFailedBtn) {
      rerunFailedBtn.disabled = true;
    }
    setRunStatus('Running checks…', false);

    try {
      const result = await AdminShared.adminFetch(RUN_URL, { method: 'POST' });

      if (result && result.status === 409) {
        setRunStatus('⏳ A run is already in progress — please wait and refresh.', true);
        return;
      }

      if (result && result.status === 403) {
        setRunStatus(
          '🔒 CSRF token missing or invalid. Please refresh the page and try again.',
          true
        );
        return;
      }

      setRunStatus('Run complete. Refreshing…', false);
      await loadData();
      setRunStatus('', false);
    } catch (err) {
      const status = err && err.status;
      if (status === 409) {
        setRunStatus('⏳ A run is already in progress — please wait and refresh.', true);
      } else if (status === 403) {
        setRunStatus(
          '🔒 CSRF token missing or invalid. Please refresh the page and try again.',
          true
        );
      } else {
        setRunStatus(`❌ Error: ${err.message || 'Run failed. Check server logs.'}`, true);
      }
    } finally {
      runBtn.disabled = false;
      if (rerunFailedBtn) {
        rerunFailedBtn.disabled = false;
      }
    }
  }

  /* ── Account Tools tab ──────────────────────────────────────────────────── */

  async function initAcctTools() {
    const statusEl = document.getElementById('sc-acct-status');
    const bodyEl = document.getElementById('sc-acct-body');
    if (!statusEl) {
      return;
    }

    statusEl.innerHTML = '<p style="opacity:.6;">Checking debug route status…</p>';

    try {
      const status = await AdminShared.api(DEBUG_STATUS_URL);

      if (status.enabled) {
        statusEl.innerHTML = `
          <div class="sc-info-banner sc-info-banner--ok" role="status">
            ✅ Emergency account tools are <strong>enabled</strong> (${escHtml(status.environment)} environment).
          </div>`;
        if (bodyEl) {
          bodyEl.hidden = false;
          wireAcctForms();
        }
      } else {
        statusEl.innerHTML = `
          <div class="sc-info-banner sc-info-banner--disabled" role="status">
            🔒 <strong>Account tools are disabled.</strong><br>
            ${escHtml(status.disabledReason || '')}<br>
            <span style="opacity:.75;">${escHtml(status.enableInstructions || '')}</span>
          </div>`;
      }
    } catch (err) {
      statusEl.innerHTML = `
        <div class="sc-info-banner sc-info-banner--error" role="alert">
          ⚠️ Could not check debug route status: ${escHtml(err.message || 'Unknown error')}
        </div>`;
    }
  }

  function showResult(el, data, isError) {
    if (!el) {
      return;
    }
    if (isError) {
      el.innerHTML = `<div class="sc-acct-result--error" role="alert">❌ ${escHtml(typeof data === 'string' ? data : JSON.stringify(data))}</div>`;
    } else {
      el.innerHTML = `<pre class="sc-acct-json">${escHtml(JSON.stringify(data, null, 2))}</pre>`;
    }
  }

  async function acctPost(path, body) {
    const res = await AdminShared.adminFetch(`${DEBUG_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res;
  }

  function wireAcctForms() {
    // Lookup
    const lookupForm = document.getElementById('sc-form-lookup');
    const lookupResult = document.getElementById('sc-lookup-result');
    if (lookupForm) {
      lookupForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = lookupForm.querySelector('[name="email"]').value.trim();
        if (!email) {
          return;
        }
        lookupResult.textContent = 'Looking up…';
        try {
          const data = await AdminShared.api(
            `${DEBUG_BASE_URL}/user?email=${encodeURIComponent(email)}`
          );
          showResult(lookupResult, data, false);
        } catch (err) {
          showResult(lookupResult, err.message || 'Lookup failed', true);
        }
      });
    }

    // Verify user
    const verifyForm = document.getElementById('sc-form-verify');
    const verifyResult = document.getElementById('sc-verify-result');
    if (verifyForm) {
      verifyForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = verifyForm.querySelector('[name="email"]').value.trim();
        if (!email) {
          return;
        }
        const confirmed = await AdminShared.confirm(
          `Force-verify the email address for "${email}"?\n\nThis will mark the account as verified and clear any verification token. This action is audit-logged.`
        );
        if (!confirmed) {
          return;
        }
        verifyResult.textContent = 'Verifying…';
        try {
          const data = await acctPost('/verify-user', { email });
          showResult(verifyResult, data, false);
        } catch (err) {
          showResult(verifyResult, err.message || 'Verify failed', true);
        }
      });
    }

    // Fix password
    const fixpwForm = document.getElementById('sc-form-fixpw');
    const fixpwResult = document.getElementById('sc-fixpw-result');
    if (fixpwForm) {
      fixpwForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = fixpwForm.querySelector('[name="email"]').value.trim();
        const newPassword = fixpwForm.querySelector('[name="newPassword"]').value;
        if (!email || !newPassword) {
          return;
        }
        if (newPassword.length < 8) {
          showResult(fixpwResult, 'Password must be at least 8 characters.', true);
          return;
        }
        const confirmed = await AdminShared.confirm(
          `Set a new password for "${email}"?\n\nThis is an emergency operation and is audit-logged. The user will need to use this new password to log in.`
        );
        if (!confirmed) {
          return;
        }
        fixpwResult.textContent = 'Updating password…';
        try {
          // Send email and password; never log password client-side
          const data = await acctPost('/fix-password', { email, newPassword });
          // Clear the password field immediately after submission
          fixpwForm.querySelector('[name="newPassword"]').value = '';
          showResult(fixpwResult, { ok: data.ok, message: data.message, email: data.email }, false);
        } catch (err) {
          fixpwForm.querySelector('[name="newPassword"]').value = '';
          showResult(fixpwResult, err.message || 'Fix password failed', true);
        }
      });
    }

    // Test email
    const emailForm = document.getElementById('sc-form-email');
    const emailResult = document.getElementById('sc-email-result');
    if (emailForm) {
      emailForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = emailForm.querySelector('[name="email"]').value.trim();
        if (!email) {
          return;
        }
        emailResult.textContent = 'Sending test email…';
        try {
          const data = await acctPost('/test-email', { email });
          showResult(emailResult, data, false);
        } catch (err) {
          showResult(emailResult, err.message || 'Email test failed', true);
        }
      });
    }

    // Login test
    const loginForm = document.getElementById('sc-form-login');
    const loginResult = document.getElementById('sc-login-result');
    if (loginForm) {
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = loginForm.querySelector('[name="email"]').value.trim();
        const password = loginForm.querySelector('[name="password"]').value;
        if (!email || !password) {
          return;
        }
        loginResult.textContent = 'Testing login…';
        try {
          const data = await acctPost('/login-test', { email, password });
          // Clear password immediately; never show it in output
          loginForm.querySelector('[name="password"]').value = '';
          // Strip password from any response before display (defensive)
          const safe = { ...data };
          delete safe.password;
          showResult(loginResult, safe, false);
        } catch (err) {
          loginForm.querySelector('[name="password"]').value = '';
          showResult(loginResult, err.message || 'Login test failed', true);
        }
      });
    }

    // Audit users
    const auditBtn = document.getElementById('sc-audit-users-btn');
    const auditResult = document.getElementById('sc-audit-result');
    if (auditBtn) {
      auditBtn.addEventListener('click', async () => {
        const confirmed = await AdminShared.confirm(
          'Run a full user audit? This will scan all user records for issues and is audit-logged.'
        );
        if (!confirmed) {
          return;
        }
        auditBtn.disabled = true;
        if (auditResult) {
          auditResult.textContent = 'Running audit…';
        }
        try {
          const data = await acctPost('/audit-users', {});
          showResult(auditResult, data, false);
        } catch (err) {
          showResult(auditResult, err.message || 'Audit failed', true);
        } finally {
          auditBtn.disabled = false;
        }
      });
    }
  }

  /* ── Bootstrap ──────────────────────────────────────────────────────────── */
  if (runBtn) {
    runBtn.addEventListener('click', () => triggerRun());
  }

  setupCopyBtn();
  setupRerunFailedBtn();

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

  function init() {
    loadData();
    initAcctTools();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
