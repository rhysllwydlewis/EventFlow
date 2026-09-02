/**
 * Admin Debug mobile mop-up.
 * Enhances the existing rendered system-check UI without replacing its data flow.
 */
'use strict';
(function () {
  const AUTH_REDIRECT_PATTERN = /(?:\/login|\/sign-?in|\/auth(?:\/|\?|$)|login\?|signin\?)/i;
  const TAB_STORAGE_KEY = 'eventflow-admin-debug-tab';
  const EMPTY_GROUP_MESSAGES = Object.freeze({
    attention: 'No failed checks or unexpected warnings.',
    protected: 'No protected-route redirects.',
    passed: 'No clean passes in this run.',
  });
  const checksList = document.getElementById('sc-checks-list');
  const statsBar = document.getElementById('sc-stats-bar');
  const summary = document.getElementById('sc-summary');
  const tabs = document.querySelector('.sc-tabs');
  let processing = false;

  document.body.classList.add('admin-debug-mobile-enhanced');

  function isExpectedAuthRedirect(row) {
    const redirect = row.querySelector('.sc-check-redirect');
    const warning = row.querySelector('.sc-check-warn');
    if (!redirect || !warning) {
      return false;
    }

    const warningEvidence = [warning.title, warning.textContent].filter(Boolean).join(' ').trim();
    const redirectEvidence = [redirect.title, redirect.textContent].filter(Boolean).join(' ');
    return (
      /^Auth redirect\b/i.test(warningEvidence) && AUTH_REDIRECT_PATTERN.test(redirectEvidence)
    );
  }

  function readStoredTab() {
    try {
      return window.sessionStorage.getItem(TAB_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function persistSelectedTab(target) {
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, target);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    try {
      window.history.replaceState(null, '', `#${target.replace(/^tab-/, '')}`);
    } catch {
      // Hash persistence is a progressive enhancement; tab switching still works without it.
    }
  }

  function classifyRow(row) {
    const failed = row.querySelector('.sc-check-status')?.getAttribute('aria-label') === 'Fail';
    if (failed || row.querySelector('.sc-check-err')) {
      return 'failed';
    }
    if (isExpectedAuthRedirect(row)) {
      return 'protected';
    }
    if (row.classList.contains('sc-check-row--warn') || row.querySelector('.sc-check-warn')) {
      return 'attention';
    }
    return 'passed';
  }

  function enhanceRow(row, state) {
    if (row.classList.contains('sc-check-row--mobile-enhanced')) {
      return row;
    }

    const status = row.querySelector('.sc-check-status');
    const name = row.querySelector('.sc-check-name');
    const type = row.querySelector('.sc-check-type');
    const code = row.querySelector('.sc-check-code');
    const duration = row.querySelector('.sc-check-dur');
    const result = row.querySelector('.sc-check-ok, .sc-check-warn, .sc-check-err');
    const redirect = row.querySelector('.sc-check-redirect');

    row.classList.add('sc-check-row--mobile-enhanced', `sc-check-row--${state}`);

    if (state === 'protected') {
      row.classList.remove('sc-check-row--warn');
      if (status) {
        status.textContent = '🔒';
        status.setAttribute('aria-label', 'Protected route');
      }
      if (result) {
        result.textContent = 'PROTECTED';
        result.className = 'sc-check-info';
        result.title = 'Expected authentication redirect';
      }
    }

    const main = document.createElement('div');
    main.className = 'sc-check-main';
    if (name) {
      main.appendChild(name);
    }

    const meta = document.createElement('div');
    meta.className = 'sc-check-meta';
    [type, code, duration, redirect].filter(Boolean).forEach(element => meta.appendChild(element));
    main.appendChild(meta);

    const outcome = document.createElement('div');
    outcome.className = 'sc-check-outcome';
    if (result) {
      outcome.appendChild(result);
    }

    row.replaceChildren(...[status, main, outcome].filter(Boolean));
    return row;
  }

  function createGroup({ key, label, icon, rows, open = false, fixed = false }) {
    const group = document.createElement(fixed ? 'section' : 'details');
    group.className = `sc-check-group sc-check-group--${key}`;
    group.dataset.group = key;
    if (!rows.length) {
      group.classList.add('sc-check-group--empty');
    }
    if (!fixed && open) {
      group.open = true;
    }

    const heading = document.createElement(fixed ? 'div' : 'summary');
    heading.className = fixed ? 'sc-check-group-heading' : '';
    heading.innerHTML = `<span>${icon} ${label}</span><span class="sc-check-group-count">${rows.length}</span>`;

    const body = document.createElement('div');
    body.className = 'sc-check-group-body';
    if (rows.length) {
      rows.forEach(row => body.appendChild(row));
    } else {
      const empty = document.createElement('div');
      empty.className = `sc-check-list-empty sc-check-list-empty--${key}`;
      empty.textContent = EMPTY_GROUP_MESSAGES[key] || 'No checks in this group.';
      body.appendChild(empty);
    }

    group.append(heading, body);
    return group;
  }

  function applyFilter(groups, filter) {
    groups.forEach(group => {
      const key = group.dataset.group;
      group.hidden = filter !== 'all' && key !== filter;
      if (filter !== 'all' && key === filter && group.tagName === 'DETAILS') {
        group.open = true;
      }
    });
  }

  function createFilterBar(groups) {
    const bar = document.createElement('div');
    bar.className = 'sc-overview-filter-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Filter latest system checks');

    const options = [
      ['all', 'All'],
      ['attention', 'Needs attention'],
      ['protected', 'Protected'],
      ['passed', 'Passed'],
    ];

    options.forEach(([value, label], index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ef-cta sc-overview-filter-btn';
      button.dataset.filter = value;
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.textContent = label;
      button.addEventListener('click', () => {
        bar
          .querySelectorAll('.sc-overview-filter-btn')
          .forEach(item => item.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        applyFilter(groups, value);
      });
      bar.appendChild(button);
    });

    return bar;
  }

  function renderExclusiveStats(counts) {
    if (!statsBar) {
      return;
    }
    const values = [
      ['Total', counts.total, 'total'],
      ['Clean passes', counts.passed, 'pass'],
      ['Protected', counts.protected, 'info'],
      ['Needs attention', counts.attention + counts.failed, counts.failed ? 'fail' : 'warn'],
    ];

    statsBar.classList.add('sc-stats-bar--exclusive');
    statsBar.innerHTML = values
      .map(
        ([label, value, type]) => `
          <div class="sc-stat sc-stat--${type}">
            <span class="sc-stat-value">${value}</span>
            <span class="sc-stat-label">${label}</span>
          </div>`
      )
      .join('');
  }

  function enhanceSummary(counts) {
    const card = summary?.querySelector('.sc-summary-card');
    const subtitle = card?.querySelector('.sc-summary-subtitle');
    if (!card || !subtitle) {
      return;
    }

    card.classList.add('sc-summary-card--mobile-enhanced');
    const existingParts = subtitle.textContent.split(' · ').map(part => part.trim());
    const suffix = existingParts.length >= 3 ? existingParts.slice(-2) : [];
    const parts = [
      `${counts.total} checks completed`,
      `${counts.passed} clean`,
      `${counts.protected} protected`,
      `${counts.attention + counts.failed} need attention`,
      ...suffix,
    ];
    subtitle.textContent = parts.join(' · ');
  }

  function enhanceChecks() {
    if (!checksList || processing || checksList.querySelector('.sc-check-groups')) {
      return;
    }

    const originalRows = Array.from(checksList.children).filter(element =>
      element.classList.contains('sc-check-row')
    );
    if (!originalRows.length) {
      return;
    }

    processing = true;
    try {
      const buckets = { attention: [], protected: [], passed: [], failed: [] };
      originalRows.forEach(row => {
        const state = classifyRow(row);
        buckets[state].push(enhanceRow(row, state));
      });

      const attentionRows = [...buckets.failed, ...buckets.attention];
      const groups = [
        createGroup({
          key: 'attention',
          label: 'Needs attention',
          icon: attentionRows.length ? '⚠️' : '✅',
          rows: attentionRows,
          fixed: true,
        }),
        createGroup({
          key: 'protected',
          label: 'Expected authentication redirects',
          icon: '🔒',
          rows: buckets.protected,
        }),
        createGroup({
          key: 'passed',
          label: 'Successful checks',
          icon: '✅',
          rows: buckets.passed,
        }),
      ];

      const groupWrap = document.createElement('div');
      groupWrap.className = 'sc-check-groups';
      groups.forEach(group => groupWrap.appendChild(group));
      checksList.replaceChildren(createFilterBar(groups), groupWrap);

      const counts = {
        total: originalRows.length,
        failed: buckets.failed.length,
        attention: buckets.attention.length,
        protected: buckets.protected.length,
        passed: buckets.passed.length,
      };
      renderExclusiveStats(counts);
      enhanceSummary(counts);
    } finally {
      processing = false;
    }
  }

  function enhanceTabs() {
    if (!tabs) {
      return;
    }
    tabs.classList.add('sc-tabs--mobile-enhanced');
    const buttons = Array.from(tabs.querySelectorAll('.sc-tab-btn'));

    buttons.forEach((button, index) => {
      button.addEventListener('click', () => {
        button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        const target = button.getAttribute('aria-controls');
        if (target) {
          persistSelectedTab(target);
        }
      });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowLeft') {
          nextIndex = Math.max(0, index - 1);
        }
        if (event.key === 'ArrowRight') {
          nextIndex = Math.min(buttons.length - 1, index + 1);
        }
        if (event.key === 'Home') {
          nextIndex = 0;
        }
        if (event.key === 'End') {
          nextIndex = buttons.length - 1;
        }
        buttons[nextIndex].focus();
        buttons[nextIndex].click();
      });
    });

    const hashTarget = window.location.hash ? `tab-${window.location.hash.slice(1)}` : null;
    const storedTarget = readStoredTab();
    const targetId = hashTarget && document.getElementById(hashTarget) ? hashTarget : storedTarget;
    const selected = targetId
      ? buttons.find(button => button.getAttribute('aria-controls') === targetId)
      : buttons.find(button => button.getAttribute('aria-selected') === 'true');
    if (selected && selected.getAttribute('aria-selected') !== 'true') {
      selected.click();
    } else if (selected) {
      selected.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function observeChecks() {
    if (!checksList) {
      return;
    }
    const observer = new MutationObserver(() => {
      if (!processing) {
        window.requestAnimationFrame(enhanceChecks);
      }
    });
    observer.observe(checksList, { childList: true });
  }

  enhanceTabs();
  enhanceChecks();
  observeChecks();
})();
