/**
 * Audit the production dependency tree and fail only on real findings.
 *
 * This used to decide pass/fail from npm's own exit code, which conflates two
 * unrelated things: `npm audit` exits non-zero for a vulnerability at or above
 * the threshold, and also for a registry it could not reach. When the registry
 * was unreachable the script printed "Production audit: 0 vulnerabilities" —
 * parsed out of a report that had no counts in it at all — and then failed the
 * build anyway, so the output actively contradicted the result.
 *
 * The verdict now comes from the parsed counts, and a registry or tooling
 * failure is reported as itself rather than dressed up as a clean audit.
 */

import { spawnSync } from 'node:child_process';

// Ascending, so everything at or after the threshold's index blocks.
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

const blockingLevel = process.env.NPM_AUDIT_LEVEL || 'high';

if (!SEVERITIES.includes(blockingLevel)) {
  console.error(
    `NPM_AUDIT_LEVEL="${blockingLevel}" is not a severity. Use one of: ${SEVERITIES.join(', ')}.`
  );
  process.exitCode = 1;
}

/**
 * Print everything known about one vulnerability.
 * @param {Object} vulnerability One entry from the audit report.
 * @returns {void} Nothing.
 */
function describe(vulnerability) {
  console.log(`\n${vulnerability.name} — ${vulnerability.severity}`);
  console.log(`  direct: ${vulnerability.isDirect ? 'yes' : 'no'}`);
  console.log(`  affected range: ${vulnerability.range || 'unknown'}`);

  const advisories = Array.isArray(vulnerability.via)
    ? vulnerability.via.filter(entry => typeof entry === 'object')
    : [];

  for (const advisory of advisories) {
    console.log(`  advisory: ${advisory.title || advisory.name || 'unnamed advisory'}`);
    if (advisory.url) {
      console.log(`  url: ${advisory.url}`);
    }
    if (advisory.range) {
      console.log(`  vulnerable versions: ${advisory.range}`);
    }
  }

  if (Array.isArray(vulnerability.effects) && vulnerability.effects.length > 0) {
    console.log(`  affects: ${vulnerability.effects.join(', ')}`);
  }
  if (Array.isArray(vulnerability.nodes) && vulnerability.nodes.length > 0) {
    console.log(`  installed at: ${vulnerability.nodes.join(', ')}`);
  }

  if (vulnerability.fixAvailable === false) {
    console.log('  fix available: no');
  } else if (vulnerability.fixAvailable === true) {
    console.log('  fix available: yes');
  } else if (vulnerability.fixAvailable && typeof vulnerability.fixAvailable === 'object') {
    console.log(
      `  fix available: ${vulnerability.fixAvailable.name || vulnerability.name}@${
        vulnerability.fixAvailable.version || 'unknown'
      }${vulnerability.fixAvailable.isSemVerMajor ? ' (major update)' : ''}`
    );
  }
}

/**
 * Run the audit and report.
 * @returns {number} The exit code: 0 clean, 1 blocked or unable to audit.
 */
function main() {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', `--audit-level=${blockingLevel}`, '--json'],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );

  let report;
  try {
    report = JSON.parse(result.stdout || '{}');
  } catch (error) {
    console.error('npm audit did not return valid JSON, so nothing was audited.');
    if (result.stdout) {
      console.error(result.stdout.trim());
    }
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  // npm reports registry and lockfile problems inside the JSON rather than
  // through stdout, and in that shape there are no counts to read. Saying so is
  // the whole point: an audit that did not run is not an audit that passed.
  if (report.error) {
    console.error('npm audit could not complete, so nothing was audited.');
    console.error(`  ${report.error.summary || report.error.code || 'no reason given'}`);
    if (report.error.detail) {
      console.error(`  ${String(report.error.detail).trim()}`);
    }
    return 1;
  }

  const metadata = report.metadata?.vulnerabilities;

  if (!metadata) {
    console.error('npm audit returned JSON with no vulnerability counts, so nothing was audited.');
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    return 1;
  }

  const vulnerabilities = Object.values(report.vulnerabilities || {}).sort(
    (left, right) => SEVERITIES.indexOf(right.severity) - SEVERITIES.indexOf(left.severity)
  );

  console.log(
    `Production audit: ${metadata.total || 0} vulnerabilities ` +
      `(${metadata.critical || 0} critical, ${metadata.high || 0} high, ` +
      `${metadata.moderate || 0} moderate, ${metadata.low || 0} low).`
  );
  console.log(`Blocking threshold: ${blockingLevel} and above.`);

  for (const vulnerability of vulnerabilities) {
    describe(vulnerability);
  }

  if (result.stderr) {
    console.error(result.stderr.trim());
  }

  const blocking = SEVERITIES.slice(SEVERITIES.indexOf(blockingLevel)).reduce(
    (total, severity) => total + (metadata[severity] || 0),
    0
  );

  if (blocking > 0) {
    console.error(
      `\n${blocking} vulnerability/vulnerabilities at ${blockingLevel} or above block this build.`
    );
    return 1;
  }

  console.log(`\nNothing at ${blockingLevel} or above. Production dependencies pass.`);
  return 0;
}

if (process.exitCode !== 1) {
  process.exitCode = main();
}
