/**
 * Analytics window helpers
 *
 * Every supplier analytics endpoint takes a "how many days" query parameter and
 * must apply the same two rules to it: the request is bounded (so a hostile or
 * careless value can never make the server loop for a billion days), and the
 * result is limited to what the supplier's plan entitles them to see
 * (`analyticsWindowDays` in the plan matrix: Starter 7, Professional 90,
 * Professional Plus 365). Keeping that logic here means the dashboard summary,
 * `/api/supplier/analytics` and `/api/me/suppliers/:id/analytics` cannot drift
 * apart again.
 */

'use strict';

/** Longest window any dashboard-style request may ask for. */
const MAX_REQUEST_DAYS = 90;

/** Window used when the plan matrix does not define one (the Starter value). */
const FALLBACK_PLAN_WINDOW_DAYS = 7;

const WHOLE_NUMBER_PATTERN = /^\d{1,9}$/;

/**
 * Parse a raw `days` / `period` query value.
 *
 * Only plain non-negative whole numbers are valid; "7.5", "1e9", "-3", "abc" and
 * repeated parameters (which Express turns into arrays) are reported as invalid
 * rather than being silently coerced.
 *
 * @param {*} raw - Raw query-string value
 * @returns {{provided: boolean, valid: boolean, value: number|null}} Parse result
 */
function parseDaysParam(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { provided: false, valid: true, value: null };
  }
  if (typeof raw !== 'string' || !WHOLE_NUMBER_PATTERN.test(raw.trim())) {
    return { provided: true, valid: false, value: null };
  }
  return { provided: true, valid: true, value: parseInt(raw.trim(), 10) };
}

/**
 * Resolve the window a request will actually be served.
 *
 * @param {Object} params - Window inputs
 * @param {number|null} [params.requested] - Whole number of days asked for, if any
 * @param {number} params.defaultDays - Days to use when nothing valid was asked for
 * @param {number} [params.planWindowDays] - Plan entitlement in days (negative = unlimited)
 * @param {number} [params.requestCap] - Longest window this endpoint will ever serve
 * @returns {{days: number, maxDays: number, requestedDays: number}} Resolved window.
 *   `requestedDays` is the (capped) value that was asked for, `maxDays` the longest
 *   window this supplier can be served, `days` what will actually be served.
 */
function resolveAnalyticsWindow({
  requested = null,
  defaultDays,
  planWindowDays,
  requestCap = MAX_REQUEST_DAYS,
}) {
  const cap = Math.max(1, Math.floor(requestCap));
  const asked = Number.isFinite(requested) ? requested : defaultDays;
  const requestedDays = Math.min(Math.max(1, Math.floor(asked)), cap);

  let planDays = FALLBACK_PLAN_WINDOW_DAYS;
  if (Number.isFinite(planWindowDays)) {
    planDays = planWindowDays < 0 ? cap : Math.max(1, Math.floor(planWindowDays));
  }
  const maxDays = Math.min(planDays, cap);

  return { days: Math.min(requestedDays, maxDays), maxDays, requestedDays };
}

module.exports = {
  MAX_REQUEST_DAYS,
  FALLBACK_PLAN_WINDOW_DAYS,
  parseDaysParam,
  resolveAnalyticsWindow,
};
