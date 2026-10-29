/**
 * One-off cleanup: remove credentials from the edit history stored on user records.
 *
 * Every admin edit of a user keeps a copy of the record as it was ("versionHistory"). Before the
 * admin safety fixes that copy included the password hash, verification and reset tokens and 2FA
 * secrets, and it was returned to the browser and written into data exports. New edits no longer
 * store those fields; this removes them from the entries saved earlier.
 *
 * Usage:
 *   node scripts/strip-user-history-secrets.js            (dry run: reports what would change)
 *   node scripts/strip-user-history-secrets.js --apply    (writes the cleaned history)
 *
 * It only ever rewrites `versionHistory`, never any other field, and it prints counts only,
 * never the values it removes. Safe to run more than once.
 */

'use strict';

const { stripSecretFields } = require('../utils/adminExportSanitizer');

/**
 * A copy of an edit history with credentials removed from every saved snapshot.
 * @param {Array<Object>} history - A user's versionHistory
 * @returns {Array<Object>} Cleaned history (the input is not changed)
 */
function cleanHistory(history) {
  return history.map(entry =>
    entry && typeof entry === 'object' && entry.previousState
      ? { ...entry, previousState: stripSecretFields(entry.previousState) }
      : entry
  );
}

/**
 * The users whose history holds credentials, with the cleaned history for each.
 * @param {Array<Object>} users - All users
 * @returns {Array<{id: string, versionHistory: Array<Object>}>} Users that need cleaning
 */
function findHistoriesToClean(users) {
  const dirty = [];
  for (const user of users) {
    if (!user || !Array.isArray(user.versionHistory) || user.versionHistory.length === 0) {
      continue;
    }
    const cleaned = cleanHistory(user.versionHistory);
    if (JSON.stringify(cleaned) !== JSON.stringify(user.versionHistory)) {
      dirty.push({ id: user.id, versionHistory: cleaned });
    }
  }
  return dirty;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  const dbUnified = require('../db-unified');

  const users = (await dbUnified.read('users')) || [];
  const dirty = findHistoriesToClean(users);
  console.log(
    `${users.length} users checked, ${dirty.length} have credentials in their edit history.`
  );

  if (!apply) {
    console.log(
      dirty.length
        ? 'Dry run: nothing written. Re-run with --apply to clean them.'
        : 'Nothing to do.'
    );
    return 0;
  }

  let failed = 0;
  for (const { id, versionHistory } of dirty) {
    try {
      const saved = await dbUnified.updateOne(
        'users',
        { id },
        { $set: { versionHistory } },
        { throwOnError: true }
      );
      if (!saved) {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  console.log(`Cleaned ${dirty.length - failed} users${failed ? `, ${failed} failed` : ''}.`);
  return failed ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Cleanup failed:', error.message);
      process.exit(1);
    });
}

module.exports = { cleanHistory, findHistoriesToClean };
