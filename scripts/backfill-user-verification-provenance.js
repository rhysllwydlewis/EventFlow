#!/usr/bin/env node
'use strict';

const dbUnified = require('../db-unified');
const userProvenance = require('../services/userProvenance.service');

const UNKNOWN = new Set([undefined, null, '', 'unknown']);
function missing(value) {
  return UNKNOWN.has(value);
}
function setIfMissing(updates, user, field, value) {
  if (missing(user[field])) {
    updates[field] = value;
  }
}
function setObjectIfMissing(updates, user, field, value) {
  if (!user[field] || typeof user[field] !== 'object' || missing(user[field].type)) {
    updates[field] = value;
  }
}

function buildBackfillUpdates(user) {
  const updates = {};
  const nowIso = new Date().toISOString();
  const hasGoogle = userProvenance.hasGoogleLink(user) || user.authProvider === 'google';

  if (user.isOwner) {
    setIfMissing(updates, user, 'signupMethod', 'owner_seed');
    setIfMissing(updates, user, 'authProvider', user.authProvider || 'local');
    if (user.verificationMethod !== 'owner_account') {
      updates.verificationMethod = 'owner_account';
    }
    if (user.emailDeliveryStatus !== 'not_required') {
      updates.emailDeliveryStatus = 'not_required';
    }
    if (!user.verifiedAt) {
      updates.verifiedAt = user.createdAt || nowIso;
    }
    setObjectIfMissing(updates, user, 'verifiedBy', {
      type: 'owner',
      reason: 'Owner/system account does not require email verification',
    });
    return updates;
  }

  if (hasGoogle) {
    setIfMissing(updates, user, 'signupMethod', 'google');
    if (missing(user.authProvider) || (user.passwordHash && user.authProvider !== 'mixed')) {
      updates.authProvider = user.passwordHash ? 'mixed' : 'google';
    }
    if (missing(user.verificationMethod)) {
      updates.verificationMethod = 'google_verified_email';
    }
    if (user.verified !== true) {
      updates.verified = true;
    }
    if (!user.verifiedAt) {
      updates.verifiedAt = user.googleLinkedAt || user.createdAt || nowIso;
    }
    setObjectIfMissing(updates, user, 'verifiedBy', {
      type: 'google',
      provider: 'google',
      reason: 'Google ID token email_verified=true',
    });
    setIfMissing(updates, user, 'emailDeliveryStatus', 'not_required');
    return updates;
  }

  if (user.createdBy && user.verified === true) {
    setIfMissing(updates, user, 'signupMethod', 'admin_created');
    setIfMissing(updates, user, 'authProvider', 'admin');
    if (missing(user.verificationMethod)) {
      updates.verificationMethod = 'admin_created';
    }
    if (!user.verifiedAt) {
      updates.verifiedAt = user.createdAt || nowIso;
    }
    setObjectIfMissing(updates, user, 'verifiedBy', {
      type: 'admin',
      userId: user.createdBy,
      reason: 'Created by admin',
    });
    setIfMissing(updates, user, 'emailDeliveryStatus', 'not_required');
    return updates;
  }

  if (user.verified === true) {
    setIfMissing(updates, user, 'signupMethod', 'email_password');
    setIfMissing(updates, user, 'authProvider', user.passwordHash ? 'local' : 'unknown');
    if (missing(user.verificationMethod)) {
      updates.verificationMethod = 'unknown';
    }
    setIfMissing(updates, user, 'emailDeliveryStatus', 'unknown');
    return updates;
  }

  setIfMissing(updates, user, 'signupMethod', 'email_password');
  setIfMissing(updates, user, 'authProvider', 'local');
  if (missing(user.verificationMethod)) {
    updates.verificationMethod = 'pending';
  }
  setIfMissing(updates, user, 'emailDeliveryStatus', 'pending');
  return updates;
}

async function run({ apply = false } = {}) {
  const users = await dbUnified.read('users');
  const changes = [];
  for (const user of users || []) {
    const updates = buildBackfillUpdates(user);
    if (Object.keys(updates).length) {
      changes.push({
        id: user.id || (user._id ? String(user._id) : null),
        email: user.email,
        updates,
      });
      if (apply) {
        await dbUnified.updateOne('users', { id: user.id }, { $set: updates });
      }
    }
  }
  return {
    dryRun: !apply,
    checkedUsers: (users || []).length,
    changedUsers: changes.length,
    changes,
  };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  run({ apply })
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { buildBackfillUpdates, run };
