/**
 * EventFlow Customer Dashboard Overhaul — PR #1150
 * Adds: event countdown, milestone checklist, budget KPI cards, activity feed.
 */
'use strict';
(function () {
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  /* ── Event Countdown ── */
  function renderEventCountdown(nearest) {
    const container = document.getElementById('customer-event-countdown');
    if (!container) {
      return;
    }

    if (!nearest) {
      container.className = 'event-countdown-widget event-countdown-widget--empty';
      container.innerHTML = `
        <div class="event-countdown-widget__days">🗓</div>
        <div class="event-countdown-widget__text">
          <h3>No upcoming event date set</h3>
          <p>Add your event date in the plan wizard to start the countdown.</p>
        </div>
        <a href="/start" style="color:#fff;font-size:12px;font-weight:700;opacity:.8;white-space:nowrap;text-decoration:underline;">Set date →</a>
      `;
      return;
    }

    container.className = 'event-countdown-widget';
    container.innerHTML = `
      <div class="event-countdown-widget__days" aria-label="${esc(String(nearest.daysUntil))} days until ${esc(nearest.name)}">${nearest.daysUntil}</div>
      <div class="event-countdown-widget__text">
        <h3>${esc(nearest.name)}</h3>
        <p>${new Date(nearest.date).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>
      <div class="event-countdown-widget__label">${nearest.daysUntil === 0 ? '🎉 Today!' : 'days to go'}</div>
    `;
  }

  /* ── Milestone Checklist ── */
  function renderMilestones(data) {
    const container = document.getElementById('customer-milestones-widget');
    if (!container) {
      return;
    }

    const { milestones = [], completed = 0, total = 0, percent = 0 } = data;

    container.className = 'milestones-card';
    container.innerHTML = `
      <div class="milestones-header">
        <span class="milestones-title">📋 Event Planning Progress</span>
        <span class="milestones-progress-label">${completed}/${total} complete</span>
      </div>
      <div class="milestones-progress-bar">
        <div class="milestones-progress-fill" style="width:${percent}%" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" role="progressbar" aria-label="Planning ${percent}% complete"></div>
      </div>
      <ul class="milestones-list" role="list">
        ${milestones
          .map(
            m => `
          <li>
            <a class="milestone-item ${m.done ? 'milestone-item--done' : ''}" href="${esc(m.href)}" aria-label="${esc(m.label)} ${m.done ? '(complete)' : '(not yet done)'}">
              <span class="milestone-item__check" aria-hidden="true">
                ${m.done ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
              </span>
              <span class="milestone-item__label">${esc(m.label)}</span>
              ${!m.done ? '<span class="milestone-item__arrow">›</span>' : ''}
            </a>
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  /* ── Budget KPI Cards ── */
  function renderBudgetKpis(budget) {
    const container = document.getElementById('customer-budget-kpis');
    if (!container) {
      return;
    }

    const fmt = n => `£${Number(n || 0).toLocaleString('en-GB')}`;
    const { total = 0, spent = 0, remaining = 0, percentUsed = 0 } = budget;

    if (total === 0) {
      container.innerHTML = `
        <div class="ef-empty-state" style="padding:24px 16px">
          <div class="ef-empty-state__illustration">💷</div>
          <div class="ef-empty-state__title">No budget set</div>
          <div class="ef-empty-state__desc">Set your budget below to track spending</div>
        </div>
      `;
      return;
    }

    container.className = 'kpi-grid';
    container.innerHTML = `
      <div class="kpi-card kpi-card--blue">
        <div class="kpi-card__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>
        </div>
        <div class="kpi-card__value">${esc(fmt(total))}</div>
        <div class="kpi-card__label">Total Budget</div>
      </div>
      <div class="kpi-card kpi-card--amber">
        <div class="kpi-card__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="kpi-card__value">${esc(fmt(spent))}</div>
        <div class="kpi-card__label">Spent</div>
        <span class="kpi-card__trend kpi-card__trend--${percentUsed > 80 ? 'down' : percentUsed > 50 ? 'flat' : 'up'}">${percentUsed}% used</span>
      </div>
      <div class="kpi-card kpi-card--green">
        <div class="kpi-card__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="kpi-card__value">${esc(fmt(remaining))}</div>
        <div class="kpi-card__label">Remaining</div>
      </div>
    `;
  }

  /* ── Init ── */
  async function init() {
    try {
      const [summaryRes, countdownRes, milestonesRes] = await Promise.allSettled([
        fetch('/api/v1/customer/dashboard-summary', { credentials: 'include' }),
        fetch('/api/v1/customer/event-countdown', { credentials: 'include' }),
        fetch('/api/v1/customer/milestones', { credentials: 'include' }),
      ]);

      if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
        const summary = await summaryRes.value.json();
        renderBudgetKpis(summary.budget || {});
      }

      if (countdownRes.status === 'fulfilled' && countdownRes.value.ok) {
        const countdown = await countdownRes.value.json();
        renderEventCountdown(countdown.nearest || null);
      }

      if (milestonesRes.status === 'fulfilled' && milestonesRes.value.ok) {
        const milestones = await milestonesRes.value.json();
        renderMilestones(milestones);
      }
    } catch (err) {
      if (window.__EF_DEBUG__) {
        console.warn('[customer-overhaul] init error:', err);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
