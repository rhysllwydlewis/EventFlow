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

  /** Shorthand for document.getElementById. */
  const byId = id => document.getElementById(id);

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  /** HTML-escapes any value (null and undefined become an empty string) for safe use in markup. */
  function esc(value) {
    const div = document.createElement('div');
    div.textContent = String(value === null || value === undefined ? '' : value);
    return div.innerHTML;
  }

  /** Formats a number as whole pounds, e.g. £3,500 (non-numbers become £0). */
  function gbp(amount) {
    return `£${Math.round(Number(amount) || 0).toLocaleString('en-GB')}`;
  }

  /** "1 day" / "2 days": the count followed by the singular or plural noun. */
  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many || `${one}s`}`;
  }

  /** True when the visitor has asked their system for reduced motion. */
  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  /** A read-only JSON GET. Resolves to null on any failure so one bad call never blanks the page. */
  async function getJson(url) {
    try {
      const response = await fetch(url, { credentials: 'include' });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** Local midnight for a plan date string such as 2027-06-19 or 2027-06-19T00:00:00Z. */
  function parsePlanDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(String(value || ''));
    if (!match) {
      return null;
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** Whole days from today (local midnight) to the given date; negative once it has passed. */
  function daysUntil(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  /** Long British date, e.g. Saturday 19 June 2027. */
  function formatDate(date) {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** The plan's display name, falling back to its event type and then a generic phrase. */
  function planName(plan) {
    return plan.name || plan.eventName || plan.eventType || 'your event';
  }

  /** The plan's event date as a local Date, or null when it has none. */
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
      .sort((left, right) => left.date - right.date);
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
    const cleaned = priceStr.replace(/from/gi, '').replace(/£/gu, '').replace(/,/gu, '').trim();
    const match = cleaned.match(/(\d+(?:\.\d+)?)/u);
    return match ? parseFloat(match[1]) || 0 : 0;
  }

  /** True when a package's price text is per head ("pp", "per person", "per guest"). */
  function isPerPerson(pkg) {
    return /\bpp\b|per person|per guest/i.test(String(pkg.price_display || pkg.price || ''));
  }

  /** The budget saved in this browser, or 0 when none is stored or storage is unavailable. */
  function readStoredBudget() {
    try {
      const stored = parseFloat(localStorage.getItem(BUDGET_STORAGE_KEY));
      return stored > 0 ? stored : 0;
    } catch {
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
    for (let start = 0; start < packageIds.length; start += BULK_CHUNK) {
      chunks.push(packageIds.slice(start, start + BULK_CHUNK));
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
        } catch {
          return [];
        }
      })
    );

    results.flat().forEach(pkg => {
      const price = parsePrice(pkg.price_display || pkg.price || '');
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
    const anyPlanBudget = (plans || []).some(candidate => parseFloat(candidate.budget) > 0);
    return anyPlanBudget ? 0 : readStoredBudget();
  }

  /* ------------------------------------------------------------------ *
   * Summary row
   * ------------------------------------------------------------------ */

  /** Markup for a thin progress bar, with the percentage clamped to 0-100. */
  function bar(percent, label, tone) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    return `<div class="cdh-bar${tone ? ` cdh-bar--${tone}` : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div>`;
  }

  /** Wraps a label, body markup and optional action markup in one summary tile. */
  function tile(label, body, action) {
    return `<div class="cdh-tile"><div class="cdh-tile__label"><span>${esc(label)}</span>${action || ''}</div>${body}</div>`;
  }

  /** Summary tile showing the days remaining until the plan's date. */
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
    let value = '';
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

  /** Summary tile for budget: spent against the total, or a prompt to set one. */
  function budgetTile(total, money, plan) {
    const budgetHref = plan?.id ? `/budget?plan=${encodeURIComponent(plan.id)}` : '/budget';
    /** Link to the full budget page, where items are added and edited. */
    const manage = `<a class="cdh-link" href="${budgetHref}">Open budget</a>`;
    const edit = `<button type="button" class="cdh-link" data-edit-budget aria-expanded="false" aria-controls="${ids.panel}">${total > 0 ? 'Edit' : 'Set budget'}</button>`;
    if (total <= 0) {
      const committed =
        money.spent > 0
          ? `${gbp(money.spent)} chosen so far, with no budget to compare it to.`
          : 'Set a total to see what is left as you book.';
      return tile(
        'Budget',
        `<p class="cdh-tile__value cdh-tile__value--empty">Not set</p><p class="cdh-tile__sub">${esc(committed)}</p><p class="cdh-tile__sub">${manage}</p>`,
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
       <p class="cdh-tile__sub${over ? ' cdh-tile__sub--warn' : ''}">${esc(left + unpriced)}</p>
       <p class="cdh-tile__sub">${manage}</p>`,
      edit
    );
  }

  /** Summary tile for checklist progress, linking to the next unfinished step. */
  function progressTile(steps) {
    if (!steps) {
      return '';
    }
    const next = steps.milestones.find(milestone => !milestone.done);
    const sub = next
      ? `Next: <a class="cdh-link" href="${esc(next.href)}"${stepAttrs(next)}>${esc(next.label)}</a>`
      : 'Everything on the checklist is done.';
    return tile(
      'Planning progress',
      `<p class="cdh-tile__value">${steps.completed}<span class="cdh-tile__unit"> of ${steps.total} steps</span></p>
       ${bar((steps.completed / steps.total) * 100, `Planning ${Math.round((steps.completed / steps.total) * 100)}% complete`)}
       <p class="cdh-tile__sub">${sub}</p>`
    );
  }

  /** Summary tile for guest replies, falling back to the expected guest count or an empty prompt. */
  function guestsTile(plan, rsvp) {
    // The summary describes this plan, so the guest list must open on it, not on the first plan.
    const guestsHref = plan?.id ? `/guests?plan=${encodeURIComponent(plan.id)}` : '/guests';
    /** An inline link to the guest list page with the given label markup. */
    const link = text => `<a class="cdh-link" href="${guestsHref}">${text}</a>`;
    if (rsvp?.totalGuests > 0) {
      const replied = rsvp.responsesReceived || 0;
      // People, not guest records: a reply can cover a whole party, and the guest list page
      // counts the same way.
      const people = rsvp.partySizeTotal || rsvp.attending || 0;
      const attending = `${plural(people, 'person', 'people')} attending`;
      return tile(
        'Guests',
        `<p class="cdh-tile__value">${replied}<span class="cdh-tile__unit"> of ${rsvp.totalGuests} replied</span></p>
         ${bar((replied / rsvp.totalGuests) * 100, `${replied} of ${rsvp.totalGuests} guests have replied`)}
         <p class="cdh-tile__sub">${attending} · ${link('Manage guests')}</p>`
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

  /** Fills the summary grid with the four tiles, or an empty-state note when there is no plan. */
  function renderSummary(plan, money, steps, rsvp) {
    const grid = byId(ids.summary);
    if (!grid) {
      return;
    }
    grid.setAttribute('aria-busy', 'false');
    if (!plan) {
      grid.className = 'cdh-summary__grid cdh-summary__grid--empty';
      grid.innerHTML =
        '<p class="cdh-note">Create a plan and your countdown, budget and guest replies will appear here.</p>';
      return;
    }
    grid.className = 'cdh-summary__grid';
    grid.innerHTML = [
      countdownTile(plan),
      budgetTile(money.total, money, plan),
      progressTile(steps),
      guestsTile(plan, rsvp),
    ].join('');
  }

  /* ------------------------------------------------------------------ *
   * Greeting and next action
   * ------------------------------------------------------------------ */

  /** The one-line greeting under the page heading for the focus plan. */
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

  /** Sets the greeting line and points the primary action at the most useful next step. */
  function renderHero(plan, steps) {
    const lede = byId(ids.lede);
    if (lede) {
      lede.textContent = ledeFor(plan);
    }
    const primary = byId(ids.primary);
    const secondary = byId(ids.secondary);
    if (!primary) {
      return;
    }
    const next = steps?.milestones.find(milestone => !milestone.done);
    primary.hidden = false;
    delete primary.dataset.editPlan;
    delete primary.dataset.editField;
    if (!plan) {
      primary.textContent = 'Create your plan';
      primary.setAttribute('href', '/start');
    } else if (next) {
      primary.textContent = next.label;
      primary.setAttribute('href', next.href);
      if (next.editField) {
        primary.dataset.editPlan = next.planId;
        primary.dataset.editField = next.editField;
      }
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

  /** Draws the Next steps checklist (to do first, finished ones folded away), or its error state. */
  function renderSteps(steps) {
    const body = byId(ids.stepsBody);
    const sub = byId(ids.stepsSub);
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

    const todo = steps.milestones.filter(milestone => !milestone.done);
    const done = steps.milestones.filter(milestone => milestone.done);
    if (sub) {
      sub.textContent = todo.length
        ? `${steps.completed} of ${steps.total} done. Start with the first one.`
        : 'Everything on the checklist is done.';
    }

    const todoList = todo.length
      ? `<ul class="cdh-steps">${todo
          .map(
            milestone =>
              `<li><a class="cdh-step" href="${esc(milestone.href)}"${stepAttrs(milestone)}><span class="cdh-step__mark" aria-hidden="true"></span><span class="cdh-step__label">${esc(milestone.label)}</span>${CHEVRON}</a></li>`
          )
          .join('')}</ul>`
      : '<p class="cdh-note">Nicely done. You can still change any of these from your plan.</p>';

    const doneList = done.length
      ? `<details class="cdh-done"><summary>${done.length} completed</summary><ul class="cdh-steps cdh-steps--done">${done
          .map(
            milestone =>
              `<li class="cdh-step cdh-step--done"><span class="cdh-step__mark" aria-hidden="true">${CHECK}</span><span class="cdh-step__label">${esc(milestone.label)}<span class="cdh-sr"> (done)</span></span></li>`
          )
          .join('')}</ul></details>`
      : '';

    body.innerHTML = `${bar((steps.completed / steps.total) * 100, `Planning ${Math.round((steps.completed / steps.total) * 100)}% complete`)}${todoList}${doneList}`;
  }

  /**
   * Checklist steps that fill in a field of a plan that already exists, and the plan editor field
   * each one opens on. The server points them at the plan wizard, which starts a new plan.
   */
  const PLAN_FIELD_STEPS = {
    'set-date': 'cdh-pf-date',
    'set-guests': 'cdh-pf-guests',
    'set-location': 'cdh-pf-location',
  };

  /** Attributes that make a step link open the plan editor instead of navigating. */
  function stepAttrs(milestone) {
    return milestone.editField
      ? ` data-edit-plan="${esc(milestone.planId)}" data-edit-field="${esc(milestone.editField)}"`
      : '';
  }

  /** Validates the milestone payload so a malformed response shows the error state, not a broken list. */
  function normaliseSteps(data, plan) {
    if (!data || !Array.isArray(data.milestones) || !data.milestones.length) {
      return null;
    }
    const milestones = data.milestones
      .filter(milestone => milestone?.label)
      .map(milestone => ({
        id: milestone.id,
        label: String(milestone.label),
        done: Boolean(milestone.done),
        planId: plan?.id || '',
        editField: plan?.id ? PLAN_FIELD_STEPS[milestone.id] || '' : '',
        href:
          typeof milestone.href === 'string' && /^(\/|#)/u.test(milestone.href)
            ? milestone.href
            : '/start',
      }))
      .map(milestone =>
        milestone.editField ? { ...milestone, href: '#cdh-plans-title' } : milestone
      );
    const completed = milestones.filter(milestone => milestone.done).length;
    return { milestones, completed, total: milestones.length };
  }

  /* ------------------------------------------------------------------ *
   * Budget panel
   * ------------------------------------------------------------------ */

  /** Shows or hides the budget form, syncing the toggles' aria-expanded and focusing the input. */
  function setBudgetPanel(open, options) {
    const panel = byId(ids.panel);
    if (!panel) {
      return;
    }
    panel.hidden = !open;
    document.querySelectorAll('[data-edit-budget]').forEach(button => {
      button.setAttribute('aria-expanded', String(open));
    });
    if (open) {
      const input = byId(ids.input);
      if (options?.scroll !== false) {
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

  /** Wires the page-level clicks, Escape key and #budget-settings-form hash for the budget panel and plan links. */
  function bindPageEvents() {
    document.addEventListener('click', event => {
      const budgetButton = event.target.closest?.('[data-edit-budget]');
      if (budgetButton) {
        const budgetPanel = byId(ids.panel);
        setBudgetPanel(Boolean(budgetPanel?.hidden));
        return;
      }
      const anchor = event.target.closest?.(`a[href="${BUDGET_HASH}"]`);
      if (anchor) {
        event.preventDefault();
        setBudgetPanel(true);
        return;
      }
      const editPlan = event.target.closest?.('[data-edit-plan]');
      if (editPlan) {
        event.preventDefault();
        document.dispatchEvent(
          new CustomEvent('cdh:edit-plan', {
            detail: { planId: editPlan.dataset.editPlan, field: editPlan.dataset.editField || '' },
          })
        );
        return;
      }
      if (event.target.closest?.('[data-retry-steps]')) {
        document.dispatchEvent(new CustomEvent('cdh:reload'));
      }
    });

    const cancel = byId(ids.cancel);
    if (cancel) {
      cancel.addEventListener('click', () => {
        setBudgetPanel(false);
        const trigger = document.querySelector('[data-edit-budget]');
        if (trigger) {
          trigger.focus();
        }
      });
    }

    const panel = byId(ids.panel);
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

  /**
   * The budget page's categories, and the supplier categories each one stands for. A plan with a
   * budget line in a category has started on it; one without has not.
   */
  const BUDGET_TO_SUPPLIER_CATEGORIES = {
    venue: ['Venues'],
    catering: ['Catering'],
    photography: ['Photography', 'Videography'],
    entertainment: ['Entertainment', 'Music/DJ'],
    decor: ['Decor', 'Florist'],
    transport: ['Transport'],
    attire: ['Bridalwear'],
  };

  /**
   * Supplier categories the plan has not covered yet, which is what the suggestions lean towards:
   * a plan with venue and catering lines is shown photographers and entertainment, not more
   * venues. Attire only counts for a wedding.
   */
  function neededSupplierCategories(plan) {
    const categories = (Array.isArray(plan?.budgetItems) ? plan.budgetItems : []).map(item =>
      String(item?.category || '')
        .trim()
        .toLowerCase()
    );
    // A line counts when its category contains the name, so "Venue hire" covers Venue and
    // "Photography & video" covers Photography.
    const hasLineFor = name => categories.some(category => category?.includes(name));
    // The same test the guest list uses for "is this a wedding".
    const isWedding =
      Boolean(plan?.weddingWebsite) ||
      /wedding/i.test(`${plan?.eventType || ''} ${plan?.name || plan?.eventName || ''}`);
    return Object.entries(BUDGET_TO_SUPPLIER_CATEGORIES)
      .filter(([budgetCategory, supplierCategories]) => {
        if (budgetCategory === 'attire' && !isWedding) {
          return false;
        }
        return !(
          hasLineFor(budgetCategory) ||
          supplierCategories.some(name => hasLineFor(name.toLowerCase()))
        );
      })
      .flatMap(([, supplierCategories]) => supplierCategories);
  }

  /** Tells the suggestions widget where the plan is and what it still lacks, then starts it. */
  function loadSuggestions(plan) {
    const widget = byId(ids.suggestions);
    if (!widget || !window.RecommendationsWidget) {
      return;
    }
    if (plan) {
      if (plan.location) {
        widget.dataset.location = plan.location;
      }
      const needed = neededSupplierCategories(plan);
      if (needed.length) {
        widget.dataset.needed = needed.join(',');
      }
    }
    window.RecommendationsWidget.init();
  }

  /** Fires the confetti once after a profile is completed (?profile_completed=true), then cleans the URL. */
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
      } catch {
        /* decorative only */
      }
      window.history.replaceState({}, '', window.location.pathname);
    }, 500);
  }

  /** The plans themselves could not be fetched — say so instead of showing an empty dashboard. */
  function renderLoadError() {
    const lede = byId(ids.lede);
    if (lede) {
      lede.textContent = 'We could not load your plans just now.';
    }
    // A failed request says nothing about whether a plan exists, so do not nudge towards a new one.
    const primary = byId(ids.primary);
    if (primary) {
      primary.hidden = true;
    }
    const grid = byId(ids.summary);
    if (grid) {
      grid.setAttribute('aria-busy', 'false');
      grid.className = 'cdh-summary__grid cdh-summary__grid--empty';
      grid.innerHTML =
        '<div class="cdh-empty"><p class="cdh-empty__title">Your summary could not be loaded</p><p class="cdh-empty__text">Check your connection and try again.</p><button type="button" class="cdh-btn cdh-btn--secondary cdh-btn--sm" data-retry-steps>Try again</button></div>';
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
      plan?.id
        ? getJson(`/api/me/plans/${encodeURIComponent(plan.id)}/rsvp-summary`)
        : Promise.resolve(null),
    ]);

    const steps = normaliseSteps(stepsData, plan);
    const total = totalBudgetFor(plan, list);
    const summary = { ...money, total };

    renderHero(plan, steps);
    renderSummary(plan, summary, steps, rsvpData?.summary);
    renderSteps(steps);

    if (!suggestionsRequested) {
      suggestionsRequested = true;
      loadSuggestions(plan);
    }
  }

  /** Binds the page events once the DOM is ready. */
  function init() {
    bindPageEvents();
    celebrateCompletedProfile();
  }

  window.CustomerDashboardHome = {
    render,
    pickFocusPlan,
    totalBudgetFor,
    neededSupplierCategories,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
