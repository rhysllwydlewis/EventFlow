/**
 * Start Wizard — EventFlow Planning Wizard
 * Multi-step planning wizard with template-driven journeys.
 *
 * Step order:
 *   WELCOME (-1) → EVENT_TYPE (0) → EVENT_BASICS (1) →
 *   PRIORITIES (2) → STYLE (3) → [category steps] → REVIEW → SUCCESS
 */

'use strict';
(function () {
  /* ─── Utilities ──────────────────────────────────────────────────────────── */

  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = String(unsafe);
    return div.innerHTML;
  }

  /* ─── Configuration ──────────────────────────────────────────────────────── */

  // All categories the wizard can surface. Shown based on selected priorities.
  const ALL_CATEGORIES = [
    { key: 'venues', name: 'Venue', priority: 'venue' },
    { key: 'catering', name: 'Catering', priority: 'catering' },
    { key: 'photography', name: 'Photography', priority: 'photography' },
    { key: 'flowers', name: 'Flowers & Décor', priority: 'flowers' },
    { key: 'entertainment', name: 'Entertainment', priority: 'entertainment' },
    { key: 'av', name: 'AV & Production', priority: 'av' },
  ];

  // Default categories shown when no priorities are selected
  const DEFAULT_CATEGORY_KEYS = ['venues', 'photography', 'catering', 'flowers'];

  // Planning priorities the user can select
  const PRIORITY_OPTIONS = [
    { key: 'venue', label: 'Venue' },
    { key: 'catering', label: 'Catering' },
    { key: 'photography', label: 'Photography & Video' },
    { key: 'flowers', label: 'Flowers & Décor' },
    { key: 'entertainment', label: 'Entertainment' },
    { key: 'av', label: 'AV & Production' },
    { key: 'transport', label: 'Transport' },
    { key: 'accommodation', label: 'Accommodation' },
    { key: 'guests', label: 'Guest Management' },
    { key: 'timeline', label: 'Timeline & Schedule' },
    { key: 'budget', label: 'Budget Tracking' },
  ];

  // Style/vibe chips
  const STYLE_OPTIONS = [
    { key: 'classic', label: 'Classic' },
    { key: 'modern', label: 'Modern' },
    { key: 'relaxed', label: 'Relaxed' },
    { key: 'luxury', label: 'Luxury' },
    { key: 'rustic', label: 'Rustic' },
    { key: 'family-friendly', label: 'Family-friendly' },
    { key: 'formal', label: 'Formal' },
    { key: 'festival', label: 'Festival-style' },
    { key: 'corporate', label: 'Corporate' },
    { key: 'budget-conscious', label: 'Budget-conscious' },
    { key: 'eco', label: 'Eco-conscious' },
    { key: 'colourful', label: 'Colourful' },
    { key: 'romantic', label: 'Romantic' },
    { key: 'intimate', label: 'Intimate' },
  ];

  // Planning stage options
  const PLANNING_STAGES = [
    { key: 'just-starting', label: 'Just starting out' },
    { key: 'venue-booked', label: 'Venue already booked' },
    { key: 'some-booked', label: 'Some suppliers booked' },
    { key: 'nearly-ready', label: 'Nearly there' },
  ];

  const WIZARD_DATA_EXPIRY_MS = 24 * 60 * 60 * 1000;

  // Fixed steps before categories
  const FIXED_STEPS_BEFORE_CATS = 4; // event-type, basics, priorities, style

  // Step indices
  const STEP = {
    WELCOME: -1,
    EVENT_TYPE: 0,
    EVENT_BASICS: 1,
    PRIORITIES: 2,
    STYLE: 3,
    // category steps start at FIXED_STEPS_BEFORE_CATS
  };

  function getActiveCategories() {
    const state = window.WizardState.getState();
    const chosen = state.priorities || [];
    if (chosen.length === 0) {
      return ALL_CATEGORIES.filter(c => DEFAULT_CATEGORY_KEYS.includes(c.key));
    }
    // Categories matching selected priorities (in priority order), max 6
    const matched = ALL_CATEGORIES.filter(c => chosen.includes(c.priority));
    return matched.length > 0
      ? matched.slice(0, 6)
      : ALL_CATEGORIES.filter(c => DEFAULT_CATEGORY_KEYS.includes(c.key));
  }

  function getTotalVisible() {
    return FIXED_STEPS_BEFORE_CATS + getActiveCategories().length + 1; // +1 for review
  }

  function getReviewStep() {
    return FIXED_STEPS_BEFORE_CATS + getActiveCategories().length;
  }
  function getSuccessStep() {
    return FIXED_STEPS_BEFORE_CATS + getActiveCategories().length + 1;
  }

  /* ─── State ──────────────────────────────────────────────────────────────── */

  let currentStep = STEP.WELCOME;
  let hasShownWelcome = false;
  let savedPlanId = null;
  let _beforeunloadHandler = null;
  let _wizardCompleted = false;
  let _mobileSummaryExpanded = false;
  const availablePackages = {};

  /* ─── Init ───────────────────────────────────────────────────────────────── */

  function init() {
    if (typeof window.WizardState === 'undefined') {
      console.error('WizardState not loaded');
      return;
    }

    restoreWizardState();

    const state = window.WizardState.getState();
    window.WizardState.setAutosaveCallback(handleAutosave);

    const timeSinceUpdate = window.WizardState.getTimeSinceLastUpdate();
    hasShownWelcome = timeSinceUpdate < WIZARD_DATA_EXPIRY_MS && !!state.wizardStartedAt;

    if (hasShownWelcome && state.currentStep >= 0) {
      currentStep = state.currentStep;
    } else {
      currentStep = STEP.WELCOME;
    }

    // URL param prefill
    const urlParams = new URLSearchParams(window.location.search);
    if ([...urlParams.keys()].length > 0) {
      const et = urlParams.get('eventType');
      if (et && ['Wedding', 'Corporate', 'Birthday', 'Other'].includes(et)) {
        window.WizardState.saveStep(STEP.EVENT_TYPE, { eventType: et });
      }
      const pre = {};
      if (urlParams.get('location')) {
        pre.location = urlParams.get('location');
      }
      const g = urlParams.get('guests');
      if (g && !isNaN(parseInt(g, 10))) {
        pre.guests = parseInt(g, 10);
      }
      if (urlParams.get('budget')) {
        pre.budget = urlParams.get('budget');
      }
      if (Object.keys(pre).length) {
        window.WizardState.saveStep(STEP.EVENT_BASICS, pre);
      }
    }

    renderStep(currentStep);
    renderPlanSummary();
    setupBeforeUnload();

    // Integrate template selector: if the container exists, render into it
    // but keep it hidden — the wizard welcome screen is the primary entry point
    const tplContainer = document.getElementById('template-selector-container');
    if (tplContainer) {
      tplContainer.style.display = 'none';
    }
  }

  /* ─── Step rendering ─────────────────────────────────────────────────────── */

  function renderStep(stepIndex) {
    const container = document.getElementById('wizard-container');
    if (!container) {
      return;
    }

    // Remove pre-hydration fallback on first real render
    const preload = document.getElementById('wizard-preload');
    if (preload) {
      preload.remove();
    }

    let html = '';

    if (stepIndex === STEP.WELCOME) {
      html = renderWelcomeScreen();
    } else if (stepIndex === getSuccessStep()) {
      html = renderSuccessScreen();
    } else {
      html = renderProgressIndicator(stepIndex) + renderStepContent(stepIndex);
    }

    container.innerHTML = html;

    const liveRegion = document.getElementById('wizard-live-region');
    if (liveRegion && stepIndex >= 0 && stepIndex <= getReviewStep()) {
      const cats = getActiveCategories();
      const titles = [
        'Event type',
        'The basics',
        'Planning priorities',
        'Style & vibe',
        ...cats.map(c => c.name),
        'Review your plan',
      ];
      const title = titles[stepIndex] || '';
      if (title) {
        liveRegion.textContent = `Step ${stepIndex + 1} of ${getTotalVisible()}: ${title}`;
      }
    }

    attachStepListeners(stepIndex);
  }

  function renderStepContent(stepIndex) {
    if (stepIndex === STEP.EVENT_TYPE) {
      return renderEventTypeStep();
    }
    if (stepIndex === STEP.EVENT_BASICS) {
      return renderEventBasicsStep();
    }
    if (stepIndex === STEP.PRIORITIES) {
      return renderPrioritiesStep();
    }
    if (stepIndex === STEP.STYLE) {
      return renderStyleStep();
    }
    if (stepIndex === getReviewStep()) {
      return renderReviewStep();
    }
    // Category step
    const catIndex = stepIndex - FIXED_STEPS_BEFORE_CATS;
    const cats = getActiveCategories();
    if (catIndex >= 0 && catIndex < cats.length) {
      return renderCategoryStep(cats[catIndex]);
    }
    return '';
  }

  /* ─── Welcome screen ─────────────────────────────────────────────────────── */

  function renderWelcomeScreen() {
    const templates = window.EventTemplates ? window.EventTemplates.getAll() : [];

    const tplCards = templates
      .map(
        t => `
      <button class="wz-tpl-card" data-template-id="${escapeHtml(t.id)}"
              type="button" aria-label="Use ${escapeHtml(t.name)} template">
        <span class="wz-tpl-emoji" aria-hidden="true">${t.emoji}</span>
        <div class="wz-tpl-info">
          <strong class="wz-tpl-name">${escapeHtml(t.name)}</strong>
          <span class="wz-tpl-tagline">${escapeHtml(t.tagline)}</span>
          <div class="wz-tpl-meta">
            <span class="wz-tpl-badge">${escapeHtml(t.budgetLabel)}</span>
            <span class="wz-tpl-badge">${escapeHtml(t.guestLabel)}</span>
          </div>
        </div>
        <svg class="wz-tpl-arrow" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" width="20" height="20">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
      </button>`
      )
      .join('');

    const savedState = window.WizardState.getState();
    const hasProgress = !!(
      savedState.eventType ||
      savedState.eventName ||
      savedState.priorities?.length
    );
    const resumeBanner = hasProgress
      ? `
      <div class="wz-resume-banner" role="alert">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clip-rule="evenodd"/></svg>
        <span>You have a plan in progress. <button class="wz-resume-link" type="button" id="resume-plan-btn">Continue where you left off</button></span>
      </div>`
      : '';

    return `
      <div class="wizard-card wizard-welcome">
        <div class="wz-welcome-hero">
          <h1 class="wz-welcome-title">Plan your event<br>in minutes</h1>
          <p class="wz-welcome-sub">Tell us about your event and we'll help you find the right suppliers, build a checklist, and keep everything in one place.</p>
          <div class="wz-welcome-value">
            <div class="wz-value-item">
              <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Get a clear planning checklist
            </div>
            <div class="wz-value-item">
              <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Find suppliers matched to your event
            </div>
            <div class="wz-value-item">
              <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Takes about 5 minutes — skip anything you're unsure about
            </div>
          </div>
        </div>
        ${resumeBanner}
        <div class="wz-welcome-templates">
          <h2 class="wz-section-label">Choose a starting point</h2>
          <div class="wz-tpl-grid" role="list">${tplCards}</div>
          <div class="wz-welcome-scratch">
            <button class="wz-scratch-btn" type="button" id="start-scratch-btn">
              Start from scratch
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /* ─── Progress indicator ─────────────────────────────────────────────────── */

  function renderProgressIndicator(stepIndex) {
    const total = getTotalVisible();
    const pct = Math.round(((stepIndex + 1) / total) * 100);
    const cats = getActiveCategories();
    const stepTitles = [
      'Event type',
      'The basics',
      'Priorities',
      'Style & vibe',
      ...cats.map(c => c.name),
      'Review',
    ];
    const title = stepTitles[stepIndex] || '';

    return `
      <div class="wizard-progress-container" role="group" aria-label="Wizard progress">
        <div class="wizard-progress-info">
          <span class="wizard-progress-percentage">${pct}% complete</span>
          <span class="wizard-step-indicator" aria-current="step">Step ${stepIndex + 1} of ${total}</span>
        </div>
        <div class="wizard-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% complete">
          <div class="wizard-progress-bar" style="width:${pct}%"></div>
        </div>
        ${title ? `<div class="wizard-step-title">${escapeHtml(title)}</div>` : ''}
      </div>
    `;
  }

  /* ─── Step: Event Type ───────────────────────────────────────────────────── */

  function renderEventTypeStep() {
    const state = window.WizardState.getState();
    const types = [
      { value: 'Wedding', label: 'Wedding', imgId: 'et-img-wedding', alt: 'Wedding' },
      {
        value: 'Corporate',
        label: 'Corporate Event',
        imgId: 'et-img-corporate',
        alt: 'Corporate event',
      },
      {
        value: 'Birthday',
        label: 'Birthday Party',
        imgId: 'et-img-birthday',
        alt: 'Birthday party',
      },
      { value: 'Other', label: 'Other Event', imgId: 'et-img-other', alt: 'Other event' },
    ];

    const opts = types
      .map(
        t => `
      <button class="wizard-option${state.eventType === t.value ? ' selected' : ''}"
              data-value="${escapeHtml(t.value)}" type="button"
              aria-pressed="${state.eventType === t.value ? 'true' : 'false'}">
        <div class="wizard-option-image-container">
          <img class="wizard-option-image" id="${t.imgId}" alt="${escapeHtml(t.alt)}">
        </div>
        <span class="wizard-option-label">${escapeHtml(t.label)}</span>
      </button>`
      )
      .join('');

    return `
      <div class="wizard-card">
        <h2>What type of event are you planning?</h2>
        <p class="small">This shapes your whole journey — we'll tailor supplier suggestions and priorities to match.</p>
        <div class="wizard-options" role="group" aria-label="Event type">${opts}</div>
        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button" ${!state.eventType ? 'disabled aria-disabled="true"' : ''}>Continue</button>
        </div>
      </div>
    `;
  }

  function loadEventTypeImages() {
    const imgs = {
      'et-img-wedding': {
        src: 'https://images.pexels.com/photos/265885/pexels-photo-265885.jpeg?auto=compress&cs=tinysrgb&w=600',
        alt: 'Wedding couple',
      },
      'et-img-corporate': {
        src: 'https://images.pexels.com/photos/1181396/pexels-photo-1181396.jpeg?auto=compress&cs=tinysrgb&w=600',
        alt: 'Corporate event',
      },
      'et-img-birthday': {
        src: 'https://images.pexels.com/photos/1543762/pexels-photo-1543762.jpeg?auto=compress&cs=tinysrgb&w=600',
        alt: 'Birthday party',
      },
      'et-img-other': {
        src: 'https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=600',
        alt: 'Event gathering',
      },
    };
    Object.entries(imgs).forEach(([id, { src, alt }]) => {
      const el = document.getElementById(id);
      if (el) {
        el.src = src;
        el.alt = alt;
      }
    });
  }

  /* ─── Step: Event Basics ─────────────────────────────────────────────────── */

  function renderEventBasicsStep() {
    const state = window.WizardState.getState();

    const stageOpts = PLANNING_STAGES.map(
      s =>
        `<option value="${escapeHtml(s.key)}" ${state.planningStage === s.key ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
    ).join('');

    const budgetOpts = [
      '',
      'Up to £1,000',
      '£1,000–£3,000',
      '£3,000–£5,000',
      '£5,000–£10,000',
      '£10,000–£20,000',
      '£20,000+',
    ]
      .map(
        v =>
          `<option value="${escapeHtml(v)}" ${state.budget === v ? 'selected' : ''}>${v ? escapeHtml(v) : 'Not sure yet'}</option>`
      )
      .join('');

    return `
      <div class="wizard-card">
        <h2>Let's start with the basics</h2>
        <p class="small">Rough answers are fine — you can update everything later. Only the fields that help you get better results are here.</p>

        <div class="form-row">
          <label for="wz-name">What's your event called? <span class="wz-optional">optional</span></label>
          <input type="text" id="wz-name" placeholder="e.g. Sarah &amp; John's Wedding"
                 value="${escapeHtml(state.eventName || '')}" autocomplete="off" aria-describedby="wz-name-hint">
          <span class="helper-text" id="wz-name-hint">Give your event a name so you can find it easily</span>
        </div>

        <div class="form-row">
          <label for="wz-date">When is it? <span class="wz-optional">optional</span></label>
          <input type="date" id="wz-date" value="${escapeHtml(state.date || '')}" aria-describedby="wz-date-hint">
          <span class="helper-text" id="wz-date-hint">Helps us check supplier availability</span>
        </div>

        <div class="form-row">
          <label for="wz-location">Where will it take place? <span class="wz-optional">optional</span></label>
          <input type="text" id="wz-location" placeholder="Town, city or postcode"
                 value="${escapeHtml(state.location || '')}" autocomplete="off" aria-describedby="wz-location-hint">
          <span class="helper-text" id="wz-location-hint">Helps us find local suppliers near you</span>
        </div>

        <div class="form-row-pair">
          <div class="form-row">
            <label for="wz-guests">Guest count <span class="wz-optional">approximate</span></label>
            <input type="number" id="wz-guests" min="1" max="10000" placeholder="e.g. 80"
                   value="${escapeHtml(state.guests || '')}" aria-describedby="wz-guests-hint">
            <span class="helper-text" id="wz-guests-hint">Rough numbers are fine</span>
          </div>
          <div class="form-row">
            <label for="wz-budget">Budget range <span class="wz-optional">optional</span></label>
            <select id="wz-budget" aria-describedby="wz-budget-hint">${budgetOpts}</select>
            <span class="helper-text" id="wz-budget-hint">Helps us filter to your range</span>
          </div>
        </div>

        <div class="form-row">
          <label for="wz-stage">Where are you in your planning?</label>
          <select id="wz-stage" aria-describedby="wz-stage-hint">
            <option value="">Choose one…</option>
            ${stageOpts}
          </select>
          <span class="helper-text" id="wz-stage-hint">Helps us focus on what you actually need next</span>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /* ─── Step: Priorities ───────────────────────────────────────────────────── */

  function renderPrioritiesStep() {
    const state = window.WizardState.getState();
    const selected = state.priorities || [];

    const chips = PRIORITY_OPTIONS.map(p => {
      const isSel = selected.includes(p.key);
      return `
        <button class="wz-chip${isSel ? ' wz-chip--selected' : ''}"
                data-priority-key="${escapeHtml(p.key)}" type="button"
                aria-pressed="${isSel ? 'true' : 'false'}">
          ${escapeHtml(p.label)}
        </button>`;
    }).join('');

    return `
      <div class="wizard-card">
        <h2>What do you need help with?</h2>
        <p class="small">Select everything that applies — we'll show you the most relevant suppliers. You can change this any time.</p>
        <div class="wz-chip-group" role="group" aria-label="Planning priorities">
          ${chips}
        </div>
        <p class="wz-chip-hint">
          ${
            selected.length > 0
              ? `<strong>${selected.length} area${selected.length !== 1 ? 's' : ''} selected</strong> — we'll tailor your next steps`
              : 'Select at least one area, or continue to use our defaults'
          }
        </p>
        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /* ─── Step: Style & Vibe ─────────────────────────────────────────────────── */

  function renderStyleStep() {
    const state = window.WizardState.getState();
    const selected = state.styles || [];

    const chips = STYLE_OPTIONS.map(s => {
      const isSel = selected.includes(s.key);
      return `
        <button class="wz-chip wz-chip--style${isSel ? ' wz-chip--selected' : ''}"
                data-style-key="${escapeHtml(s.key)}" type="button"
                aria-pressed="${isSel ? 'true' : 'false'}">
          ${escapeHtml(s.label)}
        </button>`;
    }).join('');

    return `
      <div class="wizard-card">
        <h2>What's the vibe?</h2>
        <p class="small">Choose words that describe the feel you're going for. We'll use these when suggesting suppliers and in your plan summary. Pick as many as you like.</p>
        <div class="wz-chip-group" role="group" aria-label="Style and vibe options">
          ${chips}
        </div>
        ${
          selected.length > 0
            ? `<p class="wz-chip-hint"><strong>${selected.map(k => STYLE_OPTIONS.find(s => s.key === k)?.label || k).join(', ')}</strong></p>`
            : '<p class="wz-chip-hint" aria-live="polite">Nothing selected yet — perfectly fine to skip</p>'
        }
        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /* ─── Step: Category (suppliers/packages) ────────────────────────────────── */

  function renderCategoryStep(category) {
    const state = window.WizardState.getState();
    const alreadyHave = (state.alreadyHave || {})[category.key];

    const proximityNote =
      category.key === 'venues' && state.location
        ? `<div class="wizard-proximity-info"><p class="small">Showing venues near <strong>${escapeHtml(state.location)}</strong></p></div>`
        : '';

    return `
      <div class="wizard-card">
        <h2>${escapeHtml(category.name)}</h2>
        <p class="small">Browse options for ${escapeHtml(category.name.toLowerCase())}. You can shortlist one now or come back later.</p>
        ${
          alreadyHave
            ? `<div class="wz-already-have-notice"><p>✓ You've indicated you already have this covered.</p> <button class="wz-undo-already-have" data-category="${escapeHtml(category.key)}" type="button">Undo</button></div>`
            : `
        <button class="wz-already-have-btn" data-category="${escapeHtml(category.key)}" type="button">
          I already have ${escapeHtml(category.name.toLowerCase())} covered — skip
        </button>`
        }
        ${proximityNote}
        <div id="wizard-packages-${escapeHtml(category.key)}" class="wizard-packages" aria-live="polite" aria-busy="true">
          <div class="wizard-package-grid">
            ${[1, 2, 3].map(() => '<div class="wizard-skeleton-card"></div>').join('')}
          </div>
        </div>
        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-next" type="button">Continue</button>
          <button class="wizard-skip" type="button">Skip for now</button>
        </div>
      </div>
    `;
  }

  /* ─── Step: Review ───────────────────────────────────────────────────────── */

  function renderReviewStep() {
    const state = window.WizardState.getState();
    const cats = getActiveCategories();
    const selectedPkgs = Object.keys(state.selectedPackages || {});
    const alreadyHave = Object.keys(state.alreadyHave || {});

    // Readiness score — 0-100 based on filled fields
    const fields = [
      state.eventType,
      state.eventName,
      state.location,
      state.date,
      state.guests,
      state.budget,
      state.planningStage,
      (state.priorities || []).length > 0 ? 'yes' : null,
      (state.styles || []).length > 0 ? 'yes' : null,
    ];
    const filled = fields.filter(Boolean).length;
    const readiness = Math.round((filled / fields.length) * 100);
    const readinessLabel =
      readiness >= 80 ? 'Great shape' : readiness >= 50 ? 'Good start' : 'Getting started';
    const readinessClass =
      readiness >= 80
        ? 'wz-readiness--high'
        : readiness >= 50
          ? 'wz-readiness--mid'
          : 'wz-readiness--low';

    const formatDate = d => {
      if (!d) {
        return null;
      }
      const dt = new Date(d);
      return isNaN(dt)
        ? null
        : dt.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/London',
          });
    };

    const styleLabels = (state.styles || [])
      .map(k => STYLE_OPTIONS.find(s => s.key === k)?.label || k)
      .join(', ');

    const catEditLinks = cats
      .map((cat, i) => {
        const catStep = FIXED_STEPS_BEFORE_CATS + i;
        return `<a href="#" class="wizard-review-edit" data-step="${catStep}">Edit ${escapeHtml(cat.name)}</a>`;
      })
      .join('');

    const missingItems = [];
    if (!state.eventName) {
      missingItems.push('Event name');
    }
    if (!state.date) {
      missingItems.push('Event date');
    }
    if (!state.location) {
      missingItems.push('Location');
    }
    if (!state.budget) {
      missingItems.push('Budget');
    }
    if (selectedPkgs.length === 0 && alreadyHave.length === 0) {
      missingItems.push('Supplier selections');
    }

    return `
      <div class="wizard-card">
        <h2>Review your plan</h2>
        <p class="small">Everything looks good — let's save this and get you planning.</p>

        <div class="wz-readiness ${readinessClass}" role="meter" aria-valuenow="${readiness}" aria-valuemin="0" aria-valuemax="100" aria-label="Plan readiness ${readiness}%">
          <div class="wz-readiness-bar"><div class="wz-readiness-fill" style="width:${readiness}%"></div></div>
          <div class="wz-readiness-label"><span>${readinessLabel}</span><span>${readiness}% complete</span></div>
        </div>

        <div class="wizard-review">
          <div class="wizard-review-section">
            <h3>Event details</h3>
            <p><strong>Type:</strong> ${escapeHtml(state.eventType || 'Not specified')}</p>
            ${state.eventName ? `<p><strong>Name:</strong> ${escapeHtml(state.eventName)}</p>` : ''}
            ${state.location ? `<p><strong>Location:</strong> ${escapeHtml(state.location)}</p>` : ''}
            ${state.date ? `<p><strong>Date:</strong> ${escapeHtml(formatDate(state.date))}</p>` : ''}
            ${state.guests ? `<p><strong>Guests:</strong> ${escapeHtml(state.guests)}</p>` : ''}
            ${state.budget ? `<p><strong>Budget:</strong> ${escapeHtml(state.budget)}</p>` : ''}
            ${state.planningStage ? `<p><strong>Planning stage:</strong> ${escapeHtml(PLANNING_STAGES.find(s => s.key === state.planningStage)?.label || state.planningStage)}</p>` : ''}
            <a href="#" class="wizard-review-edit" data-step="${STEP.EVENT_TYPE}">Edit event type</a>
            <a href="#" class="wizard-review-edit" data-step="${STEP.EVENT_BASICS}">Edit details</a>
          </div>

          ${
            (state.priorities || []).length > 0
              ? `
          <div class="wizard-review-section">
            <h3>Planning priorities</h3>
            <p>${escapeHtml(state.priorities.map(k => PRIORITY_OPTIONS.find(p => p.key === k)?.label || k).join(', '))}</p>
            <a href="#" class="wizard-review-edit" data-step="${STEP.PRIORITIES}">Edit priorities</a>
          </div>`
              : ''
          }

          ${
            styleLabels
              ? `
          <div class="wizard-review-section">
            <h3>Style & vibe</h3>
            <p>${escapeHtml(styleLabels)}</p>
            <a href="#" class="wizard-review-edit" data-step="${STEP.STYLE}">Edit style</a>
          </div>`
              : ''
          }

          <div class="wizard-review-section">
            <h3>Supplier selections</h3>
            ${
              selectedPkgs.length > 0
                ? `<p>You've shortlisted <strong>${selectedPkgs.length} supplier${selectedPkgs.length !== 1 ? 's' : ''}</strong>.</p>${catEditLinks}`
                : alreadyHave.length > 0
                  ? `<p>${alreadyHave.length} area${alreadyHave.length !== 1 ? 's' : ''} already covered. ${catEditLinks}</p>`
                  : `<p class="small">No suppliers shortlisted yet — you can browse after saving. ${catEditLinks}</p>`
            }
          </div>

          ${
            missingItems.length > 0
              ? `
          <div class="wizard-review-section wz-review-missing">
            <h3>Still to add</h3>
            <ul class="wz-missing-list">${missingItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            <p class="small">You can fill these in later — your plan saves everything you've entered so far.</p>
          </div>`
              : ''
          }
        </div>

        <div class="wz-save-notice" role="note">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
          <span>Progress is saved on this device. <strong>Log in to save permanently</strong> to your EventFlow account.</span>
        </div>

        <div class="wizard-actions">
          <button class="cta secondary wizard-back" type="button">Back</button>
          <button class="cta wizard-create-plan" type="button">Save my plan</button>
        </div>
      </div>
    `;
  }

  /* ─── Step: Success ──────────────────────────────────────────────────────── */

  function renderSuccessScreen() {
    const state = window.WizardState.getState();
    const eventLabel = escapeHtml(state.eventName || state.eventType || 'your event');

    return `
      <div class="wizard-card wizard-success">
        <div class="wz-success-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <h2>Plan saved!</h2>
        <p class="wizard-success-message">Your plan for ${eventLabel} has been created. Here's what to do next.</p>
        <div class="wz-next-steps">
          <a class="wz-next-step-btn ef-cta" href="/suppliers">Browse suppliers</a>
          <a class="wz-next-step-btn wz-next-step-btn--secondary" href="${savedPlanId ? `/dashboard/customer/plans/${savedPlanId}` : '/dashboard/customer'}">View my plan</a>
          <button class="wz-next-step-btn wz-next-step-btn--ghost" type="button" id="start-new-plan-btn">Start a new plan</button>
        </div>
      </div>
    `;
  }

  /* ─── Plan summary ───────────────────────────────────────────────────────── */

  function renderPlanSummary() {
    const container = document.getElementById('plan-summary');
    if (container) {
      renderDesktopSummary(container);
    }
    renderMobileSummary();
  }

  function renderDesktopSummary(container) {
    const state = window.WizardState.getState();
    const cats = getActiveCategories();
    const selectedPkgs = Object.keys(state.selectedPackages || {}).length;
    const alreadyHave = Object.keys(state.alreadyHave || {}).length;
    const serviced = selectedPkgs + alreadyHave;

    // Completion score
    const fields = [
      state.eventType,
      state.eventName,
      state.location,
      state.date,
      state.guests,
      state.budget,
      state.planningStage,
      (state.priorities || []).length ? 'y' : null,
      (state.styles || []).length ? 'y' : null,
    ];
    const score = Math.round((fields.filter(Boolean).length / fields.length) * 100);
    const scoreClass =
      score >= 80 ? 'wz-score--high' : score >= 50 ? 'wz-score--mid' : 'wz-score--low';

    let rows = '';
    if (state.eventType) {
      rows += sumRow('Type', state.eventType);
    }
    if (state.eventName) {
      rows += sumRow('Name', state.eventName);
    }
    if (state.location) {
      rows += sumRow('Location', state.location);
    }
    if (state.date) {
      rows += sumRow('Date', fmtDate(state.date));
    }
    if (state.guests) {
      rows += sumRow('Guests', state.guests);
    }
    if (state.budget) {
      rows += sumRow('Budget', state.budget);
    }
    if ((state.styles || []).length) {
      const labels = state.styles
        .map(k => STYLE_OPTIONS.find(s => s.key === k)?.label || k)
        .join(', ');
      rows += sumRow('Vibe', labels);
    }
    rows += sumRow('Suppliers', `${serviced} of ${cats.length} covered`);

    container.innerHTML = `
      <h3>Your plan</h3>
      <div class="wz-score ${scoreClass}">
        <div class="wz-score-bar"><div class="wz-score-fill" style="width:${score}%"></div></div>
        <span class="wz-score-label">${score}% complete</span>
      </div>
      ${rows || '<p class="small wz-summary-empty">Your selections will appear here as you go.</p>'}
    `;
  }

  function sumRow(label, value) {
    return `<div class="plan-summary-item">
      <span class="small">${escapeHtml(label)}</span>
      <span>${escapeHtml(String(value))}</span>
    </div>`;
  }

  function fmtDate(d) {
    if (!d) {
      return '';
    }
    const dt = new Date(d);
    return isNaN(dt)
      ? ''
      : dt.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Europe/London',
        });
  }

  function renderMobileSummary() {
    const el = document.getElementById('mobile-plan-summary');
    if (!el) {
      return;
    }
    const state = window.WizardState.getState();
    const selectedPkgs = Object.keys(state.selectedPackages || {}).length;
    const parts = [];
    if (state.eventType) {
      parts.push(state.eventType);
    }
    if (state.location) {
      parts.push(state.location);
    }
    if (selectedPkgs) {
      parts.push(`${selectedPkgs} supplier${selectedPkgs !== 1 ? 's' : ''}`);
    }
    const compact = parts.length ? parts.join(' · ') : 'Your plan';

    const wasExpanded = _mobileSummaryExpanded;
    let detailHtml = '';
    if (state.eventType) {
      detailHtml += sumRow('Type', state.eventType);
    }
    if (state.eventName) {
      detailHtml += sumRow('Name', state.eventName);
    }
    if (state.date) {
      detailHtml += sumRow('Date', fmtDate(state.date));
    }
    if (state.location) {
      detailHtml += sumRow('Location', state.location);
    }
    if (state.guests) {
      detailHtml += sumRow('Guests', state.guests);
    }
    if (state.budget) {
      detailHtml += sumRow('Budget', state.budget);
    }
    detailHtml += sumRow('Suppliers', `${selectedPkgs} selected`);

    el.innerHTML = `
      <button class="ef-cta wizard-mobile-summary-bar" type="button"
              aria-expanded="${wasExpanded}" aria-controls="mobile-summary-details">
        <span class="wizard-mobile-summary-compact">${escapeHtml(compact)}</span>
        <svg class="wizard-mobile-summary-chevron${wasExpanded ? ' is-open' : ''}" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
      <div class="wizard-mobile-summary-details" id="mobile-summary-details" ${wasExpanded ? '' : 'hidden'}>${detailHtml}</div>
    `;

    const btn = el.querySelector('.wizard-mobile-summary-bar');
    if (btn) {
      btn.addEventListener('click', () => {
        _mobileSummaryExpanded = !_mobileSummaryExpanded;
        btn.setAttribute('aria-expanded', String(_mobileSummaryExpanded));
        btn
          .querySelector('.wizard-mobile-summary-chevron')
          ?.classList.toggle('is-open', _mobileSummaryExpanded);
        const d = document.getElementById('mobile-summary-details');
        if (d) {
          if (_mobileSummaryExpanded) {
            d.removeAttribute('hidden');
          } else {
            d.setAttribute('hidden', '');
          }
        }
      });
    }
  }

  /* ─── Package loading ────────────────────────────────────────────────────── */

  async function loadPackagesForCategory(categoryKey, eventType) {
    try {
      if (categoryKey === 'venues') {
        const state = window.WizardState.getState();
        if (state.location) {
          const params = new URLSearchParams({ location: state.location, radiusMiles: '10' });
          const r = await fetch(`/api/v1/venues/near?${params}`);
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
          const data = await r.json();
          const venues = (data.venues || []).map(v => ({
            id: v.id,
            title: v.name,
            supplierId: v.id,
            supplierName: v.name,
            description: v.description_short || '',
            price: v.price_display || 'POA',
            image: v.photos?.[0] || null,
            category: v.category,
            distance: v.distance,
            _isVenue: true,
          }));
          availablePackages[categoryKey] = venues;
          return venues;
        }
      }
      const params = new URLSearchParams({
        category: categoryKey,
        eventType: eventType || 'Other',
        approved: 'true',
      });
      const r = await fetch(`/api/v1/packages/search?${params}`);
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const data = await r.json();
      availablePackages[categoryKey] = data.items || [];
      return data.items || [];
    } catch (err) {
      console.error('Error loading packages:', err);
      return null;
    }
  }

  function renderPackageList(categoryKey, packages) {
    const container = document.getElementById(`wizard-packages-${categoryKey}`);
    if (!container) {
      return;
    }
    container.setAttribute('aria-busy', 'false');

    if (!packages || packages.length === 0) {
      container.innerHTML = `
        <div class="wz-empty-state">
          <p class="small">No packages found for this category yet.</p>
          <p class="small"><a href="/suppliers?category=${encodeURIComponent(categoryKey)}">Browse all ${escapeHtml(categoryKey)} suppliers →</a></p>
        </div>`;
      return;
    }

    const state = window.WizardState.getState();
    const selectedId = (state.selectedPackages || {})[categoryKey];

    let html = '<div class="wizard-package-grid" role="listbox" aria-label="Available packages">';
    packages.slice(0, 6).forEach(pkg => {
      const isSel = String(pkg.id) === String(selectedId);
      const dist =
        typeof pkg.distance === 'number'
          ? `<p class="small wizard-package-distance">${pkg.distance.toFixed(1)} miles away</p>`
          : '';
      html += `
        <div class="wizard-package-card${isSel ? ' selected' : ''}"
             data-package-id="${escapeHtml(String(pkg.id))}" data-category="${escapeHtml(categoryKey)}"
             role="option" aria-selected="${isSel}" tabindex="0">
          ${pkg.image ? `<img src="${escapeHtml(pkg.image)}" alt="${escapeHtml(pkg.title)}" loading="lazy">` : '<div class="wz-pkg-img-placeholder" aria-hidden="true"></div>'}
          <div class="wz-pkg-body">
            <h4>${escapeHtml(pkg.title)}</h4>
            ${dist}
            ${
              pkg.price_display || pkg.price
                ? `<p class="small wz-pkg-price">${escapeHtml(pkg.price_display || pkg.price)}</p>`
                : '<p class="small wz-pkg-price price-not-set">Price not set</p>'
            }
            ${isSel ? '<div class="wizard-package-selected" aria-label="Selected">✓ Shortlisted</div>' : ''}
          </div>
        </div>`;
    });
    html += '</div>';
    if (packages.length > 6) {
      html += `<p class="small wz-pkg-more">Showing 6 of ${packages.length} · <a href="/suppliers?category=${encodeURIComponent(categoryKey)}">See all →</a></p>`;
    }
    container.innerHTML = html;

    const cards = container.querySelectorAll('.wizard-package-card');
    function activate(card) {
      const pkgId = card.getAttribute('data-package-id');
      const catKey = card.getAttribute('data-category');
      const wasSel = card.classList.contains('selected');
      cards.forEach(c => {
        c.classList.remove('selected');
        c.setAttribute('aria-selected', 'false');
      });
      if (!wasSel) {
        card.classList.add('selected');
        card.setAttribute('aria-selected', 'true');
        card.querySelector('.wz-pkg-body') &&
          (card.querySelector('.wizard-package-selected') ||
            card
              .querySelector('.wz-pkg-body')
              .insertAdjacentHTML(
                'beforeend',
                '<div class="wizard-package-selected" aria-label="Selected">✓ Shortlisted</div>'
              ));
        window.WizardState.selectPackage(catKey, pkgId);
      } else {
        card.querySelector('.wizard-package-selected')?.remove();
        window.WizardState.deselectPackage(catKey);
      }
      renderPlanSummary();
    }
    cards.forEach(card => {
      card.addEventListener('click', () => activate(card));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(card);
        }
      });
    });
  }

  /* ─── Event listeners ────────────────────────────────────────────────────── */

  function attachStepListeners(stepIndex) {
    // Welcome screen
    if (stepIndex === STEP.WELCOME) {
      document.getElementById('resume-plan-btn')?.addEventListener('click', () => {
        const state = window.WizardState.getState();
        currentStep = state.currentStep >= 0 ? state.currentStep : STEP.EVENT_TYPE;
        hasShownWelcome = true;
        renderStep(currentStep);
        renderPlanSummary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      document.getElementById('start-scratch-btn')?.addEventListener('click', () => {
        window.WizardState.clearState();
        hasShownWelcome = true;
        currentStep = STEP.EVENT_TYPE;
        window.WizardState.saveStep(STEP.EVENT_TYPE, { wizardStartedAt: new Date().toISOString() });
        renderStep(currentStep);
        renderPlanSummary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      document.querySelectorAll('.wz-tpl-card').forEach(card => {
        card.addEventListener('click', () => {
          const tpl = window.EventTemplates?.getTemplate(card.dataset.templateId);
          if (!tpl) {
            return;
          }
          applyTemplate(tpl);
        });
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            card.click();
          }
        });
      });
      return;
    }

    // Event type
    if (stepIndex === STEP.EVENT_TYPE) {
      loadEventTypeImages();
      const options = document.querySelectorAll('.wizard-option');
      const nextBtn = document.querySelector('.wizard-next');
      options.forEach(opt => {
        opt.addEventListener('click', function () {
          options.forEach(o => {
            o.classList.remove('selected');
            o.setAttribute('aria-pressed', 'false');
          });
          this.classList.add('selected');
          this.setAttribute('aria-pressed', 'true');
          window.WizardState.saveStep(STEP.EVENT_TYPE, {
            eventType: this.getAttribute('data-value'),
          });
          if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.removeAttribute('aria-disabled');
          }
          renderPlanSummary();
        });
      });
    }

    // Priorities
    if (stepIndex === STEP.PRIORITIES) {
      document.querySelectorAll('.wz-chip[data-priority-key]').forEach(chip => {
        chip.addEventListener('click', function () {
          const key = this.getAttribute('data-priority-key');
          const state = window.WizardState.getState();
          const prios = [...(state.priorities || [])];
          const idx = prios.indexOf(key);
          if (idx >= 0) {
            prios.splice(idx, 1);
          } else {
            prios.push(key);
          }
          this.classList.toggle('wz-chip--selected', idx < 0);
          this.setAttribute('aria-pressed', String(idx < 0));
          window.WizardState.saveStep(STEP.PRIORITIES, { priorities: prios });
          // Update hint text
          const hint = document.querySelector('.wz-chip-hint');
          if (hint) {
            hint.innerHTML =
              prios.length > 0
                ? `<strong>${prios.length} area${prios.length !== 1 ? 's' : ''} selected</strong> — we'll tailor your next steps`
                : 'Select at least one area, or continue to use our defaults';
          }
        });
      });
    }

    // Style
    if (stepIndex === STEP.STYLE) {
      document.querySelectorAll('.wz-chip[data-style-key]').forEach(chip => {
        chip.addEventListener('click', function () {
          const key = this.getAttribute('data-style-key');
          const state = window.WizardState.getState();
          const styles = [...(state.styles || [])];
          const idx = styles.indexOf(key);
          if (idx >= 0) {
            styles.splice(idx, 1);
          } else {
            styles.push(key);
          }
          this.classList.toggle('wz-chip--selected', idx < 0);
          this.setAttribute('aria-pressed', String(idx < 0));
          window.WizardState.saveStep(STEP.STYLE, { styles });
          const hint = document.querySelector('.wz-chip-hint');
          if (hint) {
            if (styles.length > 0) {
              const labels = styles
                .map(k => STYLE_OPTIONS.find(s => s.key === k)?.label || k)
                .join(', ');
              hint.innerHTML = `<strong>${escapeHtml(labels)}</strong>`;
            } else {
              hint.textContent = 'Nothing selected yet — perfectly fine to skip';
            }
          }
        });
      });
    }

    // Category step: load packages
    const cats = getActiveCategories();
    const catIndex = stepIndex - FIXED_STEPS_BEFORE_CATS;
    if (catIndex >= 0 && catIndex < cats.length) {
      const category = cats[catIndex];

      // Already-have toggle
      document.querySelector('.wz-already-have-btn')?.addEventListener('click', e => {
        const catKey = e.currentTarget.getAttribute('data-category');
        const state = window.WizardState.getState();
        const ah = { ...(state.alreadyHave || {}), [catKey]: true };
        window.WizardState.saveStep(currentStep, { alreadyHave: ah });
        renderStep(currentStep);
      });
      document.querySelector('.wz-undo-already-have')?.addEventListener('click', e => {
        const catKey = e.currentTarget.getAttribute('data-category');
        const state = window.WizardState.getState();
        const ah = { ...(state.alreadyHave || {}) };
        delete ah[catKey];
        window.WizardState.saveStep(currentStep, { alreadyHave: ah });
        renderStep(currentStep);
      });

      const state = window.WizardState.getState();
      loadPackagesForCategory(category.key, state.eventType).then(packages => {
        if (packages === null) {
          const pkgContainer = document.getElementById(`wizard-packages-${category.key}`);
          if (pkgContainer) {
            pkgContainer.setAttribute('aria-busy', 'false');
            pkgContainer.innerHTML = `
              <div class="wizard-packages-error">
                <p>We couldn't load packages right now.</p>
                <button class="cta secondary" type="button" id="retry-pkg-${escapeHtml(category.key)}">Try again</button>
                <p class="small"><a href="/suppliers?category=${encodeURIComponent(category.key)}">Or browse suppliers directly →</a></p>
              </div>`;
            document.getElementById(`retry-pkg-${category.key}`)?.addEventListener('click', () => {
              pkgContainer.setAttribute('aria-busy', 'true');
              pkgContainer.innerHTML = `<div class="wizard-package-grid">${[1, 2, 3]
                .map(() => '<div class="wizard-skeleton-card"></div>')
                .join('')}</div>`;
              loadPackagesForCategory(category.key, state.eventType).then(r =>
                r
                  ? renderPackageList(category.key, r)
                  : (pkgContainer.innerHTML =
                      '<p class="small">Still unavailable — you can continue and browse later.</p>')
              );
            });
          }
        } else {
          renderPackageList(category.key, packages);
        }
      });
    }

    // Review: edit links
    if (stepIndex === getReviewStep()) {
      document.querySelectorAll('.wizard-review-edit').forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          const target = parseInt(link.getAttribute('data-step'), 10);
          if (!isNaN(target)) {
            currentStep = target;
            renderStep(currentStep);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      });
    }

    // Success
    if (stepIndex === getSuccessStep()) {
      triggerCelebration();
      document.getElementById('start-new-plan-btn')?.addEventListener('click', () => {
        window.WizardState.clearState();
        currentStep = STEP.WELCOME;
        hasShownWelcome = false;
        renderStep(currentStep);
        renderPlanSummary();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Shared nav
    document.querySelector('.wizard-next')?.addEventListener('click', handleNext);
    document.querySelector('.wizard-back')?.addEventListener('click', handleBack);
    document.querySelector('.wizard-skip')?.addEventListener('click', handleSkip);
    document.querySelector('.wizard-create-plan')?.addEventListener('click', handleCreatePlan);
  }

  /* ─── Template application ───────────────────────────────────────────────── */

  function applyTemplate(tpl) {
    window.WizardState.clearState();
    hasShownWelcome = true;
    const eventTypeMap = {
      wedding: 'Wedding',
      birthday: 'Birthday',
      corporate: 'Corporate',
      conference: 'Corporate',
      other: 'Other',
    };
    const et = eventTypeMap[(tpl.eventType || '').toLowerCase()] || 'Other';
    const budgetLabel = mapBudget(tpl.budget);

    window.WizardState.saveStep(STEP.EVENT_TYPE, {
      templateId: tpl.id,
      eventType: et,
      wizardStartedAt: new Date().toISOString(),
    });
    if (tpl.guestCount || budgetLabel) {
      window.WizardState.saveStep(STEP.EVENT_BASICS, {
        guests: tpl.guestCount || null,
        budget: budgetLabel,
      });
    }
    if ((tpl.priorities || []).length) {
      window.WizardState.saveStep(STEP.PRIORITIES, { priorities: tpl.priorities });
    }
    if ((tpl.styles || []).length) {
      window.WizardState.saveStep(STEP.STYLE, { styles: tpl.styles });
    }

    // Start at EVENT_BASICS since type/priorities are pre-filled
    currentStep = STEP.EVENT_BASICS;
    renderStep(currentStep);
    renderPlanSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function mapBudget(amount) {
    if (!amount) {
      return '';
    }
    const n = Number(amount);
    if (n <= 1000) {
      return 'Up to £1,000';
    }
    if (n <= 3000) {
      return '£1,000–£3,000';
    }
    if (n <= 5000) {
      return '£3,000–£5,000';
    }
    if (n <= 10000) {
      return '£5,000–£10,000';
    }
    if (n <= 20000) {
      return '£10,000–£20,000';
    }
    return '£20,000+';
  }

  /* ─── Navigation ─────────────────────────────────────────────────────────── */

  function handleNext() {
    if (currentStep === STEP.EVENT_TYPE) {
      const state = window.WizardState.getState();
      if (!state.eventType) {
        const group = document.querySelector('.wizard-options');
        if (group) {
          group.classList.add('wizard-shake');
          group.addEventListener('animationend', () => group.classList.remove('wizard-shake'), {
            once: true,
          });
        }
        return;
      }
    }

    if (currentStep === STEP.EVENT_BASICS) {
      const name = document.getElementById('wz-name')?.value.trim() || '';
      const date = document.getElementById('wz-date')?.value || '';
      const location = document.getElementById('wz-location')?.value.trim() || '';
      const guestsRaw = document.getElementById('wz-guests')?.value || '';
      const budget = document.getElementById('wz-budget')?.value || '';
      const stage = document.getElementById('wz-stage')?.value || '';

      // Friendly validation — only for clearly invalid values, not missing optional fields
      const guestsField = document.getElementById('wz-guests');
      if (guestsRaw && (isNaN(parseInt(guestsRaw, 10)) || parseInt(guestsRaw, 10) < 1)) {
        if (guestsField) {
          guestsField.closest('.form-row')?.classList.add('error');
          const hint = guestsField.closest('.form-row')?.querySelector('.helper-text');
          if (hint) {
            hint.textContent = 'Please enter a whole number greater than 0';
          }
          guestsField.classList.add('wizard-shake');
          guestsField.addEventListener(
            'animationend',
            () => guestsField.classList.remove('wizard-shake'),
            { once: true }
          );
          guestsField.focus();
        }
        return;
      }
      // Remove error state if value is now valid
      if (guestsField) {
        guestsField.closest('.form-row')?.classList.remove('error');
      }

      window.WizardState.saveStep(currentStep, {
        eventName: name,
        date,
        location,
        guests: guestsRaw ? parseInt(guestsRaw, 10) || null : null,
        budget,
        planningStage: stage,
      });
    }

    const maxStep = getReviewStep();
    currentStep = Math.min(currentStep + 1, maxStep);
    renderStep(currentStep);
    renderPlanSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSkip() {
    if (currentStep === STEP.EVENT_BASICS) {
      const name = document.getElementById('wz-name')?.value.trim() || '';
      const date = document.getElementById('wz-date')?.value || '';
      const location = document.getElementById('wz-location')?.value.trim() || '';
      const guestsRaw = document.getElementById('wz-guests')?.value || '';
      const budget = document.getElementById('wz-budget')?.value || '';
      const stage = document.getElementById('wz-stage')?.value || '';

      // Friendly validation — only for clearly invalid values, not missing optional fields
      const guestsField = document.getElementById('wz-guests');
      if (guestsRaw && (isNaN(parseInt(guestsRaw, 10)) || parseInt(guestsRaw, 10) < 1)) {
        if (guestsField) {
          guestsField.closest('.form-row')?.classList.add('error');
          const hint = guestsField.closest('.form-row')?.querySelector('.helper-text');
          if (hint) {
            hint.textContent = 'Please enter a whole number greater than 0';
          }
          guestsField.classList.add('wizard-shake');
          guestsField.addEventListener(
            'animationend',
            () => guestsField.classList.remove('wizard-shake'),
            { once: true }
          );
          guestsField.focus();
        }
        return;
      }
      // Remove error state if value is now valid
      if (guestsField) {
        guestsField.closest('.form-row')?.classList.remove('error');
      }

      window.WizardState.saveStep(currentStep, {
        eventName: name,
        date,
        location,
        guests: guestsRaw ? parseInt(guestsRaw, 10) || null : null,
        budget,
        planningStage: stage,
      });
    }
    currentStep = Math.min(currentStep + 1, getReviewStep());
    renderStep(currentStep);
    renderPlanSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBack() {
    if (currentStep === STEP.EVENT_TYPE) {
      if (hasFormData()) {
        if (!confirm('Leave wizard? Your progress is saved — come back any time.')) {
          return;
        }
      }
      if (hasShownWelcome) {
        currentStep = STEP.WELCOME;
        renderStep(currentStep);
      } else {
        window.WizardState.saveState(window.WizardState.getState(), false);
        window.location.href = '/';
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    currentStep = Math.max(currentStep - 1, STEP.EVENT_TYPE);
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ─── Plan creation ──────────────────────────────────────────────────────── */

  async function handleCreatePlan() {
    const btn = document.querySelector('.wizard-create-plan');
    if (!btn) {
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="wizard-loading"></span> Saving…';

    try {
      let isLoggedIn = false;
      let user = null;
      if (window.AuthStateManager?.getUser) {
        user = window.AuthStateManager.getUser();
        isLoggedIn = !!user;
      }
      if (!isLoggedIn) {
        const r = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (r.ok) {
          isLoggedIn = true;
          user = (await r.json()).user || {};
        }
      }

      const planData = window.WizardState.exportForPlanCreation();
      const state = window.WizardState.getState();
      // Enrich plan data with new fields
      planData.planningStage = state.planningStage || null;
      if ((state.priorities || []).length || (state.styles || []).length) {
        planData.notes = [
          planData.notes || '',
          (state.priorities || []).length ? `Priorities: ${state.priorities.join(', ')}` : '',
          (state.styles || []).length ? `Style: ${state.styles.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
          .trim();
      }

      if (!isLoggedIn) {
        try {
          localStorage.setItem('eventflow_wizard_pending', JSON.stringify(planData));
          localStorage.setItem('eventflow_wizard_timestamp', Date.now().toString());
        } catch (_) {
          // localStorage can be unavailable in private browsing or restricted contexts.
        }
        location.href = `/auth?returnTo=${encodeURIComponent('/start?restore=true')}`;
        return;
      }

      const saveResult = await savePlanToBackend(planData);
      if (saveResult?.status === 401) {
        location.href = `/auth?returnTo=${encodeURIComponent('/start?restore=true')}`;
        return;
      }
      savedPlanId =
        saveResult?.plan?.id || saveResult?.plan?._id || saveResult?._id || saveResult?.id || null;

      window.WizardState.markCompleted();
      _wizardCompleted = true;
      removeBeforeUnload();
      currentStep = getSuccessStep();
      renderStep(currentStep);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        window.WizardState.clearState();
        ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'].forEach(k => {
          try {
            localStorage.removeItem(k);
          } catch (_) {
            /* localStorage may be unavailable. */
          }
        });
      }, 3000);
    } catch (err) {
      console.error('Error saving plan:', err);
      if (window.showNotification) {
        window.showNotification(err.message || 'Failed to save plan. Please try again.', 'error');
      } else {
        alert('There was an error saving your plan. Please try again.');
      }
      btn.disabled = false;
      btn.textContent = 'Save my plan';
    }
  }

  async function savePlanToBackend(planData) {
    const csrfToken = await getCsrfToken();
    const r = await fetch('/api/v1/me/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify(planData),
    });
    if (r.status === 401) {
      return { status: 401 };
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || e.error || 'Failed to save plan');
    }
    return r.json();
  }

  async function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) {
      return meta.getAttribute('content');
    }
    const cookie = document.cookie.match(/csrfToken=([^;]+)/);
    if (cookie) {
      return cookie[1];
    }
    try {
      const r = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        return d.csrfToken || '';
      }
    } catch (_) {
      // CSRF fallback is best-effort; callers can continue without a token.
    }
    return '';
  }

  /* ─── State restore ──────────────────────────────────────────────────────── */

  function restoreWizardState() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('restore') !== 'true') {
      return;
    }
    try {
      const pending = localStorage.getItem('eventflow_wizard_pending');
      const ts = localStorage.getItem('eventflow_wizard_timestamp');
      if (!pending || !ts) {
        return;
      }
      if (Date.now() - parseInt(ts, 10) > WIZARD_DATA_EXPIRY_MS) {
        ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'].forEach(k =>
          localStorage.removeItem(k)
        );
        return;
      }
      const planData = JSON.parse(pending);
      const attempt = retriesLeft => {
        const user = window.AuthStateManager?.getUser?.();
        if (user) {
          savePlanToBackend(planData)
            .then(result => {
              if (result?.status === 401 && retriesLeft > 0) {
                setTimeout(() => attempt(retriesLeft - 1), 500);
                return;
              }
              ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'].forEach(k =>
                localStorage.removeItem(k)
              );
              window.showNotification?.('Your event plan has been saved!', 'success');
              setTimeout(() => {
                location.href = '/dashboard/customer';
              }, 1500);
            })
            .catch(err => {
              console.error('Failed to save restored plan:', err);
              ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'].forEach(k =>
                localStorage.removeItem(k)
              );
              window.showNotification?.(
                err.message || 'Your plan could not be saved. Please try again.',
                'error'
              );
            });
        } else if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 500);
        }
      };
      attempt(3);
    } catch (e) {
      console.error('Failed to restore wizard state:', e);
      ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'].forEach(k => {
        try {
          localStorage.removeItem(k);
        } catch (_) {
          /* localStorage may be unavailable. */
        }
      });
    }
  }

  /* ─── Helpers ────────────────────────────────────────────────────────────── */

  function hasFormData() {
    const s = window.WizardState.getState();
    return !!(
      s.eventType ||
      s.eventName ||
      s.location ||
      s.date ||
      s.guests ||
      s.budget ||
      (s.priorities || []).length ||
      Object.keys(s.selectedPackages || {}).length
    );
  }

  function handleAutosave() {
    showAutosaveIndicator();
  }

  function showAutosaveIndicator() {
    const s = document.getElementById('plan-summary');
    if (!s) {
      return;
    }
    let ind = s.querySelector('.wizard-autosave');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'wizard-autosave';
      ind.innerHTML =
        '<span class="wizard-autosave-icon">✓</span><span class="wizard-autosave-text">Progress saved</span>';
      s.appendChild(ind);
    }
    ind.style.display = 'flex';
    setTimeout(() => {
      ind.style.display = 'none';
    }, 3000);
  }

  function setupBeforeUnload() {
    _beforeunloadHandler = e => {
      if (!_wizardCompleted && hasFormData()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', _beforeunloadHandler);
  }

  function removeBeforeUnload() {
    if (_beforeunloadHandler) {
      window.removeEventListener('beforeunload', _beforeunloadHandler);
      _beforeunloadHandler = null;
    }
  }

  function triggerCelebration() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const colors = ['#0B8073', '#13B6A2', '#10b981', '#34d399'];
    let cc = document.getElementById('wizard-confetti-container');
    if (!cc) {
      cc = document.createElement('div');
      cc.id = 'wizard-confetti-container';
      cc.className = 'wizard-confetti-container';
      cc.setAttribute('aria-hidden', 'true');
      (document.getElementById('wizard-container') || document.body).appendChild(cc);
    }
    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const c = document.createElement('div');
        c.className = 'wizard-confetti';
        c.style.cssText = `left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};animation-delay:${Math.random() * 0.3}s;animation-duration:${Math.random() * 2 + 2}s`;
        cc.appendChild(c);
        const t = setTimeout(() => c.parentNode && c.remove(), 5000);
        c.addEventListener(
          'animationend',
          () => {
            clearTimeout(t);
            c.parentNode && c.remove();
          },
          { once: true }
        );
      }, i * 50);
    }
  }

  /* ─── Boot ───────────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
