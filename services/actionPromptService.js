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
 *  • FIRST reminder : 24 h after outstanding actions are first detected
 *  • WEEKLY follow-up: 7 days after the first reminder
 *  • MONTHLY entry  : 28 days after the weekly follow-up
 *  • ONGOING        : every 28 days thereafter
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
const { hasSupplierGalleryPhotos, hasSupplierPostcode } = require('./supplierProfileCompleteness');

// Required supplier profile fields for "complete profile" check.
// 'postcode' is a virtual entry — see missingProfileFields() — the dashboard
// never writes a field literally named `postcode`; it saves to `basePostcode`
// (or `venuePostcode` for the Venues category). Postcode matters here because
// it drives real search/discovery matching (supplierLocation.service.js), not
// just profile cosmetics — a supplier with a location but no postcode won't
// surface correctly in radius-based search.
const REQUIRED_PROFILE_FIELDS = ['name', 'description_short', 'location', 'postcode'];

// One send at each introductory stage before moving on.
const DAILY_SENDS_BEFORE_WEEKLY = 1;
const WEEKLY_SENDS_BEFORE_MONTHLY = 1;

// Cadence intervals.
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000; // First reminder after 24 hours
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // Then 7 days later
const MONTHLY_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000; // Then every 4 weeks
const FIRST_MONTHLY_INTERVAL_MS = MONTHLY_INTERVAL_MS; // First monthly-stage wait is also 28 days

// Keep these exported for backwards-compatibility with tests
const INITIAL_DELAY_MS = DAILY_INTERVAL_MS;
const SECOND_SEND_DELAY_MS = WEEKLY_INTERVAL_MS;
const MONTHLY_DELAY_MS = FIRST_MONTHLY_INTERVAL_MS;

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
      'Fill in your profile details — name, description, location and postcode — so customers can discover and trust your business, and find you in local search.',
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
 * Which of REQUIRED_PROFILE_FIELDS are missing on this supplier. Postcode is
 * checked specially since it isn't stored under its own name — mirrors the
 * same basePostcode/venuePostcode check in routes/supplier.js and
 * profile-health-widget.js so all three agree on what "has a postcode" means.
 *
 * @param {Object} supplier - Supplier document
 * @returns {string[]} Field names (or 'postcode') that are missing
 */
function missingProfileFields(supplier) {
  return REQUIRED_PROFILE_FIELDS.filter(field => {
    if (field === 'postcode') {
      return !hasSupplierPostcode(supplier);
    }
    return !supplier[field] || String(supplier[field]).trim() === '';
  });
}

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
    const missingFields = missingProfileFields(supplier);
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
  const hasPhotos = hasSupplierGalleryPhotos(supplier);
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
  const missingFields = missingProfileFields(supplier);
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
  const hasPhotos = hasSupplierGalleryPhotos(supplier);
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
 *  • No state:       do NOT send yet; schedule first email for 24 h from now
 *  • First send:     one reminder, then wait 7 days
 *  • Weekly send:    one follow-up, then wait 28 days
 *  • Monthly stage:  send every 28 days indefinitely
 *
 * Existing suppliers already part-way through the old 7-daily/4-weekly cadence
 * are normalised in memory before the due-time check, so deploying this policy
 * cannot cause one more daily/weekly email simply because an old nextSendAt was
 * already stored.
 *
 * @param {Object|undefined} state - Current actionPromptState from user document
 * @param {Date}             now   - Current timestamp
 * @param {Object}           [opts]
 * @param {boolean}          [opts.force=false] - Bypass the "not time yet" / first-detection
 *   delay (used by the admin "Send Now" action). Cadence progression still advances
 *   normally so the next automatic send is scheduled according to the reduced policy.
 * @returns {{ shouldSend: boolean, nextState: Object }}
 */
function evaluateCadence(state, now, opts = {}) {
  const { force = false } = opts;
  const nowMs = now.getTime();

  if (!state) {
    if (force) {
      // A forced first send counts as the one introductory/daily-stage email.
      // The next automatic reminder is therefore a week away, not tomorrow.
      return {
        shouldSend: true,
        nextState: {
          cadence: 'weekly',
          sendCountDaily: 1,
          sendCountWeekly: 0,
          sendCountMonthly: 0,
          lastSentAt: now.toISOString(),
          nextSendAt: new Date(nowMs + WEEKLY_INTERVAL_MS).toISOString(),
          firstOutstandingAt: now.toISOString(),
        },
      };
    }
    // First outstanding detection — do NOT send immediately.
    // Schedule the first and only daily-stage email for 24 h from now.
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

  // Resolve current cadence and counters before checking nextSendAt so records
  // created under the old 7-daily/4-weekly policy are immediately throttled.
  let cadence = state.cadence || 'daily';
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
      ? Math.max(
          0,
          (state.sendCount || 1) - DAILY_SENDS_BEFORE_WEEKLY - WEEKLY_SENDS_BEFORE_MONTHLY
        )
      : 0);
  const firstOutstandingAt = state.firstOutstandingAt || now.toISOString();

  const lastSentMs = state.lastSentAt ? Date.parse(state.lastSentAt) : NaN;
  let effectiveNextSendAt = state.nextSendAt;

  // Migrate old cadence state without sending an extra reminder. A supplier
  // who already received at least one daily-stage email now waits a week;
  // one who already received a weekly-stage email waits 28 days.
  if (cadence === 'daily' && sendCountDaily >= DAILY_SENDS_BEFORE_WEEKLY) {
    cadence = 'weekly';
    if (Number.isFinite(lastSentMs)) {
      effectiveNextSendAt = new Date(lastSentMs + WEEKLY_INTERVAL_MS).toISOString();
    }
  }

  if (cadence === 'weekly' && sendCountWeekly >= WEEKLY_SENDS_BEFORE_MONTHLY) {
    cadence = 'monthly';
    if (Number.isFinite(lastSentMs)) {
      effectiveNextSendAt = new Date(lastSentMs + FIRST_MONTHLY_INTERVAL_MS).toISOString();
    }
  }

  // Once a supplier reaches the monthly stage, every remaining reminder is
  // spaced 28 days apart, including the first monthly-stage reminder.
  if (cadence === 'monthly' && Number.isFinite(lastSentMs)) {
    effectiveNextSendAt = new Date(lastSentMs + MONTHLY_INTERVAL_MS).toISOString();
  }

  const normalisedState = {
    ...state,
    cadence,
    sendCountDaily,
    sendCountWeekly,
    sendCountMonthly,
    nextSendAt: effectiveNextSendAt,
    firstOutstandingAt,
  };

  // Not time yet
  if (!force && effectiveNextSendAt && nowMs < new Date(effectiveNextSendAt).getTime()) {
    return { shouldSend: false, nextState: normalisedState };
  }

  // Compute the new state after this send
  let newCadence;
  let newSendCountDaily = sendCountDaily;
  let newSendCountWeekly = sendCountWeekly;
  let newSendCountMonthly = sendCountMonthly;
  let nextIntervalMs;

  if (cadence === 'daily') {
    newSendCountDaily = sendCountDaily + 1;
    if (newSendCountDaily >= DAILY_SENDS_BEFORE_WEEKLY) {
      // One introductory reminder is enough; next follow-up is a week away.
      newCadence = 'weekly';
      nextIntervalMs = WEEKLY_INTERVAL_MS;
    } else {
      newCadence = 'daily';
      nextIntervalMs = DAILY_INTERVAL_MS;
    }
  } else if (cadence === 'weekly') {
    newSendCountWeekly = sendCountWeekly + 1;
    if (newSendCountWeekly >= WEEKLY_SENDS_BEFORE_MONTHLY) {
      // One weekly follow-up is enough; next reminder is 28 days away.
      newCadence = 'monthly';
      nextIntervalMs = FIRST_MONTHLY_INTERVAL_MS;
    } else {
      newCadence = 'weekly';
      nextIntervalMs = WEEKLY_INTERVAL_MS;
    }
  } else {
    // Monthly — continue at a fixed 28-day interval.
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
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.ignoreGlobalEnabled=false] - Skip the master-enable gate.
 *   Used by dry runs so an admin can preview what *would* send while the
 *   automation is still switched off — a dry run never calls the mail
 *   provider (see sendActionPromptEmail's dryRun branch), so bypassing the
 *   gate here cannot cause a real send.
 */
async function getSupplierActionItems({ ignoreGlobalEnabled = false } = {}) {
  const [settings, users, suppliers, packages] = await Promise.all([
    dbUnified.read('settings'),
    dbUnified.read('users'),
    dbUnified.read('suppliers'),
    dbUnified.read('packages'),
  ]);

  const globalSettings = settings || {};

  // Check master enable flag — must be explicitly true to prevent accidental sends
  const automationEnabled = globalSettings.emailAutomation?.actionPrompts?.enabled === true;
  if (!automationEnabled && !ignoreGlobalEnabled) {
    logger.info('[ActionPrompts] Global auto action prompts disabled — skipping');
    return [];
  }

  const results = [];

  for (const user of users) {
    // Only suppliers
    if (user.role !== 'supplier') {
      continue;
    }

    // Only verified users. `verified` is the canonical field, but tolerate
    // `emailVerified`-only records (e.g. pre-existing accounts from before
    // the two fields were consolidated onto a single write path).
    if (!user.verified && !user.emailVerified) {
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
  missingProfileFields,
  hasGalleryPhotos: hasSupplierGalleryPhotos,
  DAILY_SENDS_BEFORE_WEEKLY,
  WEEKLY_SENDS_BEFORE_MONTHLY,
  DAILY_INTERVAL_MS,
  WEEKLY_INTERVAL_MS,
  FIRST_MONTHLY_INTERVAL_MS,
  MONTHLY_INTERVAL_MS,
  // backwards-compat aliases
  INITIAL_DELAY_MS,
  SECOND_SEND_DELAY_MS,
  MONTHLY_DELAY_MS,
  ACTION_DEFINITIONS,
  COMPLETE_LABELS,
};