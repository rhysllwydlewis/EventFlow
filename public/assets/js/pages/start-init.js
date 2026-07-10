/**
 * start-init.js — EventFlow /start page hardening
 *
 * The main wizard is rendered by start-wizard.js. This integration layer keeps
 * navigation state, package choices and validation consistent without
 * duplicating the wizard renderer.
 */
(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'eventflow_plan_builder_v1';
  const LEGACY_KEY = 'eventflow_start';
  const PENDING_KEYS = ['eventflow_wizard_pending', 'eventflow_wizard_timestamp'];
  const DEFAULT_CATEGORY_KEYS = ['venues', 'photography', 'catering', 'flowers'];
  const CATEGORY_BY_PRIORITY = {
    venue: 'venues',
    catering: 'catering',
    photography: 'photography',
    flowers: 'flowers',
    entertainment: 'entertainment',
    av: 'av',
  };

  let installed = false;
  let observer = null;
  let originalFetch = null;
  let originals = null;
  const cleanup = [];
  const queueTask =
    typeof window.queueMicrotask === 'function'
      ? window.queueMicrotask.bind(window)
      : callback => Promise.resolve().then(callback);

  function getActiveCategoryKeys(priorities) {
    const chosen = Array.isArray(priorities) ? priorities : [];
    const matched = chosen.map(key => CATEGORY_BY_PRIORITY[key]).filter(Boolean);
    return matched.length > 0 ? [...new Set(matched)].slice(0, 6) : [...DEFAULT_CATEGORY_KEYS];
  }

  function filterRecord(record, allowedKeys) {
    const allowed = new Set(allowedKeys);
    return Object.fromEntries(
      Object.entries(record || {}).filter(([key, value]) => allowed.has(key) && value)
    );
  }

  function recordsEqual(left, right) {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  }

  function patchWizardState() {
    const api = window.WizardState;
    originals = {
      saveState: api.saveState.bind(api),
      saveStep: api.saveStep.bind(api),
      selectPackage: api.selectPackage.bind(api),
      deselectPackage: api.deselectPackage.bind(api),
      clearState: api.clearState.bind(api),
    };

    api.saveStep = function saveStepWithConsistency(stepIndex, data) {
      const before = api.getState();
      const next = { ...(data || {}) };

      if (
        stepIndex === 0 &&
        Object.prototype.hasOwnProperty.call(next, 'eventType') &&
        before.eventType &&
        next.eventType &&
        before.eventType !== next.eventType
      ) {
        next.selectedPackages = {};
        next.alreadyHave = {};
      }

      if (stepIndex === 1) {
        if (Object.prototype.hasOwnProperty.call(next, 'eventName')) {
          next.eventName = String(next.eventName || '')
            .trim()
            .slice(0, 100);
        }
        if (Object.prototype.hasOwnProperty.call(next, 'location')) {
          next.location = String(next.location || '')
            .trim()
            .slice(0, 200);
        }
        if (
          Object.prototype.hasOwnProperty.call(next, 'guests') &&
          next.guests !== null &&
          next.guests !== ''
        ) {
          const guests = Number(next.guests);
          next.guests = Number.isInteger(guests) && guests >= 1 && guests <= 10000 ? guests : null;
        }
      }

      return originals.saveStep(stepIndex, next);
    };

    api.selectPackage = function selectPackageExclusively(categoryKey, packageId) {
      const state = api.getState();
      const selectedPackages = {
        ...(state.selectedPackages || {}),
        [categoryKey]: packageId,
      };
      const alreadyHave = { ...(state.alreadyHave || {}) };
      delete alreadyHave[categoryKey];
      return originals.saveState({ ...state, selectedPackages, alreadyHave });
    };

    api.clearState = function clearAllWizardState() {
      const result = originals.clearState();
      try {
        window.localStorage.removeItem(LEGACY_KEY);
        PENDING_KEYS.forEach(key => window.localStorage.removeItem(key));
      } catch (_) {
        // Storage can be unavailable in private or restricted browsing modes.
      }
      return result;
    };

    normaliseExistingState(api);
  }

  function normaliseExistingState(api) {
    const state = api.getState();
    const activeKeys = getActiveCategoryKeys(state.priorities);
    const selectedPackages = filterRecord(state.selectedPackages, activeKeys);
    const alreadyHave = filterRecord(state.alreadyHave, activeKeys);

    Object.keys(selectedPackages).forEach(key => {
      delete alreadyHave[key];
    });

    if (
      !recordsEqual(selectedPackages, state.selectedPackages) ||
      !recordsEqual(alreadyHave, state.alreadyHave)
    ) {
      originals.saveState({ ...state, selectedPackages, alreadyHave }, false);
    }
  }

  function patchPlanSave401Recovery() {
    if (typeof window.fetch !== 'function') {
      return;
    }

    originalFetch = window.fetch.bind(window);
    window.fetch = async function fetchWithPlanRecovery(input, init) {
      const requestInit = init || {};
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(requestInit.method || (typeof input !== 'string' ? input?.method : '') || 'GET')
        .toUpperCase();
      const isPlanCreate = method === 'POST' && /\/api\/v1\/me\/plans(?:\?.*)?$/.test(url);
      const response = await originalFetch(input, init);

      if (isPlanCreate && response.status === 401 && requestInit.body) {
        try {
          const body =
            typeof requestInit.body === 'string'
              ? requestInit.body
              : JSON.stringify(requestInit.body);
          window.localStorage.setItem(PENDING_KEYS[0], body);
          window.localStorage.setItem(PENDING_KEYS[1], Date.now().toString());
        } catch (_) {
          // The normal wizard flow still retains its main local state.
        }
      }

      return response;
    };
  }

  function addDocumentListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    cleanup.push(() => document.removeEventListener(type, handler, options));
  }

  function handleCaptureClick(event) {
    const alreadyCovered = event.target.closest?.('.wz-already-have-btn');
    if (alreadyCovered) {
      const categoryKey = alreadyCovered.getAttribute('data-category');
      if (categoryKey) {
        window.WizardState.deselectPackage(categoryKey);
      }
    }

    const action = event.target.closest?.('.wizard-next, .wizard-skip');
    if (!action) {
      return;
    }

    if (document.querySelector('.wz-chip[data-priority-key]')) {
      reconcileActiveCategories();
    }

    if (document.getElementById('wz-guests') && !validateBasicsStep()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleBubbleClick(event) {
    const packageCard = event.target.closest?.('.wizard-package-card');
    const coverageAction = event.target.closest?.(
      '.wz-already-have-btn, .wz-undo-already-have'
    );

    if (packageCard) {
      const categoryKey = packageCard.getAttribute('data-category');
      queueTask(() => {
        syncPackageCards(categoryKey);
        refreshSupplierSummary();
      });
    } else if (coverageAction) {
      queueTask(refreshSupplierSummary);
    }
  }

  function handleBubbleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const packageCard = event.target.closest?.('.wizard-package-card');
    if (!packageCard) {
      return;
    }
    const categoryKey = packageCard.getAttribute('data-category');
    queueTask(() => {
      syncPackageCards(categoryKey);
      refreshSupplierSummary();
    });
  }

  function reconcileActiveCategories() {
    const state = window.WizardState.getState();
    const activeKeys = getActiveCategoryKeys(state.priorities);
    const selectedPackages = filterRecord(state.selectedPackages, activeKeys);
    const alreadyHave = filterRecord(state.alreadyHave, activeKeys);

    Object.keys(selectedPackages).forEach(key => {
      delete alreadyHave[key];
    });

    if (
      !recordsEqual(selectedPackages, state.selectedPackages) ||
      !recordsEqual(alreadyHave, state.alreadyHave)
    ) {
      originals.saveState({ ...state, selectedPackages, alreadyHave });
    }
  }

  function validateBasicsStep() {
    const fields = [
      {
        element: document.getElementById('wz-name'),
        invalid: value => value.length > 100,
        message: 'Use 100 characters or fewer for the event name.',
      },
      {
        element: document.getElementById('wz-location'),
        invalid: value => value.length > 200,
        message: 'Use 200 characters or fewer for the location.',
      },
      {
        element: document.getElementById('wz-guests'),
        invalid: value => {
          if (!value) {
            return false;
          }
          const guests = Number(value);
          return !Number.isInteger(guests) || guests < 1 || guests > 10000;
        },
        message: 'Enter a whole number between 1 and 10,000.',
      },
    ];

    let firstInvalid = null;
    fields.forEach(({ element, invalid, message }) => {
      if (!element) {
        return;
      }
      const isInvalid = invalid(element.value.trim());
      if (isInvalid) {
        showFieldError(element, message);
        firstInvalid ||= element;
      } else {
        clearFieldError(element);
      }
    });

    firstInvalid?.focus();
    return !firstInvalid;
  }

  function showFieldError(field, message) {
    const row = field.closest('.form-row');
    const hint = row?.querySelector('.helper-text');
    if (hint && !hint.dataset.defaultText) {
      hint.dataset.defaultText = hint.textContent || '';
    }
    if (hint) {
      hint.textContent = message;
    }
    row?.classList.add('error');
    field.setAttribute('aria-invalid', 'true');
    field.classList.remove('wizard-shake');
    // Restart the animation even when the same invalid action is repeated.
    void field.offsetWidth;
    field.classList.add('wizard-shake');
    window.setTimeout(() => field.classList.remove('wizard-shake'), 500);
  }

  function clearFieldError(field) {
    const row = field.closest('.form-row');
    const hint = row?.querySelector('.helper-text');
    if (hint?.dataset.defaultText) {
      hint.textContent = hint.dataset.defaultText;
    }
    row?.classList.remove('error');
    field.removeAttribute('aria-invalid');
  }

  function handleInput(event) {
    if (event.target.matches?.('#wz-name, #wz-location, #wz-guests')) {
      clearFieldError(event.target);
    }
  }

  function syncPackageCards(categoryKey) {
    if (!categoryKey) {
      return;
    }
    const state = window.WizardState.getState();
    const selectedId = String((state.selectedPackages || {})[categoryKey] || '');
    const cards = document.querySelectorAll(
      `.wizard-package-card[data-category="${window.CSS?.escape ? window.CSS.escape(categoryKey) : categoryKey}"]`
    );

    cards.forEach(card => {
      const selected = selectedId && card.getAttribute('data-package-id') === selectedId;
      card.classList.toggle('selected', Boolean(selected));
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
      card.querySelector('.wizard-package-selected')?.remove();
      if (selected) {
        card
          .querySelector('.wz-pkg-body')
          ?.insertAdjacentHTML(
            'beforeend',
            '<div class="wizard-package-selected" aria-label="Selected">✓ Shortlisted</div>'
          );
      }
    });
  }

  function refreshSupplierSummary() {
    const state = window.WizardState.getState();
    const activeKeys = getActiveCategoryKeys(state.priorities);
    const active = new Set(activeKeys);
    const serviced = new Set([
      ...Object.keys(state.selectedPackages || {}),
      ...Object.keys(state.alreadyHave || {}),
    ]);
    const covered = [...serviced].filter(key => active.has(key)).length;

    document.querySelectorAll('#plan-summary .plan-summary-item').forEach(row => {
      const label = row.querySelector('.small');
      const value = row.querySelector('span:last-child');
      if (label?.textContent.trim() === 'Suppliers' && value) {
        value.textContent = `${covered} of ${activeKeys.length} covered`;
      }
    });

    document.querySelectorAll('#mobile-plan-summary .plan-summary-item').forEach(row => {
      const label = row.querySelector('.small');
      const value = row.querySelector('span:last-child');
      if (label?.textContent.trim() === 'Suppliers' && value) {
        value.textContent = `${covered} covered`;
      }
    });
  }

  function persistRenderedStep() {
    const indicator = document.querySelector('.wizard-step-indicator');
    const match = indicator?.textContent.match(/Step\s+(\d+)\s+of/i);
    if (!match) {
      return;
    }

    const renderedStep = Number(match[1]) - 1;
    const state = window.WizardState.getState();
    if (Number.isInteger(renderedStep) && state.currentStep !== renderedStep) {
      originals.saveState({ ...state, currentStep: renderedStep }, false);
    }
  }

  function configureRenderedFields() {
    const name = document.getElementById('wz-name');
    const location = document.getElementById('wz-location');
    const guests = document.getElementById('wz-guests');
    name?.setAttribute('maxlength', '100');
    location?.setAttribute('maxlength', '200');
    guests?.setAttribute('step', '1');
  }

  function observeWizard() {
    const container = document.getElementById('wizard-container');
    if (!container || typeof window.MutationObserver !== 'function') {
      return;
    }

    observer = new window.MutationObserver(() => {
      configureRenderedFields();
      persistRenderedStep();
      refreshSupplierSummary();
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function install() {
    if (installed) {
      return true;
    }
    if (!window.WizardState) {
      window.setTimeout(install, 0);
      return false;
    }

    installed = true;
    patchWizardState();
    patchPlanSave401Recovery();
    addDocumentListener('click', handleCaptureClick, true);
    addDocumentListener('click', handleBubbleClick, false);
    addDocumentListener('keydown', handleBubbleKeydown, false);
    addDocumentListener('input', handleInput, false);
    observeWizard();
    configureRenderedFields();
    return true;
  }

  function destroy() {
    cleanup.splice(0).forEach(remove => remove());
    observer?.disconnect();
    observer = null;

    if (originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
    }

    if (originals && window.WizardState) {
      window.WizardState.saveState = originals.saveState;
      window.WizardState.saveStep = originals.saveStep;
      window.WizardState.selectPackage = originals.selectPackage;
      window.WizardState.deselectPackage = originals.deselectPackage;
      window.WizardState.clearState = originals.clearState;
    }

    originals = null;
    installed = false;
  }

  window.StartWizardHardening = {
    destroy,
    getActiveCategoryKeys,
    install,
    validateBasicsStep,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window, document);
