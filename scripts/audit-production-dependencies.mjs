import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (error) {
  console.error('npm audit did not return valid JSON.');
  if (result.stdout) {
    console.error(result.stdout.trim());
  }
  if (result.stderr) {
    console.error(result.stderr.trim());
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const metadata = report.metadata?.vulnerabilities || {};
const vulnerabilities = Object.values(report.vulnerabilities || {}).sort((left, right) => {
  const order = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
  return (order[right.severity] || 0) - (order[left.severity] || 0);
});

console.log(
  `Production audit: ${metadata.total || 0} vulnerabilities ` +
    `(${metadata.critical || 0} critical, ${metadata.high || 0} high, ` +
    `${metadata.moderate || 0} moderate, ${metadata.low || 0} low).`
);

for (const vulnerability of vulnerabilities) {
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

if (result.stderr) {
  console.error(result.stderr.trim());
}

process.exit(result.status === 0 ? 0 : 1);
