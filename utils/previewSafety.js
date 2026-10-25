/**
 * Preview-environment safety guard.
 *
 * Railway creates a throw-away environment for every pull request, named like `EventFlow-pr-1839`.
 * A preview was once seen running with LIVE Stripe keys and sending REAL email, because it inherited
 * the production variables. This module makes that impossible in code, whatever the variables say:
 *
 *   - In a PR preview, a live Stripe secret key (sk_live_ / rk_live_) is never used. Stripe is treated
 *     as not configured and billing answers "billing is disabled in preview environments".
 *     A test key (sk_test_) is fine.
 *   - In a PR preview, no real email is sent unless every recipient is on MAIL_PREVIEW_ALLOWLIST.
 *     Everything else goes to the local outbox fallback, which stores metadata only.
 *
 * Outside a PR preview (production, staging, local development, tests, anything that does not match
 * the pattern below) every function here is a pass-through, so behaviour is unchanged.
 *
 * Also owns the rule for when the local outbox fallback may keep a full email body
 * (EVENTFLOW_OUTBOX_FULL=1 in development, or NODE_ENV=test), see isFullOutboxAllowed().
 *
 * See docs/PREVIEW_ENVIRONMENTS.md.
 */

'use strict';

const logger = require('./logger');

/**
 * The only environment names treated as a PR preview: `EventFlow-pr-` followed by digits, nothing
 * else, matched against the whole name (so `EventFlow-pr-12x`, `production`, `EventFlow-pr-`,
 * `my-EventFlow-pr-5` and `EventFlow-pr-5-staging` all fail). Case-insensitive because Railway
 * names are user-editable and `eventflow-pr-5` is plainly the same intent.
 */
const PREVIEW_ENV_NAME_PATTERN = /^EventFlow-pr-\d+$/i;

/**
 * The Railway environment name. RAILWAY_ENVIRONMENT_NAME is authoritative; RAILWAY_ENVIRONMENT (set
 * to the same name by Railway) is only consulted when the first is missing entirely.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {string|undefined} The name, or undefined when not running on Railway
 */
function getEnvironmentName(env = process.env) {
  if (typeof env.RAILWAY_ENVIRONMENT_NAME === 'string') {
    return env.RAILWAY_ENVIRONMENT_NAME;
  }
  return typeof env.RAILWAY_ENVIRONMENT === 'string' ? env.RAILWAY_ENVIRONMENT : undefined;
}

/**
 * True only when running in a Railway PR preview environment.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {boolean}
 */
function isPreviewEnvironment(env = process.env) {
  const name = getEnvironmentName(env);
  return typeof name === 'string' && PREVIEW_ENV_NAME_PATTERN.test(name);
}

// ---------------------------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------------------------

const BILLING_DISABLED_MESSAGE =
  'Billing is disabled in preview environments. Give this preview a Stripe test key (sk_test_...) to try payments.';

/**
 * True for a live-mode Stripe secret or restricted key.
 * @param {*} key - Candidate key
 * @returns {boolean}
 */
function isLiveStripeKey(key) {
  return typeof key === 'string' && /^(sk|rk)_live_/.test(key.trim());
}

let stripeBlockLogged = false;

/**
 * The Stripe key that is safe to use: the given key, or '' (not configured) when this is a PR
 * preview and the key is a live key. Pass-through everywhere else.
 * @param {string} [key] - Raw key (defaults to env.STRIPE_SECRET_KEY)
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {string} The key, or '' / undefined exactly as given when nothing is blocked
 */
function getSafeStripeKey(key, env = process.env) {
  if (isPreviewEnvironment(env) && isLiveStripeKey(key)) {
    if (!stripeBlockLogged) {
      stripeBlockLogged = true;
      logger.warn(
        `[preview-safety] ${getEnvironmentName(env)} is a PR preview but has a LIVE Stripe key. ` +
          'Stripe is DISABLED here; billing answers "disabled in preview environments". ' +
          'Set STRIPE_SECRET_KEY to an sk_test_ key on this preview to try payments.'
      );
    }
    return '';
  }
  return key;
}

/**
 * Safe version of process.env.STRIPE_SECRET_KEY.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {string|undefined}
 */
function getSafeStripeSecretKey(env = process.env) {
  return getSafeStripeKey(env.STRIPE_SECRET_KEY, env);
}

/**
 * Safe version of the billing alias key (STRIPE_SECRET_KEY, else STRIPE_SECRET_KEY_LIVE).
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {string}
 */
function getSafeBillingStripeKey(env = process.env) {
  return getSafeStripeKey(env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY_LIVE || '', env);
}

/**
 * True when billing is off specifically because this is a preview that was handed a live key.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {boolean}
 */
function isBillingBlockedByPreview(env = process.env) {
  return (
    isPreviewEnvironment(env) &&
    (isLiveStripeKey(env.STRIPE_SECRET_KEY) || isLiveStripeKey(env.STRIPE_SECRET_KEY_LIVE))
  );
}

/**
 * JSON body for a 503 from a billing endpoint that cannot run. In a preview that blocked a live key
 * it explains why; otherwise it is the caller's usual body, unchanged.
 * @param {Object} usualBody - What the endpoint answered before this guard existed
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {Object}
 */
function billingUnavailableBody(usualBody, env = process.env) {
  if (isBillingBlockedByPreview(env)) {
    return {
      error: 'Billing is disabled in preview environments',
      message: BILLING_DISABLED_MESSAGE,
      previewDisabled: true,
    };
  }
  return usualBody;
}

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

/**
 * Every plain address in a `to` value: a string, an array, a comma-separated list, or the
 * `Name <addr@host>` form. Lower-cased and trimmed; empty pieces dropped.
 * @param {string|string[]} to - Recipient(s)
 * @returns {string[]}
 */
function extractAddresses(to) {
  const pieces = (Array.isArray(to) ? to : [to])
    .filter(piece => typeof piece === 'string')
    .flatMap(piece => piece.split(','));
  return pieces
    .map(piece => {
      const trimmed = piece.trim();
      const angle = trimmed.match(/<([^<>]*)>\s*$/);
      return (angle ? angle[1] : trimmed).trim().toLowerCase();
    })
    .filter(Boolean);
}

/**
 * Parse MAIL_PREVIEW_ALLOWLIST: comma/semicolon/space separated entries, each either a full address
 * (`reviewer@example.com`) or a domain (`example.com` or `@example.com`, exact domain only, not
 * its subdomains). Anything with a wildcard is ignored rather than guessed at.
 * @param {string} [raw] - The variable's value
 * @returns {{addresses: Set<string>, domains: Set<string>}}
 */
function parseMailAllowlist(raw) {
  const addresses = new Set();
  const domains = new Set();
  String(raw || '')
    .split(/[\s,;]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry && !entry.includes('*'))
    .forEach(entry => {
      if (entry.startsWith('@')) {
        if (entry.length > 1) {
          domains.add(entry.slice(1));
        }
      } else if (entry.includes('@')) {
        addresses.add(entry);
      } else {
        domains.add(entry);
      }
    });
  return { addresses, domains };
}

/**
 * Whether one address is on the allowlist.
 * @param {string} address - Plain, lower-cased address
 * @param {{addresses: Set<string>, domains: Set<string>}} allowlist - Parsed allowlist
 * @returns {boolean}
 */
function isAddressAllowed(address, allowlist) {
  if (allowlist.addresses.has(address)) {
    return true;
  }
  const at = address.lastIndexOf('@');
  return at > 0 && allowlist.domains.has(address.slice(at + 1));
}

/**
 * Decide whether a send must be kept off the wire. Never suppresses outside a PR preview. In a
 * preview it suppresses unless there is at least one recipient and every recipient is allowlisted
 * (if any recipient is not allowed, the whole send is suppressed: no partial delivery).
 * @param {string|string[]} to - Recipient(s)
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {{suppress: boolean, reason: string|null}}
 */
function evaluateMailPolicy(to, env = process.env) {
  if (!isPreviewEnvironment(env)) {
    return { suppress: false, reason: null };
  }
  const allowlist = parseMailAllowlist(env.MAIL_PREVIEW_ALLOWLIST);
  const recipients = extractAddresses(to);
  if (recipients.length === 0) {
    return { suppress: true, reason: 'no valid recipient in a preview environment' };
  }
  if (allowlist.addresses.size === 0 && allowlist.domains.size === 0) {
    return {
      suppress: true,
      reason: 'preview environment with no MAIL_PREVIEW_ALLOWLIST: real email is never sent',
    };
  }
  if (recipients.every(address => isAddressAllowed(address, allowlist))) {
    return { suppress: false, reason: null };
  }
  return {
    suppress: true,
    reason: 'a recipient is not on MAIL_PREVIEW_ALLOWLIST: real email is not sent from a preview',
  };
}

/**
 * May the local outbox fallback keep the full email (body, links, the text a user typed)?
 * Only in development with EVENTFLOW_OUTBOX_FULL=1 (or true), or when NODE_ENV is "test" (the
 * browser tests read the verification link from the outbox). Never in production and never in a PR
 * preview, whatever the switch says.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {boolean}
 */
function isFullOutboxAllowed(env = process.env) {
  if (env.NODE_ENV === 'production' || isPreviewEnvironment(env)) {
    return false;
  }
  if (env.NODE_ENV === 'test') {
    return true;
  }
  return /^(1|true)$/i.test(String(env.EVENTFLOW_OUTBOX_FULL || '').trim());
}

// ---------------------------------------------------------------------------------------------
// Start-up report
// ---------------------------------------------------------------------------------------------

let startupLogged = false;

/**
 * Log the preview-safety state once at start-up. Silent outside a PR preview.
 * @param {Object} [env] - Environment variables (defaults to process.env)
 * @returns {Object|null} What was reported, or null when not a preview / already logged
 */
function logPreviewSafetyOnce(env = process.env) {
  if (startupLogged || !isPreviewEnvironment(env)) {
    return null;
  }
  startupLogged = true;
  const allowlist = parseMailAllowlist(env.MAIL_PREVIEW_ALLOWLIST);
  const allowedCount = allowlist.addresses.size + allowlist.domains.size;
  const report = {
    environment: getEnvironmentName(env),
    stripe: isBillingBlockedByPreview(env)
      ? 'disabled (live key refused)'
      : env.STRIPE_SECRET_KEY
        ? 'enabled (non-live key)'
        : 'not configured',
    mail: allowedCount > 0 ? `allowlist of ${allowedCount} entries` : 'suppressed (metadata only)',
  };
  logger.warn(
    `[preview-safety] PR preview detected (${report.environment}). Stripe: ${report.stripe}. ` +
      `Email: ${report.mail}. See docs/PREVIEW_ENVIRONMENTS.md.`
  );
  return report;
}

/** Test helper: forget the "already logged" flags. */
function _resetForTests() {
  stripeBlockLogged = false;
  startupLogged = false;
}

module.exports = {
  PREVIEW_ENV_NAME_PATTERN,
  BILLING_DISABLED_MESSAGE,
  getEnvironmentName,
  isPreviewEnvironment,
  isLiveStripeKey,
  getSafeStripeKey,
  getSafeStripeSecretKey,
  getSafeBillingStripeKey,
  isBillingBlockedByPreview,
  billingUnavailableBody,
  extractAddresses,
  parseMailAllowlist,
  evaluateMailPolicy,
  isFullOutboxAllowed,
  logPreviewSafetyOnce,
  _resetForTests,
};
