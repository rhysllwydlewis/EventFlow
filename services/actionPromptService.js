/**
 * Action Prompt Service
 * Detects outstanding actions for supplier users and manages cadence escalation.
 *
 * Outstanding actions detected:
 *  1. missingPackages  — supplier has 0 packages
 *  2. incompleteProfile — supplier profile missing required fields
 *
 * Cadence escalation (per-supplier while actions remain outstanding):
 *  Start → daily, after 7 daily sends → weekly, after 4 weekly sends → monthly.
 *  Cadence resets when all actions are cleared.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

// Required supplier profile fields for "complete profile" check
const REQUIRED_PROFILE_FIELDS = ['name', 'description_short', 'location', 'email'];

// Cadence thresholds
const DAILY_TO_WEEKLY_THRESHOLD = 7; // sends
const WEEKLY_TO_MONTHLY_THRESHOLD = 4; // sends

// Gap in milliseconds for each cadence stage
const CADENCE_GAP_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Compute outstanding action items for a single supplier.
 * @param {Object} supplier  - Supplier document
 * @param {Array}  packages  - All packages in the system
 * @param {Object} settings  - Global email-automation settings
 * @param {Object} user      - User document
 * @returns {Array} Array of action objects { key, title, description, ctaUrl }
 */
function computeActions(supplier, packages, settings, user) {
  const actions = [];
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
  const promptTypes = settings.emailAutomation?.actionPrompts?.promptTypes || {};

  // Resolve per-user pref helper (missing == true / default ON)
  const userPrefs = user?.emailPrefs?.actionPrompts || {};
  const userMissingPkgPref = userPrefs.missingPackages !== false;
  const userIncompleteProfilePref = userPrefs.incompleteProfile !== false;

  // 1. Missing packages
  const globalMissingPkg = promptTypes.missingPackages !== false;
  if (globalMissingPkg && userMissingPkgPref) {
    const supplierPackages = packages.filter(p => p.supplierId === supplier.id);
    if (supplierPackages.length === 0) {
      actions.push({
        key: 'missingPackages',
        title: 'Create your first package',
        description:
          'Attract more customers by adding at least one service package to your profile.',
        ctaUrl: `${baseUrl}/dashboard/supplier`,
      });
    }
  }

  // 2. Incomplete profile
  const globalIncompleteProfile = promptTypes.incompleteProfile !== false;
  if (globalIncompleteProfile && userIncompleteProfilePref) {
    const missingFields = REQUIRED_PROFILE_FIELDS.filter(
      field => !supplier[field] || String(supplier[field]).trim() === ''
    );
    if (missingFields.length > 0) {
      actions.push({
        key: 'incompleteProfile',
        title: 'Complete your supplier profile',
        description: 'Finish filling in your profile details so customers can find and trust you.',
        ctaUrl: `${baseUrl}/dashboard/supplier`,
      });
    }
  }

  return actions;
}

/**
 * Determine whether it is time to send based on the supplier's current cadence state.
 * Also returns the updated state to persist after a successful send.
 *
 * @param {Object|undefined} state - Current actionPromptState from user document
 * @param {Date}             now   - Current timestamp
 * @returns {{ shouldSend: boolean, nextState: Object }}
 */
function evaluateCadence(state, now) {
  const nowMs = now.getTime();

  if (!state) {
    // No state — first time; start at daily
    return {
      shouldSend: true,
      nextState: {
        cadence: 'daily',
        dailySendsCount: 1,
        weeklySendsCount: 0,
        lastSentAt: now.toISOString(),
        nextSendAt: new Date(nowMs + CADENCE_GAP_MS.daily).toISOString(),
        firstOutstandingAt: now.toISOString(),
      },
    };
  }

  // Check if it's time yet
  if (state.nextSendAt && nowMs < new Date(state.nextSendAt).getTime()) {
    return { shouldSend: false, nextState: state };
  }

  // It's time — update counts and cadence
  const { cadence, dailySendsCount = 0, weeklySendsCount = 0 } = state;
  let newCadence = cadence || 'daily';
  let newDailyCount = dailySendsCount;
  let newWeeklyCount = weeklySendsCount;

  if (newCadence === 'daily') {
    newDailyCount += 1;
    if (newDailyCount >= DAILY_TO_WEEKLY_THRESHOLD) {
      newCadence = 'weekly';
      newWeeklyCount = 1; // this send counts as the first weekly send
    }
  } else if (newCadence === 'weekly') {
    newWeeklyCount += 1;
    if (newWeeklyCount >= WEEKLY_TO_MONTHLY_THRESHOLD) {
      newCadence = 'monthly';
    }
  }
  // monthly stays monthly

  const nextState = {
    cadence: newCadence,
    dailySendsCount: newCadence === 'daily' ? newDailyCount : dailySendsCount,
    weeklySendsCount: newCadence === 'weekly' ? newWeeklyCount : weeklySendsCount,
    lastSentAt: now.toISOString(),
    nextSendAt: new Date(nowMs + CADENCE_GAP_MS[newCadence]).toISOString(),
    firstOutstandingAt: state.firstOutstandingAt || now.toISOString(),
  };

  return { shouldSend: true, nextState };
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
 * @returns {Promise<Array>} Array of { user, supplier, actions, cadenceState }
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

    // Compute actions
    const actions = computeActions(supplier, packages, globalSettings, user);

    if (actions.length === 0) {
      // No outstanding actions — clear state if any
      await clearCadenceState(user);
      continue;
    }

    results.push({ user, supplier, actions });
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
  evaluateCadence,
  clearCadenceState,
  updateCadenceState,
  REQUIRED_PROFILE_FIELDS,
  DAILY_TO_WEEKLY_THRESHOLD,
  WEEKLY_TO_MONTHLY_THRESHOLD,
  CADENCE_GAP_MS,
};
