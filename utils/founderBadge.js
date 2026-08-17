'use strict';

// FOUNDER_LAUNCH_TS marks the start of the launch window; the founder badge
// is awarded to accounts created within 6 months of it. Kept in one place so
// every signup path (email/password, Google, Apple, Facebook) agrees on the
// same window instead of drifting out of sync with each other.
function isWithinFounderWindow(now = new Date()) {
  const founderLaunchTs = process.env.FOUNDER_LAUNCH_TS || '2026-01-01T00:00:00Z';
  const founderLaunchDate = new Date(founderLaunchTs);
  const founderEndDate = new Date(founderLaunchDate);
  founderEndDate.setUTCMonth(founderEndDate.getUTCMonth() + 6);
  return now <= founderEndDate;
}

function getFounderSignupBadges(now = new Date()) {
  return isWithinFounderWindow(now) ? ['founder'] : [];
}

module.exports = {
  isWithinFounderWindow,
  getFounderSignupBadges,
};
