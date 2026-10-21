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
 *   node scripts/sync-package-prices.js --apply --prefer=shown|price
 *                                                  # needed when some packages hold two different
 *                                                  # prices: which one wins
 */
'use strict';

const dbUnified = require('../db-unified');
const db = require('../db');
const { packagePriceText, priceFields, cleanPrice } = require('../utils/packagePrice');

/** The only backend an --apply run may modify. */
const REQUIRED_BACKEND = 'mongodb';

/** Exit codes, so a runbook can tell the failures apart. */
const EXIT_CODES = { ok: 0, refused: 2, decisionNeeded: 3 };

/** Which price wins where a package holds two different ones. */
const PREFER = Object.freeze({ shown: 'shown', price: 'price' });

/** At most this many conflicting packages are listed in a report. */
const MAX_CONFLICTS_LISTED = 200;

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
 * Most packages only need the missing field filled in. A package that holds two different prices
 * is a conflict: the site shows `price_display`, but the supplier may have typed a newer `price`
 * afterwards, and the data cannot say which one is right. The caller chooses with `prefer`:
 * 'shown' (the default) keeps what the public site shows today, 'price' keeps the supplier's field.
 *
 * @param {Object[]} packages - Package records
 * @param {string} [prefer] - PREFER.shown or PREFER.price, for conflicts
 * @returns {{needsFix: Array<{id: string, from: {price: *, price_display: *}, to: string, conflict: boolean}>, noPrice: string[], consistent: number}}
 */
function planPriceSync(packages, prefer = PREFER.shown) {
  const needsFix = [];
  const noPrice = [];
  let consistent = 0;
  packages.forEach(pkg => {
    const shown = packagePriceText(pkg);
    if (!shown) {
      noPrice.push(pkg.id);
      return;
    }
    if (pkg.price === shown && pkg.price_display === shown) {
      consistent += 1;
      return;
    }
    const supplierPrice = cleanPrice(pkg.price);
    const conflict =
      Boolean(supplierPrice) && Boolean(cleanPrice(pkg.price_display)) && supplierPrice !== shown;
    needsFix.push({
      id: pkg.id,
      from: { price: pkg.price, price_display: pkg.price_display },
      to: conflict && prefer === PREFER.price ? supplierPrice : shown,
      conflict,
    });
  });
  return { needsFix, noPrice, consistent };
}

/**
 * Report (and with `apply`, fix) packages whose two price fields differ or are missing.
 *
 * @param {Object} [options] - Options
 * @param {boolean} [options.apply] - Write the fixes
 * @param {string} [options.prefer] - PREFER.shown or PREFER.price: which price wins where a package
 *   holds two different ones. Required with `apply` when there are such packages.
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
  const prefer = options.prefer === PREFER.price ? PREFER.price : PREFER.shown;
  const plan = planPriceSync(packages, prefer);
  const conflicts = plan.needsFix.filter(item => item.conflict);
  if (apply && conflicts.length > 0 && !options.prefer) {
    const error = new Error(
      `${conflicts.length} package(s) hold two different prices (price and price_display), and the data cannot say which is right. ` +
        "Run without --apply to list them, then pass --prefer=shown (keep what the site shows today) or --prefer=price (keep the supplier's own price)."
    );
    error.name = 'DecisionNeededError';
    throw error;
  }
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
    // Where two different prices are held: shown to decide which should win. Prices are business
    // data, not personal data, so they are listed (ids and the two values only).
    conflictCount: conflicts.length,
    prefer,
    conflicts: conflicts.slice(0, MAX_CONFLICTS_LISTED).map(item => ({
      id: item.id,
      price: item.from.price,
      price_display: item.from.price_display,
      wouldKeep: item.to,
    })),
  };
}

/**
 * Command-line entry point.
 *
 * @returns {Promise<number>} Exit code
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const preferArg = args.find(arg => arg.startsWith('--prefer='));
  const prefer = preferArg ? preferArg.slice('--prefer='.length) : undefined;
  if (prefer !== undefined && !Object.values(PREFER).includes(prefer)) {
    process.stderr.write('--prefer must be "shown" or "price".\n');
    return EXIT_CODES.refused;
  }
  try {
    const report = await syncPackagePrices({ apply, prefer });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT_CODES.ok;
  } catch (error) {
    if (error.name === 'BackendPreconditionError') {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CODES.refused;
    }
    if (error.name === 'DecisionNeededError') {
      process.stderr.write(`${error.message}\n`);
      return EXIT_CODES.decisionNeeded;
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
      await db.close().catch(() => null);
    });
}

module.exports = { syncPackagePrices, planPriceSync, resolveBackend, EXIT_CODES, PREFER };
