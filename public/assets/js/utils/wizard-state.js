/**
 * Wizard State Manager
 * Manages the multi-step planning wizard state with localStorage persistence
 * Key: eventflow_plan_builder_v1
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'eventflow_plan_builder_v1';
  const LEGACY_KEY = 'eventflow_start';
  const AUTOSAVE_DELAY_MS = 2000; // 2 seconds debounce

  let autosaveTimeout = null;
  let autosaveCallback = null;

  /**
   * Default state structure
   */
  const DEFAULT_STATE = {
    currentStep: 0,
    completed: false,
    templateId: null,          // Which template was chosen (if any)
    eventType: '',             // 'Wedding' | 'Corporate' | 'Birthday' | 'Other'
    eventName: '',
    location: '',
    date: '',
    guests: null,
    budget: '',
    planningStage: '',         // 'just-starting' | 'venue-booked' | 'some-booked' | 'nearly-ready'
    priorities: [],            // Selected planning needs e.g. ['venue', 'catering', 'photography']
    styles: [],                // Style/vibe chips e.g. ['classic', 'luxury']
    notes: '',
    selectedPackages: {},      // { categoryKey: packageId }
    alreadyHave: {},           // { categoryKey: true } — supplier already booked
    wizardStartedAt: null,
    lastUpdated: null,
  };

  /**
   * Get the current wizard state from localStorage
   * @returns {Object} Current wizard state
   */
  function getState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_STATE, ...JSON.parse(stored) };
      }

      // Check for legacy eventflow_start data and migrate if exists
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const legacyData = JSON.parse(legacy);
        const migrated = {
          ...DEFAULT_STATE,
          eventType: legacyData.type || '',
          eventName: legacyData.name || '',
          location: legacyData.location || '',
          date: legacyData.date || '',
          guests: legacyData.guests || null,
          budget: legacyData.budget || '',
          styles: legacyData.styles || [],
          notes: legacyData.notes || '',
          currentStep: 1, // Start at step 1 since they have some data
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        };
        saveState(migrated);
        return migrated;
      }

      return { ...DEFAULT_STATE };
    } catch (err) {
      console.error('Error loading wizard state:', err);
      return { ...DEFAULT_STATE };
    }
  }

  /**
   * Save the wizard state to localStorage
   * @param {Object} state - State to save
   * @param {boolean} triggerAutosave - Whether to trigger autosave callback
   */
  function saveState(state, triggerAutosave = true) {
    try {
      const updated = {
        ...state,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      // Trigger autosave indicator if enabled
      if (triggerAutosave && autosaveCallback) {
        clearTimeout(autosaveTimeout);
        autosaveTimeout = setTimeout(() => {
          autosaveCallback(updated);
        }, AUTOSAVE_DELAY_MS);
      }

      return true;
    } catch (err) {
      console.error('Error saving wizard state:', err);
      return false;
    }
  }

  /**
   * Save a specific step's data
   * @param {number} stepIndex - Step index
   * @param {Object} data - Data for this step
   */
  function saveStep(stepIndex, data) {
    const state = getState();
    const updated = {
      ...state,
      ...data,
      currentStep: stepIndex,
      wizardStartedAt: state.wizardStartedAt || new Date().toISOString(),
    };
    return saveState(updated);
  }

  /**
   * Add or update a package selection for a category
   * @param {string} categoryKey - Category key/slug
   * @param {string} packageId - Package ID
   */
  function selectPackage(categoryKey, packageId) {
    const state = getState();
    state.selectedPackages[categoryKey] = packageId;
    return saveState(state);
  }

  /**
   * Remove a package selection for a category
   * @param {string} categoryKey - Category key/slug
   */
  function deselectPackage(categoryKey) {
    const state = getState();
    delete state.selectedPackages[categoryKey];
    return saveState(state);
  }

  /**
   * Get selected packages
   * @returns {Object} Selected packages by category
   */
  function getSelectedPackages() {
    const state = getState();
    return state.selectedPackages || {};
  }

  /**
   * Clear the wizard state
   */
  function clearState() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (err) {
      console.error('Error clearing wizard state:', err);
      return false;
    }
  }

  /**
   * Mark wizard as completed
   */
  function markCompleted() {
    const state = getState();
    state.completed = true;
    return saveState(state);
  }

  /**
   * Get the next step index
   * @param {number} currentStep - Current step index
   * @param {Array} categories - Array of categories for wizard steps
   * @returns {number} Next step index
   */
  function getNextStep(currentStep, categories) {
    const totalSteps = 2 + (categories ? categories.length : 0) + 1; // event type + location + categories + review
    return Math.min(currentStep + 1, totalSteps - 1);
  }

  /**
   * Get the previous step index
   * @param {number} currentStep - Current step index
   * @returns {number} Previous step index
   */
  function getPreviousStep(currentStep) {
    return Math.max(currentStep - 1, 0);
  }

  /**
   * Check if state is ready for plan creation
   * @returns {Object} { ready: boolean, missing: string[] }
   */
  function isReadyForPlanCreation() {
    const state = getState();
    const missing = [];

    if (!state.eventType) {
      missing.push('Event type');
    }

    // Other fields are optional

    return {
      ready: missing.length === 0,
      missing,
    };
  }

  /**
   * Export state for plan creation API
   * @returns {Object} Plan data ready for API
   */
  function exportForPlanCreation() {
    const state = getState();
    return {
      eventType: state.eventType,
      eventName: state.eventName,
      location: state.location,
      date: state.date,
      guests: state.guests,
      budget: state.budget,
      styles: state.styles,
      notes: state.notes,
      packages: Object.values(state.selectedPackages || {}),
    };
  }

  /**
   * Set autosave callback function
   * @param {Function} callback - Function to call after state save
   */
  function setAutosaveCallback(callback) {
    autosaveCallback = callback;
  }

  /**
   * Get time since last update
   * @returns {number} Milliseconds since last update
   */
  function getTimeSinceLastUpdate() {
    const state = getState();
    if (!state.lastUpdated) {
      return Infinity;
    }
    return Date.now() - new Date(state.lastUpdated).getTime();
  }

  // Expose public API
  window.WizardState = {
    getState,
    saveState,
    saveStep,
    selectPackage,
    deselectPackage,
    getSelectedPackages,
    clearState,
    markCompleted,
    getNextStep,
    getPreviousStep,
    isReadyForPlanCreation,
    exportForPlanCreation,
    setAutosaveCallback,
    getTimeSinceLastUpdate,
  };
})(window);
