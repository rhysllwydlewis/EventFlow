/**
 * Customer dashboard home — greeting, summary row and next steps.
 *
 * One module for everything the top of /dashboard/customer shows about the
 * customer's "focus plan" (the plan whose date is next):
 *
 *   - the greeting line and the single most useful next action
 *   - the summary row: countdown, budget, planning progress, guests
 *   - the Next steps checklist
 *
 * It replaces dashboard-customer-module.js (stats grid, budget tracker,
 * progress ring, generated task timeline) and dashboard-customer-overhaul.js
 * (countdown, budget KPIs, milestone checklist), which drew the same facts
 * twice from two different calculations. Everything here is derived from the
 * plans the page already loaded plus two read-only calls: the milestone
 * checklist and the guest RSVP summary.
 *
 * Public surface: window.CustomerDashboardHome.render(plans) — called by
 * dashboard-customer-init.js on load and after the budget is saved.
 */
'use strict';
(function () {
  const BUDGET_STORAGE_KEY = 'eventflow_custom_budget';
  const BUDGET_HASH = '#budget-settings-form';
  const BULK_CHUNK = 50;

  const ids = {
    lede: 'cdh-lede',
    primary: 'cdh-next-action',
    secondary: 'cdh-secondary-action',
    summary: 'cdh-summary-grid',
    stepsBody: 'cdh-steps-body',
    stepsSub: 'cdh-steps-sub',
    panel: 'budget-settings-panel',
    form: 'budget-settings-form',
    input: 'custom-budget-input',
    cancel: 'budget-settings-cancel',
    status: 'budget-status',
    suggestions: 'recommendations-widget',
  };

  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function esc(value) {
    const div = document.createElement('div');
    div.textContent = String(value === null || value === undefined ? '' : value);
    return div.innerHTML;
  }

  function gbp(amount) {
    return `£${Math.round(Number(amount) || 0).toLocaleString('en-GB')}`;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many || `${one}s`}`;
  }

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /** A read-only JSON GET. Resolves to null on any failure so one bad call never blanks the page. */
  async function getJson(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      return response.ok ? await response.json() : null;
    } catch (_) {
      return null;
    }
  }

  /** Local midnight for a plan date string such as 2027-06-19 or 2027-06-19T00:00:00Z. */
  function parsePlanDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) {
      return null;
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysUntil(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function planName(plan) {
    return plan.name || plan.eventName || plan.eventType || 'your event';
  }

  function planDate(plan) {
    return parsePlanDate(plan.eventDate || plan.date);
  }

  /** The plan the summary talks about: next upcoming date, else latest dated, else the first plan. */
  function pickFocusPlan(plans) {
    const list = Array.isArray(plans) ? plans : [];
    if (!list.length) {
      return null;
    }
    const dated = list
      .map(plan => ({ plan, date: planDate(plan) }))
      .filter(item => item.date)
      .sort((a, b) => a.date - b.date);
    const upcoming = dated.find(item => daysUntil(item.date) >= 0);
    if (upcoming) {
      return upcoming.plan;
    }
    if (dated.length) {
      return dated[dated.length - 1].plan;
    }
    return list[0];
  }

  /* ------------------------------------------------------------------ *
   * Budget
   * ------------------------------------------------------------------ */

  /** "£3,500", "£45 pp", "From £500", "Contact for pricing" → number (0 when there is no price). */
  function parsePrice(priceStr) {
    if (!priceStr || typeof priceStr !== 'string') {
      return 0;
    }
    const cleaned = priceStr.replace(/from/gi, '').replace(/£/g, '').replace(/,/g, '').trim();
    const match = cleaned.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) || 0 : 0;
  }

  function isPerPerson(pkg) {
    return /\bpp\b|per person|per guest/i.test(String(pkg.price || pkg.price_display || ''));
  }

  function readStoredBudget() {
    try {
      const stored = parseFloat(localStorage.getItem(BUDGET_STORAGE_KEY));
      return stored > 0 ? stored : 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * What the focus plan has committed so far, from its chosen packages and any
   * budget line items. Per-person prices need a guest count; without one they
   * (and packages with no price) are reported as unpriced, never guessed.
   */
  async function calculateSpent(plan) {
    let spent = 0;
    let unpriced = 0;

    (Array.isArray(plan.budgetItems) ? plan.budgetItems : []).forEach(item => {
      spent += parseFloat(item.actual || item.estimated || 0) || 0;
    });

    const packageIds = [
      ...new Set((plan.packages || []).filter(id => typeof id === 'string' && id.trim())),
    ];
    if (!packageIds.length) {
      return { spent, unpriced };
    }

    const guests = parseInt(plan.guestCount || plan.guests || 0, 10) || 0;
    const chunks = [];
    for (let i = 0; i < packageIds.length; i += BULK_CHUNK) {
      chunks.push(packageIds.slice(i, i + BULK_CHUNK));
    }

    // One bulk request per 50 packages — never one request per package.
    const results = await Promise.all(
      chunks.map(async chunk => {
        try {
          const response = await fetch('/api/packages/bulk', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ ids: chunk }),
          });
          return response.ok ? (await response.json()).packages || [] : [];
        } catch (_) {
          return [];
        }
      })
    );

    results.flat().forEach(pkg => {
      const price = parsePrice(pkg.price || pkg.price_display || '');
      if (price <= 0) {
        unpriced += 1;
      } else if (isPerPerson(pkg)) {
        if (guests > 0) {
          spent += price * guests;
        } else {
          unpriced += 1;
        }
      } else {
        spent += price;
      }
    });
    return { spent, unpriced };
  }

  /**
   * The focus plan's own budget. The browser-stored figure only stands in when no plan
   * has a budget at all (a save that has not reached the server yet); otherwise it could
   * belong to a different plan.
   */
  function totalBudgetFor(plan, plans) {
    const fromPlan = plan ? parseFloat(plan.budget) : 0;
    if (fromPlan > 0) {
      return fromPlan;
    }
    const anyPlanBudget = (plans || []).some(p => parseFloat(p.budget) > 0);
    return anyPlanBudget ? 0 : readStoredBudget();
  }

  /* ------------------------------------------------------------------ *
   * Summary row
   * ------------------------------------------------------------------ */

  function bar(percent, label, tone) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    return `<div class="cdh-bar${tone ? ` cdh-bar--${tone}` : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div>`;
  }

  function tile(label, body, action) {
    return `<div class="cdh-tile"><div class="cdh-tile__label"><span>${esc(label)}</span>${action || ''}</div>${body}</div>`;
  }

  function countdownTile(plan) {
    const date = planDate(plan);
    if (!date) {
      return tile(
        'Countdown',
        `<p class="cdh-tile__value cdh-tile__value--empty">No date yet</p>
         <p class="cdh-tile__sub"><button type="button" class="cdh-link" data-edit-plan="${esc(plan.id)}">Add a date</button></p>`
      );
    }
    const days = daysUntil(date);
    let value;
    if (days > 0) {
      value = `${days.toLocaleString('en-GB')}<span class="cdh-tile__unit">${days === 1 ? ' day' : ' days'}</span>`;
    } else if (days === 0) {
      value = 'Today';
    } else {
      value = '<span class="cdh-tile__value--muted">Passed</span>';
    }
    return tile(
      'Countdown',
      `<p class="cdh-tile__value">${value}</p><p class="cdh-tile__sub">${esc(formatDate(date))}</p>`
    );
  }

  function budgetTile(total, money) {
    const edit = `<button type="button" class="cdh-link" data-edit-budget aria-expanded="false" aria-controls="${ids.panel}">${total > 0 ? 'Edit' : 'Set budget'}</button>`;
    if (total <= 0) {
      const committed =
        money.spent > 0
          ? `${gbp(money.spent)} chosen so far, with no budget to compare it to.`
          : 'Set a total to see what is left as you book.';
      return tile(
        'Budget',
        `<p class="cdh-tile__value cdh-tile__value--empty">Not set</p><p class="cdh-tile__sub">${esc(committed)}</p>`,
        edit
      );
    }
    const percent = (money.spent / total) * 100;
    const over = money.spent > total;
    const left = over
      ? `${gbp(money.spent - total)} over budget`
      : `${gbp(total - money.spent)} left`;
    const unpriced = money.unpriced ? ` · ${plural(money.unpriced, 'item')} not priced` : '';
    return tile(
      'Budget',
      `<p class="cdh-tile__value">${gbp(money.spent)}<span class="cdh-tile__unit"> of ${gbp(total)}</span></p>
       ${bar(percent, `Budget used: ${Math.round(percent)}%`, over ? 'warn' : '')}
       <p class="cdh-tile__sub${over ? ' cdh-tile__sub--warn' : ''}">${esc(left + unpriced)}</p>`,
      edit
    );
  }

  function progressTile(steps) {
    if (!steps) {
      return '';
    }
    const next = steps.milestones.find(m => !m.done);
    const sub = next
      ? `Next: <a class="cdh-link" href="${esc(next.href)}">${esc(next.label)}</a>`
      : 'Everything on the checklist is done.';
    return tile(
      'Planning progress',
      `<p class="cdh-tile__value">${steps.completed}<span class="cdh-tile__unit"> of ${steps.total} steps</span></p>
       ${bar((steps.completed / steps.total) * 100, `Planning ${Math.round((steps.completed / steps.total) * 100)}% complete`)}
       <p class="cdh-tile__sub">${sub}</p>`
    );
  }

  function guestsTile(plan, rsvp) {
    const link = text => `<a class="cdh-link" href="/guests">${text}</a>`;
    if (rsvp && rsvp.totalGuests > 0) {
      const replied = rsvp.responsesReceived || 0;
      return tile(
        'Guests',
        `<p class="cdh-tile__value">${replied}<span class="cdh-tile__unit"> of ${rsvp.totalGuests} replied</span></p>
         ${bar((replied / rsvp.totalGuests) * 100, `${replied} of ${rsvp.totalGuests} guests have replied`)}
         <p class="cdh-tile__sub">${plural(rsvp.attending || 0, 'attending', 'attending')} · ${link('Manage guests')}</p>`
      );
    }
    const expected = parseInt(plan.guestCount || plan.guests || 0, 10) || 0;
    if (expected > 0) {
      return tile(
        'Guests',
        `<p class="cdh-tile__value">${expected.toLocaleString('en-GB')}<span class="cdh-tile__unit"> expected</span></p>
         <p class="cdh-tile__sub">No guest list yet · ${link('Add guests')}</p>`
      );
    }
    return tile(
      'Guests',
      `<p class="cdh-tile__value cdh-tile__value--empty">None added</p><p class="cdh-tile__sub">${link('Add your guest list')}</p>`
    );
  }

  function renderSummary(plan, money, steps, rsvp) {
    const grid = $(ids.summary);
    if (!grid) {
      return;
    }
    grid.setAttribute('aria-busy', 'false');
    if (!plan) {
      grid.className = 'cdh-summary__grid cdh-summary__grid--empty';
      grid.innerHTML = `
        <p class="cdh-note">Create a plan and your countdown, budget and guest replies will appear here.</p>`;
      return;
    }
    grid.className = 'cdh-summary__grid';
    grid.innerHTML = [
      countdownTile(plan),
      budgetTile(money.total, money),
      progressTile(steps),
      guestsTile(plan, rsvp),
    ].join('');
  }

  /* ------------------------------------------------------------------ *
   * Greeting and next action
   * ------------------------------------------------------------------ */

  function ledeFor(plan) {
    if (!plan) {
      return 'Start with a plan and EventFlow will keep your budget, guests and suppliers together.';
    }
    const name = planName(plan);
    const date = planDate(plan);
    if (!date) {
      return `Add a date to ${name} to start your countdown.`;
    }
    const days = daysUntil(date);
    if (days > 0) {
      return `${plural(days, 'day')} until ${name}.`;
    }
    if (days === 0) {
      return `${name} is today.`;
    }
    return `${name} has passed. Start a new plan whenever you are ready.`;
  }

  function renderHero(plan, steps) {
    const lede = $(ids.lede);
    if (lede) {
      lede.textContent = ledeFor(plan);
    }
    const primary = $(ids.primary);
    const secondary = $(ids.secondary);
    if (!primary) {
      return;
    }
    const next = steps && steps.milestones.find(m => !m.done);
    if (!plan) {
      primary.textContent = 'Create your plan';
      primary.setAttribute('href', '/start');
    } else if (next) {
      primary.textContent = next.label;
      primary.setAttribute('href', next.href);
    } else {
      primary.textContent = 'Browse suppliers';
      primary.setAttribute('href', '/suppliers');
    }
    if (secondary) {
      secondary.hidden = primary.getAttribute('href') === secondary.getAttribute('href');
    }
  }

  /* ------------------------------------------------------------------ *
   * Next steps
   * ------------------------------------------------------------------ */

  const CHECK =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const CHEVRON =
    '<svg class="cdh-step__go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  function renderSteps(steps) {
    const body = $(ids.stepsBody);
    const sub = $(ids.stepsSub);
    if (!body) {
      return;
    }
    if (!steps) {
      if (sub) {
        sub.textContent = 'We could not load your checklist.';
      }
      body.innerHTML =
        '<p class="cdh-note">Something went wrong while loading your next steps.</p><button type="button" class="cdh-btn cdh-btn--secondary cdh-btn--sm" data-retry-steps>Try again</button>';
      return;
    }

    const todo = steps.milestones.filter(m => !m.done);
    const done = steps.milestones.filter(m => m.done);
    if (sub) {
      sub.textContent = todo.length
        ? `${steps.completed} of ${steps.total} done. Start with the first one.`
        : 'Everything on the checklist is done.';
    }

    const todoList = todo.length
      ? `<ul class="cdh-steps">${todo
          .map(
            m =>
              `<li><a class="cdh-step" href="${esc(m.href)}"><span class="cdh-step__mark" aria-hidden="true"></span><span class="cdh-step__label">${esc(m.label)}</span>${CHEVRON}</a></li>`
          )
          .join('')}</ul>`
      : '<p class="cdh-note">Nicely done. You can still change any of these from your plan.</p>';

    const doneList = done.length
      ? `<details class="cdh-done"><summary>${done.length} completed</summary><ul class="cdh-steps cdh-steps--done">${done
          .map(
            m =>
              `<li class="cdh-step cdh-step--done"><span class="cdh-step__mark" aria-hidden="true">${CHECK}</span><span class="cdh-step__label">${esc(m.label)}<span class="cdh-sr"> (done)</span></span></li>`
          )
          .join('')}</ul></details>`
      : '';

    body.innerHTML = `${bar((steps.completed / steps.total) * 100, `Planning ${Math.round((steps.completed / steps.total) * 100)}% complete`)}${todoList}${doneList}`;
  }

  /** Validates the milestone payload so a malformed response shows the error state, not a broken list. */
  function normaliseSteps(data) {
    if (!data || !Array.isArray(data.milestones) || !data.milestones.length) {
      return null;
    }
    const milestones = data.milestones
      .filter(m => m && m.label)
      .map(m => ({
        id: m.id,
        label: String(m.label),
        done: Boolean(m.done),
        href: typeof m.href === 'string' && /^(\/|#)/.test(m.href) ? m.href : '/start',
      }));
    const completed = milestones.filter(m => m.done).length;
    return { milestones, completed, total: milestones.length };
  }

  /* ------------------------------------------------------------------ *
   * Budget panel
   * ------------------------------------------------------------------ */

  function setBudgetPanel(open, options) {
    const panel = $(ids.panel);
    if (!panel) {
      return;
    }
    panel.hidden = !open;
    document.querySelectorAll('[data-edit-budget]').forEach(button => {
      button.setAttribute('aria-expanded', String(open));
    });
    if (open) {
      const input = $(ids.input);
      if (!options || options.scroll !== false) {
        panel.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
        });
      }
      if (input) {
        input.focus({ preventScroll: true });
      }
    }
  }

  function bindPageEvents() {
    document.addEventListener('click', event => {
      const budgetButton = event.target.closest && event.target.closest('[data-edit-budget]');
      if (budgetButton) {
        const panel = $(ids.panel);
        setBudgetPanel(Boolean(panel && panel.hidden));
        return;
      }
      const anchor = event.target.closest && event.target.closest(`a[href="${BUDGET_HASH}"]`);
      if (anchor) {
        event.preventDefault();
        setBudgetPanel(true);
        return;
      }
      const editPlan = event.target.closest && event.target.closest('[data-edit-plan]');
      if (editPlan) {
        document.dispatchEvent(
          new CustomEvent('cdh:edit-plan', { detail: { planId: editPlan.dataset.editPlan } })
        );
        return;
      }
      if (event.target.closest && event.target.closest('[data-retry-steps]')) {
        document.dispatchEvent(new CustomEvent('cdh:reload'));
      }
    });

    const cancel = $(ids.cancel);
    if (cancel) {
      cancel.addEventListener('click', () => {
        setBudgetPanel(false);
        const trigger = document.querySelector('[data-edit-budget]');
        if (trigger) {
          trigger.focus();
        }
      });
    }

    const panel = $(ids.panel);
    if (panel) {
      panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          cancel?.click();
        }
      });
    }

    if (window.location.hash === BUDGET_HASH) {
      setBudgetPanel(true);
    }
    window.addEventListener('hashchange', () => {
      if (window.location.hash === BUDGET_HASH) {
        setBudgetPanel(true);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Suggestions and entry point
   * ------------------------------------------------------------------ */

  function loadSuggestions(plan, total) {
    const widget = $(ids.suggestions);
    if (!widget || !window.RecommendationsWidget) {
      return;
    }
    if (plan) {
      if (plan.eventType) {
        widget.dataset.eventType = plan.eventType;
      }
      if (plan.location) {
        widget.dataset.location = plan.location;
      }
      if (total > 0) {
        widget.dataset.budget = String(total);
      }
    }
    window.RecommendationsWidget.init();
  }

  function celebrateCompletedProfile() {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('profile_completed') !== 'true' ||
      typeof triggerSuccessConfetti !== 'function'
    ) {
      return;
    }
    window.setTimeout(() => {
      try {
        triggerSuccessConfetti(); // eslint-disable-line no-undef
      } catch (_) {
        /* decorative only */
      }
      window.history.replaceState({}, '', window.location.pathname);
    }, 500);
  }

  /** The plans themselves could not be fetched — say so instead of showing an empty dashboard. */
  function renderLoadError() {
    const lede = $(ids.lede);
    if (lede) {
      lede.textContent = 'We could not load your plans just now.';
    }
    const grid = $(ids.summary);
    if (grid) {
      grid.setAttribute('aria-busy', 'false');
      grid.className = 'cdh-summary__grid cdh-summary__grid--empty';
      grid.innerHTML = `
        <div class="cdh-empty">
          <p class="cdh-empty__title">Your summary could not be loaded</p>
          <p class="cdh-empty__text">Check your connection and try again.</p>
          <button type="button" class="cdh-btn cdh-btn--secondary cdh-btn--sm" data-retry-steps>Try again</button>
        </div>`;
    }
    renderSteps(null);
  }

  let suggestionsRequested = false;

  /** Draws the greeting, summary row and next steps for the given plans. */
  async function render(plans) {
    if (!Array.isArray(plans)) {
      renderLoadError();
      return;
    }
    const list = plans;
    const plan = pickFocusPlan(list);

    const [stepsData, money, rsvpData] = await Promise.all([
      getJson('/api/v1/customer/milestones'),
      plan ? calculateSpent(plan) : Promise.resolve({ spent: 0, unpriced: 0 }),
      plan && plan.id
        ? getJson(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`)
        : Promise.resolve(null),
    ]);

    const steps = normaliseSteps(stepsData);
    const total = totalBudgetFor(plan, list);
    const summary = { ...money, total };

    renderHero(plan, steps);
    renderSummary(plan, summary, steps, rsvpData && rsvpData.summary);
    renderSteps(steps);

    if (!suggestionsRequested) {
      suggestionsRequested = true;
      loadSuggestions(plan, total);
    }
  }

  function init() {
    bindPageEvents();
    celebrateCompletedProfile();
  }

  window.CustomerDashboardHome = { render, pickFocusPlan, totalBudgetFor };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
