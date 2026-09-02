/**
 * EventFlow Community — admin and moderation centre
 *
 * Dashboard, moderation queue, content review, categories and settings.
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  const root = document.getElementById('efc-admin');
  if (!EFC || !root) {
    return;
  }

  const ADMIN = '/api/v1/admin/community';
  const TABS = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'reports', label: 'Reports' },
    { key: 'content', label: 'Content' },
    { key: 'categories', label: 'Categories' },
    { key: 'appeals', label: 'Appeals' },
    { key: 'audit', label: 'Audit' },
    { key: 'settings', label: 'Settings' },
  ];

  /**
   * Labels and units for the dashboard metrics. Deriving these from the key
   * alone produced "Active Contributors30 Days" and printed percentages and
   * hour counts as bare numbers, so the ones that need a unit are named here.
   */
  const METRIC_LABELS = {
    answeredPercentage: 'Discussions answered',
    helpfulAnswerRate: 'Marked helpful',
    medianHoursToFirstReply: 'Median time to first reply',
    medianHoursToReportResolution: 'Median time to resolve a report',
    activeContributors30Days: 'Active contributors (30 days)',
  };
  const PERCENT_METRICS = new Set(['answeredPercentage', 'helpfulAnswerRate']);
  const HOUR_METRICS = new Set(['medianHoursToFirstReply', 'medianHoursToReportResolution']);

  let active = window.location.hash.replace('#', '') || 'dashboard';

  /**
   * Render the tab strip and the active panel container.
   * @returns {void} Nothing.
   */
  function shell() {
    root.innerHTML = `
      <h1>Community centre</h1>
      <div class="efc-tabs" role="tablist" aria-label="Community admin sections">
        ${TABS.map(
          tab =>
            `<button type="button" class="efc-tab" role="tab" aria-selected="${
              tab.key === active
            }" data-admin-tab="${tab.key}">${EFC.esc(tab.label)}</button>`
        ).join('')}
      </div>
      <div id="efc-admin-panel" role="tabpanel">${EFC.skeleton(3)}</div>`;

    root.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => {
        active = button.dataset.adminTab;
        window.location.hash = active;
        shell();
        load();
      });
    });
  }

  /**
   * Render a definition list of metrics.
   * @param {string} title Group heading.
   * @param {Object} values Metric values.
   * @returns {string} HTML.
   */
  function metricGroup(title, values) {
    const rows = Object.entries(values)
      .map(
        ([key, value]) =>
          `<li><strong>${EFC.esc(METRIC_LABELS[key] || humanise(key))}:</strong> ${
            value === null || value === undefined
              ? 'no data yet'
              : EFC.esc(formatMetric(key, value))
          }</li>`
      )
      .join('');
    return `<section class="efc-side__card"><h2>${EFC.esc(title)}</h2><ul class="efc-side__list">${rows}</ul></section>`;
  }

  /**
   * Give a metric its unit. A median of 8352 with no unit is unreadable, and
   * a percentage shown as a bare integer reads as a count.
   * @param {string} key Metric key.
   * @param {number|string} value Raw value.
   * @returns {string} Display value.
   */
  function formatMetric(key, value) {
    if (PERCENT_METRICS.has(key)) {
      return `${value}%`;
    }
    if (HOUR_METRICS.has(key)) {
      return formatHours(value);
    }
    return String(value);
  }

  /**
   * Render an hour count at a scale a moderator can act on.
   * @param {number} hours Hours.
   * @returns {string} Readable duration.
   */
  function formatHours(hours) {
    const value = Number(hours);
    if (!Number.isFinite(value)) {
      return String(hours);
    }
    if (value < 1) {
      const minutes = Math.max(1, Math.round(value * 60));
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }
    if (value < 48) {
      const rounded = Math.round(value);
      return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
    }
    const days = Math.round(value / 24);
    return `${days} days`;
  }

  /**
   * Turn a camelCase key into a readable label.
   * @param {string} key Metric key.
   * @returns {string} Label.
   */
  function humanise(key) {
    return (
      key
        .replace(/([A-Z])/g, ' $1')
        // Without this a trailing figure runs into the previous word.
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/^./, char => char.toUpperCase())
        .replace(/\bPercentage\b/, '%')
    );
  }

  /**
   * Load and render the active panel.
   * @returns {Promise<void>} Resolves when rendered.
   */
  // skipcq: JS-R1005 -- One switch across the admin panels keeps their shapes visible together.
  async function load() {
    const panel = document.getElementById('efc-admin-panel');
    try {
      if (active === 'dashboard') {
        const data = await EFC.api(`${ADMIN}/dashboard`);
        panel.innerHTML = `<div class="efc-grid">
          ${metricGroup('Content', data.content)}
          ${metricGroup('Responsiveness', data.responsiveness)}
          ${metricGroup('Safety', data.safety)}
        </div>
        <p class="efc-meta">These are the measures we act on. We deliberately do not track member
          totals, online counts or raw post volume.</p>`;
        return;
      }

      if (active === 'reports') {
        const data = await EFC.api(`${ADMIN}/reports?status=open`);
        panel.innerHTML = data.reports.length
          ? `<ul class="efc-list">${data.reports
              .map(
                report => `<li class="efc-discussion">
                  <p class="efc-meta"><span class="efc-badge">${EFC.esc(report.priority)}</span>
                    ${EFC.esc(report.reasonLabel)} · ${EFC.esc(EFC.timeAgo(report.createdAt))}</p>
                  <p class="efc-discussion__excerpt">${EFC.esc(
                    (report.snapshot && report.snapshot.body) || ''
                  )}</p>
                  ${report.detail ? `<p class="efc-meta">Reporter said: ${EFC.esc(report.detail)}</p>` : ''}
                  <div class="efc-post__actions">
                    <button type="button" class="efc-action" data-report-action="actioned" data-id="${EFC.esc(
                      report.id
                    )}">Uphold</button>
                    <button type="button" class="efc-action" data-report-action="dismissed" data-id="${EFC.esc(
                      report.id
                    )}">Dismiss</button>
                    ${
                      report.discussionStableId
                        ? `<a class="efc-action" href="/community/discussion/${EFC.esc(
                            report.discussionStableId
                          )}">Open thread</a>`
                        : ''
                    }
                  </div>
                </li>`
              )
              .join('')}</ul>`
          : EFC.emptyState('The queue is clear', 'There are no open reports to review.');
        wireReportActions();
        return;
      }

      if (active === 'content') {
        const data = await EFC.api(`${ADMIN}/content?state=quarantined`);
        panel.innerHTML = `<p class="efc-meta">Content held for review. Approving publishes it; removing keeps the record for the audit trail.</p>
          ${
            data.items.length
              ? `<ul class="efc-list">${data.items
                  .map(
                    item => `<li class="efc-discussion">
                      <h3 class="efc-discussion__title">${EFC.esc(item.title || 'Reply')}</h3>
                      <p class="efc-discussion__excerpt">${EFC.esc(item.excerpt)}</p>
                      <p class="efc-meta">${EFC.esc(item.author.displayName)} · risk ${item.riskScore} · ${EFC.esc(
                        (item.riskSignals || []).join(', ') || 'no signals'
                      )}</p>
                      <div class="efc-post__actions">
                        <button type="button" class="efc-action" data-content-action="approve" data-type="${
                          item.title ? 'discussion' : 'reply'
                        }" data-id="${EFC.esc(item.id)}">Approve</button>
                        <button type="button" class="efc-action" data-content-action="remove" data-type="${
                          item.title ? 'discussion' : 'reply'
                        }" data-id="${EFC.esc(item.id)}">Remove</button>
                        <button type="button" class="efc-action" data-content-action="mark_spam" data-type="${
                          item.title ? 'discussion' : 'reply'
                        }" data-id="${EFC.esc(item.id)}">Mark as spam</button>
                      </div>
                    </li>`
                  )
                  .join('')}</ul>`
              : EFC.emptyState('Nothing held for review', 'No content is currently quarantined.')
          }`;
        wireContentActions();
        return;
      }

      if (active === 'categories') {
        const data = await EFC.api(`${ADMIN}/categories`);
        panel.innerHTML = `<ul class="efc-list">${data.categories
          .map(
            category => `<li class="efc-discussion">
              <h3 class="efc-discussion__title">${EFC.esc(category.icon || '')} ${EFC.esc(category.name)}</h3>
              <p class="efc-meta">/${EFC.esc(category.slug)} · order ${category.order} · ${
                category.visible === false ? 'hidden' : 'visible'
              }${category.archived ? ' · archived' : ''}</p>
              <p class="efc-discussion__excerpt">${EFC.esc(category.description || '')}</p>
            </li>`
          )
          .join('')}</ul>`;
        return;
      }

      if (active === 'appeals') {
        const data = await EFC.api(`${ADMIN}/appeals`);
        panel.innerHTML = data.appeals.length
          ? `<ul class="efc-list">${data.appeals
              .map(
                appeal => `<li class="efc-discussion">
                  <p class="efc-meta">${EFC.esc(appeal.status)} · ${EFC.esc(EFC.timeAgo(appeal.createdAt))}</p>
                  <p class="efc-discussion__excerpt">${EFC.esc(appeal.message)}</p>
                </li>`
              )
              .join('')}</ul>`
          : EFC.emptyState('No appeals', 'Nobody has appealed a moderation decision.');
        return;
      }

      if (active === 'audit') {
        const data = await EFC.api(`${ADMIN}/audit`);
        panel.innerHTML = data.actions.length
          ? `<ul class="efc-list">${data.actions
              .map(
                item => `<li class="efc-discussion">
                  <p class="efc-meta">${EFC.esc(item.action)} · ${EFC.esc(item.targetType)} ${EFC.esc(
                    item.targetId
                  )} · ${EFC.esc(item.moderatorHandle)} · ${EFC.esc(EFC.timeAgo(item.createdAt))}</p>
                  ${item.reason ? `<p class="efc-discussion__excerpt">${EFC.esc(item.reason)}</p>` : ''}
                </li>`
              )
              .join('')}</ul>`
          : EFC.emptyState('No moderation actions yet', 'The audit trail is empty.');
        return;
      }

      const data = await EFC.api(`${ADMIN}/settings`);
      panel.innerHTML = `<form class="efc-card" id="efc-admin-settings">
        <div class="efc-field">
          <label for="efc-setting-blocked">Blocked domains (one per line)</label>
          <textarea id="efc-setting-blocked">${EFC.esc(
            (data.settings.blockedDomains || []).join('\n')
          )}</textarea>
        </div>
        <div class="efc-field">
          <label for="efc-setting-allowed">Always-allowed domains (one per line)</label>
          <textarea id="efc-setting-allowed">${EFC.esc(
            (data.settings.allowedDomains || []).join('\n')
          )}</textarea>
        </div>
        <div class="efc-composer__row">
          <div class="efc-field">
            <label for="efc-setting-archive">Auto-archive after (days)</label>
            <input id="efc-setting-archive" type="number" min="0" value="${Number(
              data.settings.autoArchiveDays || 0
            )}" />
          </div>
          <div class="efc-field">
            <label for="efc-setting-old">Old-thread warning after (days)</label>
            <input id="efc-setting-old" type="number" min="0" value="${Number(
              data.settings.oldThreadWarningDays || 0
            )}" />
          </div>
        </div>
        <p><label><input type="checkbox" id="efc-setting-quarantine" ${
          data.settings.quarantineLowTrustLinks !== false ? 'checked' : ''
        } /> Hold links from low-trust accounts on dormant threads for review</label></p>
        <p><button type="submit" class="btn btn-primary">Save settings</button></p>
      </form>`;
      wireSettings();
    } catch (error) {
      panel.innerHTML =
        error.status === 403
          ? EFC.emptyState(
              'Moderator access required',
              'Your account cannot open the community centre.'
            )
          : EFC.errorState('We could not load this section.');
    }
  }

  /**
   * Wire the report decision buttons.
   * @returns {void} Nothing.
   */
  function wireReportActions() {
    root.querySelectorAll('[data-report-action]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await EFC.api(`${ADMIN}/reports/${button.dataset.id}`, {
            method: 'PATCH',
            body: { status: button.dataset.reportAction },
          });
          EFC.announce('Report updated.');
          load();
        } catch (error) {
          EFC.announce(error.message, 'error');
        }
      });
    });
  }

  /**
   * Wire the content moderation buttons.
   * @returns {void} Nothing.
   */
  function wireContentActions() {
    root.querySelectorAll('[data-content-action]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await EFC.api(`${ADMIN}/content/${button.dataset.type}/${button.dataset.id}/action`, {
            method: 'POST',
            body: { action: button.dataset.contentAction },
          });
          EFC.announce('Decision applied.');
          load();
        } catch (error) {
          EFC.announce(error.message, 'error');
        }
      });
    });
  }

  /**
   * Wire the settings form.
   * @returns {void} Nothing.
   */
  function wireSettings() {
    const form = document.getElementById('efc-admin-settings');
    if (!form) {
      return;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const lines = id =>
        document
          .getElementById(id)
          .value.split('\n')
          .map(value => value.trim())
          .filter(Boolean);
      try {
        await EFC.api(`${ADMIN}/settings`, {
          method: 'PATCH',
          body: {
            blockedDomains: lines('efc-setting-blocked'),
            allowedDomains: lines('efc-setting-allowed'),
            autoArchiveDays: Number(document.getElementById('efc-setting-archive').value),
            oldThreadWarningDays: Number(document.getElementById('efc-setting-old').value),
            quarantineLowTrustLinks: document.getElementById('efc-setting-quarantine').checked,
          },
        });
        EFC.announce('Settings saved.');
      } catch (error) {
        EFC.announce(error.message, 'error');
      }
    });
  }

  shell();
  load();
})();
