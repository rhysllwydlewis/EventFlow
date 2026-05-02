'use strict';

function getUserDisplayName(user = {}, fallback = 'User') {
  const first = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const last = typeof user.lastName === 'string' ? user.lastName.trim() : '';
  const fullName = `${first} ${last}`.trim();
  if (fullName) {
    return fullName;
  }

  const candidates = [user.name, user.displayName, user.businessName, user.email];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallback;
}

module.exports = { getUserDisplayName };
