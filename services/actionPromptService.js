/**
 * Action Prompt Service
 * Detects outstanding actions for supplier users and manages cadence escalation.
 *
 * Outstanding actions detected:
 *  1. missingPackages   — supplier has 0 packages                (RED — critical)
 *  2. incompleteProfile — supplier profile missing required fields (AMBER)
 *  3. missingPhotos     — supplier has no photos/gallery          (AMBER)
 *
 * Cadence (per-supplier while actions remain outstanding):
 *  • DAILY stage  : send once per 24 h for up to DAILY_SENDS_BEFORE_WEEKLY (7) sends
 *  • WEEKLY stage : send once per 7 days for up to WEEKLY_SENDS_BEFORE_MONTHLY (4) sends
 *  • MONTHLY stage: send once per 30 days indefinitely
 *  Cadence resets when all actions are cleared.
 *
 * actionPromptState schema:
 *  {
 *    cadence: 'daily'|'weekly'|'monthly',
 *    sendCountDaily: number,
 *    sendCountWeekly: number,
 *    sendCountMonthly: number,
 *    lastSentAt: ISO string | null,
 *    nextSendAt: ISO string,
 *    firstOutstandingAt: ISO string
 *  }
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

// Required supplier profile fields for "complete profile" check
const REQUIRED_PROFILE_FIELDS = ['name', 'description_short', 'location'];

// Cadence thresholds
const DAILY_SENDS_BEFORE_WEEKLY = 7;
const WEEKLY_SENDS_BEFORE_MONTHLY = 4;

// Cadence intervals
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MONTHLY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Keep these exported for backwards-compatibility with tests
const INITIAL_DELAY_MS = DAILY_INTERVAL_MS;
const SECOND_SEND_DELAY_MS = WEEKLY_INTERVAL_MS;
const MONTHLY_DELAY_MS = MONTHLY_INTERVAL_MS;

// Action definitions with severity labels
const ACTION_DEFINITIONS = {
  missingPackages: {
    severity: 'red',
    title: 'Create your first package',
    description:
      'Attract customers by listing your services. Suppliers with active packages receive significantly more enquiries from event planners.',
    ctaText: 'Create a Package',
  },
  incompleteProfile: {
    severity: 'amber',
    title: 'Complete your supplier profile',
    description:
      'Fill in your profile details — name, description, and location — so customers can discover and trust your business.',
    ctaText: 'Update Profile',
  },
  missingPhotos: {
    severity: 'amber',
    title: 'Add photos to your listing',
    description:
      'Profiles with photos attract far more views. Upload high-quality images of your work to make a great first impression.',
    ctaText: 'Upload Photos',
  },
};

// Human-readable labels for completed checks
const COMPLETE_LABELS = {
  hasPackages: 'Service packages listed',
  profileComplete: 'Profile details complete',
  hasPhotos: 'Photos uploaded',
};

/**
 * Compute outstanding action items for a single supplier.
 * Returns only outstanding (incomplete) actions — filtered by global settings and user prefs.
 *
 * @param {Object} supplier  - Supplier document
 * @param {Array}  packages  - All packages in the system
 * @param {Object} settings  - Global email-automation settings
 * @param {Object} user      - User document
 * @returns {Array} Array of action objects { key, severity, title, description, ctaUrl, ctaText }
 */
function computeActions(supplier, packages, settings, user) {
  const actions = [];
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
  const promptTypes = settings.emailAutomation?.actionPrompts?.promptTypes || {};
  const userPrefs = user?.emailPrefs?.actionPrompts || {};

  // 1. Missing packages (RED)
  const globalMissingPkg = promptTypes.missingPackages !== false;
  const userMissingPkgPref = userPrefs.missingPackages !== false;
  if (globalMissingPkg && userMissingPkgPref) {
    const supplierPackages = packages.filter(p => p.supplierId === supplier.id);
    if (supplierPackages.length === 0) {
      actions.push({
        key: 'missingPackages',
        ...ACTION_DEFINITIONS.missingPackages,
        ctaUrl: `${baseUrl}/dashboard/supplier`,
        status: 'incomplete',
      });
    }
  }

  // 2. Incomplete profile (AMBER)
  const globalIncompleteProfile = promptTypes.incompleteProfile !== false;
  const userIncompleteProfilePref = userPrefs.incompleteProfile !== false;
  if (globalIncompleteProfile && userIncompleteProfilePref) {
    const missingFields = REQUIRED_PROFILE_FIELDS.filter(
      field => !supplier[field] || String(supplier[field]).trim() === ''
    );
    if (missingFields.length > 0) {
      actions.push({
        key: 'incompleteProfile',
        ...ACTION_DEFINITIONS.incompleteProfile,
        ctaUrl: `${baseUrl}/dashboard/supplier`,
        status: 'incomplete',
      });
    }
  }

  // 3. Missing photos (AMBER — behind global and user toggles)
  const globalMissingPhotos = promptTypes.missingPhotos !== false;
  const userMissingPhotosPref = userPrefs.missingPhotos !== false;
  const hasPhotos = Array.isArray(supplier.photosGallery) && supplier.photosGallery.length > 0;
  if (globalMissingPhotos && userMissingPhotosPref && !hasPhotos) {
    actions.push({
      key: 'missingPhotos',
      ...ACTION_DEFINITIONS.missingPhotos,
      ctaUrl: `${baseUrl}/dashboard/supplier`,
      status: 'incomplete',
    });
  }

  return actions;
}

/**
 * Compute a full RAG report for a single supplier — returns both outstanding
 * and completed items, plus an overall RAG status and completion percentage.
 *
 * @param {Object} supplier - Supplier document
 * @param {Array}  packages - All packages in the system
 * @param {Object} settings - Global email-automation settings
 * @param {Object} user     - User document
 * @returns {{ outstanding: Array, completed: Array, ragStatus: string, completionPercent: number }}
 */
function computeFullReport(supplier, packages, settings, user) {
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
  const promptTypes = settings.emailAutomation?.actionPrompts?.promptTypes || {};
  const userPrefs = user?.emailPrefs?.actionPrompts || {};

  const outstanding = [];
  const completed = [];

  // 1. Packages
  const supplierPackages = packages.filter(p => p.supplierId === supplier.id);
  const globalMissingPkg = promptTypes.missingPackages !== false;
  const userMissingPkgPref = userPrefs.missingPackages !== false;
  if (supplierPackages.length === 0) {
    if (globalMissingPkg && userMissingPkgPref) {
      outstanding.push({
        key: 'missingPackages',
        ...ACTION_DEFINITIONS.missingPackages,
        ctaUrl: `${baseUrl}/dashboard/supplier`,
        status: 'incomplete',
      });
    }
  } else {
    completed.push({
      key: 'hasPackages',
      title: COMPLETE_LABELS.hasPackages,
      status: 'complete',
      severity: 'green',
    });
  }

  // 2. Profile completeness
  const globalIncompleteProfile = promptTypes.incompleteProfile !== false;
  const userIncompleteProfilePref = userPrefs.incompleteProfile !== false;
  const missingFields = REQUIRED_PROFILE_FIELDS.filter(
    field => !supplier[field] || String(supplier[field]).trim() === ''
  );
  if (missingFields.length > 0) {
    if (globalIncompleteProfile && userIncompleteProfilePref) {
      outstanding.push({
        key: 'incompleteProfile',
        ...ACTION_DEFINITIONS.incompleteProfile,
        ctaUrl: `${baseUrl}/dashboard/supplier`,
        status: 'incomplete',
      });
    }
  } else {
    completed.push({
      key: 'profileComplete',
      title: COMPLETE_LABELS.profileComplete,
      status: 'complete',
      severity: 'green',
    });
  }

  // 3. Photos (behind global and user toggles)
  const globalMissingPhotos = promptTypes.missingPhotos !== false;
  const userMissingPhotosPref = userPrefs.missingPhotos !== false;
  const hasPhotos = Array.isArray(supplier.photosGallery) && supplier.photosGallery.length > 0;
  if (!hasPhotos) {
    if (globalMissingPhotos && userMissingPhotosPref) {
      outstanding.push({
        key: 'missingPhotos',
        ...ACTION_DEFINITIONS.missingPhotos,
        ctaUrl: `${baseUrl}/dashboard/supplier`,
        status: 'incomplete',
      });
    }
  } else {
    completed.push({
      key: 'hasPhotos',
      title: COMPLETE_LABELS.hasPhotos,
      status: 'complete',
      severity: 'green',
    });
  }

  // Overall RAG status
  const hasRed = outstanding.some(a => a.severity === 'red');
  const ragStatus = hasRed ? 'red' : outstanding.length > 0 ? 'amber' : 'green';

  // Completion percentage
  const totalItems = outstanding.length + completed.length;
  const completionPercent =
    totalItems > 0 ? Math.round((completed.length / totalItems) * 100) : 100;

  return { outstanding, completed, ragStatus, completionPercent };
}

/**
 * Determine whether it is time to send based on the supplier's current cadence state.
 * Also returns the updated state to persist after a successful send.
 *
 * Cadence schedule:
 *  • No state:          do NOT send yet; schedule first email for 24 h from now (daily stage)
 *  • DAILY stage:       send once per 24 h for DAILY_SENDS_BEFORE_WEEKLY (7) sends, then → weekly
 *  • WEEKLY stage:      send once per 7 days for WEEKLY_SENDS_BEFORE_MONTHLY (4) sends, then → monthly
 *  • MONTHLY stage:     send once per 30 days indefinitely
 *
 * @param {Object|undefined} state - Current actionPromptState from user document
 * @param {Date}             now   - Current timestamp
 * @returns {{ shouldSend: boolean, nextState: Object }}
 */
function evaluateCadence(state, now) {
  const nowMs = now.getTime();

  if (!state) {
    // First outstanding detection — do NOT send immediately.
    // Schedule the first email for 24 h from now (start of daily stage).
    return {
      shouldSend: false,
      nextState: {
        cadence: 'daily',
        sendCountDaily: 0,
        sendCountWeekly: 0,
        sendCountMonthly: 0,
        lastSentAt: null,
        nextSendAt: new Date(nowMs + DAILY_INTERVAL_MS).toISOString(),
        firstOutstandingAt: now.toISOString(),
      },
    };
  }

  // Not time yet
  if (state.nextSendAt && nowMs < new Date(state.nextSendAt).getTime()) {
    return { shouldSend: false, nextState: state };
  }

  // Resolve current cadence, defaulting to 'daily' for legacy states
  const cadence = state.cadence || 'daily';
  const sendCountDaily =
    state.sendCountDaily ??
    (cadence === 'daily' ? state.sendCount || 0 : DAILY_SENDS_BEFORE_WEEKLY);
  const sendCountWeekly =
    state.sendCountWeekly ??
    (cadence === 'weekly'
      ? state.sendCount || 0
      : cadence === 'monthly'
        ? WEEKLY_SENDS_BEFORE_MONTHLY
        : 0);
  const sendCountMonthly =
    state.sendCountMonthly ??
    (cadence === 'monthly'
      ? (state.sendCount || 1) - DAILY_SENDS_BEFORE_WEEKLY - WEEKLY_SENDS_BEFORE_MONTHLY
      : 0);
  const firstOutstandingAt = state.firstOutstandingAt || now.toISOString();

  // Compute the new state after this send
  let newCadence;
  let newSendCountDaily = sendCountDaily;
  let newSendCountWeekly = sendCountWeekly;
  let newSendCountMonthly = sendCountMonthly;
  let nextIntervalMs;

  if (cadence === 'daily') {
    newSendCountDaily = sendCountDaily + 1;
    if (newSendCountDaily >= DAILY_SENDS_BEFORE_WEEKLY) {
      // Transition to weekly after completing the daily stage
      newCadence = 'weekly';
      nextIntervalMs = WEEKLY_INTERVAL_MS;
    } else {
      newCadence = 'daily';
      nextIntervalMs = DAILY_INTERVAL_MS;
    }
  } else if (cadence === 'weekly') {
    newSendCountWeekly = sendCountWeekly + 1;
    if (newSendCountWeekly >= WEEKLY_SENDS_BEFORE_MONTHLY) {
      // Transition to monthly after completing the weekly stage
      newCadence = 'monthly';
      nextIntervalMs = MONTHLY_INTERVAL_MS;
    } else {
      newCadence = 'weekly';
      nextIntervalMs = WEEKLY_INTERVAL_MS;
    }
  } else {
    // monthly — send indefinitely
    newCadence = 'monthly';
    newSendCountMonthly = sendCountMonthly + 1;
    nextIntervalMs = MONTHLY_INTERVAL_MS;
  }

  return {
    shouldSend: true,
    nextState: {
      cadence: newCadence,
      sendCountDaily: newSendCountDaily,
      sendCountWeekly: newSendCountWeekly,
      sendCountMonthly: newSendCountMonthly,
      lastSentAt: now.toISOString(),
      nextSendAt: new Date(nowMs + nextIntervalMs).toISOString(),
      firstOutstandingAt,
    },
  };
}

/**
 * Clear cadence state for a user who has no outstanding actions.
 * @param {Object} user - User document
 */
async function clearCadenceState(user) {
  if (user.actionPromptState) {
    await dbUnified.updateOne('users', { id: user.id }, { $unset: { actionPromptState: '' } });
  }
}

/**
 * Enumerate all verified supplier users with outstanding actions, respecting
 * global settings and per-user preferences.
 *
 * @returns {Promise<Array>} Array of { user, supplier, report }
 *   where report = { outstanding, completed, ragStatus, completionPercent }
 */
async function getSupplierActionItems() {
  const [settings, users, suppliers, packages] = await Promise.all([
    dbUnified.read('settings'),
    dbUnified.read('users'),
    dbUnified.read('suppliers'),
    dbUnified.read('packages'),
  ]);

  const globalSettings = settings || {};

  // Check master enable flag — must be explicitly true to prevent accidental sends
  const automationEnabled = globalSettings.emailAutomation?.actionPrompts?.enabled === true;
  if (!automationEnabled) {
    logger.info('[ActionPrompts] Global auto action prompts disabled — skipping');
    return [];
  }

  const results = [];

  for (const user of users) {
    // Only suppliers
    if (user.role !== 'supplier') {
      continue;
    }

    // Only verified users
    if (!user.verified) {
      continue;
    }

    // Check master user-level pref (missing == enabled)
    if (user.emailPrefs?.actionPrompts?.enabled === false) {
      continue;
    }

    // Find the supplier profile linked to this user
    const supplier = suppliers.find(s => s.ownerUserId === user.id);
    if (!supplier) {
      continue;
    }

    // Compute full report
    const report = computeFullReport(supplier, packages, globalSettings, user);

    if (report.outstanding.length === 0) {
      // No outstanding actions — clear state if any
      await clearCadenceState(user);
      continue;
    }

    results.push({ user, supplier, report });
  }

  return results;
}

/**
 * Update the actionPromptState for a user after a successful send.
 * @param {string} userId    - User ID
 * @param {Object} nextState - New state from evaluateCadence
 */
async function updateCadenceState(userId, nextState) {
  await dbUnified.updateOne('users', { id: userId }, { $set: { actionPromptState: nextState } });
}

module.exports = {
  getSupplierActionItems,
  computeActions,
  computeFullReport,
  evaluateCadence,
  clearCadenceState,
  updateCadenceState,
  REQUIRED_PROFILE_FIELDS,
  DAILY_SENDS_BEFORE_WEEKLY,
  WEEKLY_SENDS_BEFORE_MONTHLY,
  DAILY_INTERVAL_MS,
  WEEKLY_INTERVAL_MS,
  MONTHLY_INTERVAL_MS,
  // backwards-compat aliases
  INITIAL_DELAY_MS,
  SECOND_SEND_DELAY_MS,
  MONTHLY_DELAY_MS,
  ACTION_DEFINITIONS,
  COMPLETE_LABELS,
};
