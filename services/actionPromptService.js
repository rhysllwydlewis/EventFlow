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
 *  • Email 1: 1 day  after first outstanding detection
 *  • Email 2: 1 week after first outstanding detection
 *  • Email 3+: every 30 days (monthly) from last send
 *  Cadence resets when all actions are cleared.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

// Required supplier profile fields for "complete profile" check
const REQUIRED_PROFILE_FIELDS = ['name', 'description_short', 'location', 'email'];

// Cadence timing
const INITIAL_DELAY_MS = 24 * 60 * 60 * 1000; // 1 day  — first email
const SECOND_SEND_DELAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — second email (from firstOutstandingAt)
const MONTHLY_DELAY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — subsequent emails

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
 *  • No state:           do NOT send yet; schedule first email for 1 day from now
 *  • sendCount === 0:    send now; next email at firstOutstandingAt + 7 days
 *  • sendCount === 1:    send now; next email at lastSentAt + 30 days
 *  • sendCount >= 2:     send now; next email at lastSentAt + 30 days (monthly)
 *
 * @param {Object|undefined} state - Current actionPromptState from user document
 * @param {Date}             now   - Current timestamp
 * @returns {{ shouldSend: boolean, nextState: Object }}
 */
function evaluateCadence(state, now) {
  const nowMs = now.getTime();

  if (!state) {
    // First outstanding detection — do NOT send immediately.
    // Schedule the first email for 1 day from now.
    return {
      shouldSend: false,
      nextState: {
        sendCount: 0,
        lastSentAt: null,
        nextSendAt: new Date(nowMs + INITIAL_DELAY_MS).toISOString(),
        firstOutstandingAt: now.toISOString(),
      },
    };
  }

  // Not time yet
  if (state.nextSendAt && nowMs < new Date(state.nextSendAt).getTime()) {
    return { shouldSend: false, nextState: state };
  }

  // Time to send — compute updated state
  const sendCount = state.sendCount || 0;
  const newSendCount = sendCount + 1;
  const firstMs = new Date(state.firstOutstandingAt || state.nextSendAt).getTime();

  let nextSendAt;
  let cadenceLabel;

  if (newSendCount === 1) {
    // After 1st send (day 1) → next is 1 week from firstOutstandingAt
    nextSendAt = new Date(firstMs + SECOND_SEND_DELAY_MS).toISOString();
    cadenceLabel = 'weekly';
  } else {
    // After 2nd send and beyond → monthly
    nextSendAt = new Date(nowMs + MONTHLY_DELAY_MS).toISOString();
    cadenceLabel = 'monthly';
  }

  return {
    shouldSend: true,
    nextState: {
      sendCount: newSendCount,
      cadence: cadenceLabel,
      lastSentAt: now.toISOString(),
      nextSendAt,
      firstOutstandingAt: state.firstOutstandingAt || now.toISOString(),
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
  INITIAL_DELAY_MS,
  SECOND_SEND_DELAY_MS,
  MONTHLY_DELAY_MS,
  ACTION_DEFINITIONS,
  COMPLETE_LABELS,
};
