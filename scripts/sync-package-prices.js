/**
 * Make every package hold one price in both price fields (and report what it would change).
 *
 * A package carries its price in `price` (suppliers edit it) and `price_display` (the admin screens
 * edit it, and the public pages show it first). Edits made before utils/packagePrice.js could leave
 * the two different, so a supplier and the public site disagreed. This sets both to the price the
 * site currently shows, `packagePriceText(pkg)`, so running it never changes a price a customer sees;
 * it only brings the other field into line.
 *
 * Dry run by default: nothing is modified unless `--apply` is passed. As with the other
 * maintenance scripts, `--apply` refuses to run unless the active backend is a healthy MongoDB
 * connection (a local fallback file is not what is being served), and the report names the backend
 * it read from.
 *
 *   node scripts/sync-package-prices.js            # report
 *   node scripts/sync-package-prices.js --apply    # fix
 */
'use strict';

const dbUnified = require('../db-unified');
const db = require('../db');
const { packagePriceText, priceFields } = require('../utils/packagePrice');

/** The only backend an --apply run may modify. */
const REQUIRED_BACKEND = 'mongodb';

/** Exit codes, so a runbook can tell the failures apart. */
const EXIT_CODES = { ok: 0, refused: 2 };

/**
 * Describe the backend actually in use, so a report against a local fallback file can never be
 * mistaken for one against production.
 *
 * @returns {Promise<{type: string, connected: boolean, state: string, error: (string|null)}>}
 */
async function resolveBackend() {
  try {
    await dbUnified.initializeDatabase();
    const status = (dbUnified.getDatabaseStatus && dbUnified.getDatabaseStatus()) || {};
    return {
      type: status.type || (dbUnified.getDatabaseType ? dbUnified.getDatabaseType() : 'unknown'),
      connected: Boolean(status.connected),
      state: status.state || 'unknown',
      error: status.error ? String(status.error.message || status.error) : null,
    };
  } catch (error) {
    return { type: 'unknown', connected: false, state: 'failed', error: error.message };
  }
}

/**
 * Work out what each package needs.
 *
 * @param {Object[]} packages - Package records
 * @returns {{needsFix: Array<{id: string, from: {price: *, price_display: *}, to: string}>, noPrice: string[], consistent: number}}
 */
function planPriceSync(packages) {
  const needsFix = [];
  const noPrice = [];
  let consistent = 0;
  packages.forEach(pkg => {
    const text = packagePriceText(pkg);
    if (!text) {
      noPrice.push(pkg.id);
      return;
    }
    if (pkg.price === text && pkg.price_display === text) {
      consistent += 1;
      return;
    }
    needsFix.push({
      id: pkg.id,
      from: { price: pkg.price, price_display: pkg.price_display },
      to: text,
    });
  });
  return { needsFix, noPrice, consistent };
}

/**
 * Report (and with `apply`, fix) packages whose two price fields differ or are missing.
 *
 * @param {Object} [options] - Options
 * @param {boolean} [options.apply] - Write the fixes
 * @param {Object} [options.backend] - Backend description (resolved when omitted)
 * @returns {Promise<Object>} Report
 */
async function syncPackagePrices(options = {}) {
  const apply = options.apply === true;
  const backend = options.backend || (await resolveBackend());
  if (apply && !(backend.type === REQUIRED_BACKEND && backend.connected)) {
    const error = new Error(
      `Refusing to --apply against backend "${backend.type}" (connected: ${backend.connected}). ` +
        'Package prices may only be changed in MongoDB.'
    );
    error.name = 'BackendPreconditionError';
    throw error;
  }

  const packages = (await dbUnified.read('packages')) || [];
  const plan = planPriceSync(packages);
  let updated = 0;
  if (apply) {
    for (const item of plan.needsFix) {
      await dbUnified.updateOne('packages', { id: item.id }, { $set: priceFields(item.to) });
      updated += 1;
    }
  }
  return {
    backend: backend.type,
    mode: apply ? 'apply' : 'dry-run',
    packages: packages.length,
    consistent: plan.consistent,
    needingFix: plan.needsFix.length,
    updated,
    withoutAnyPrice: plan.noPrice.length,
    // Ids only: no supplier or customer text goes in a report.
    fixIds: plan.needsFix.map(item => item.id),
    withoutAnyPriceIds: plan.noPrice,
  };
}

/**
 * Command-line entry point.
 *
 * @returns {Promise<number>} Exit code
 */
async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  try {
    const report = await syncPackagePrices({ apply });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT_CODES.ok;
  } catch (error) {
    if (error.name === 'BackendPreconditionError') {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CODES.refused;
    }
    throw error;
  }
}

if (require.main === module) {
  main()
    .catch(error => {
      process.stderr.write(`${error?.stack || error}\n`);
      return 1;
    })
    .then(async code => {
      process.exitCode = code;
      // Close the connection so the process ends on its own once it is done.
      await db.close().catch(() => {});
    });
}

module.exports = { syncPackagePrices, planPriceSync, resolveBackend, EXIT_CODES };
