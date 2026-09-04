import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(root, 'e2e');
const classification = JSON.parse(
  fs.readFileSync(path.join(e2eDir, 'backend-suite-classification.json'), 'utf8')
);

function fail(message) {
  console.error(`Backend E2E classification error: ${message}`);
  process.exit(1);
}

if (!Array.isArray(classification.blocking)) {
  fail('blocking must be an array of Playwright spec filenames.');
}
if (!classification.quarantined || Array.isArray(classification.quarantined)) {
  fail('quarantined must be an object whose values explain the repair needed.');
}

const backendSpecs = fs
  .readdirSync(e2eDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.spec.js'))
  .filter(entry => fs.readFileSync(path.join(e2eDir, entry.name), 'utf8').includes('@backend'))
  .map(entry => entry.name)
  .sort();
const backendSpecSet = new Set(backendSpecs);
const blockingSet = new Set(classification.blocking);
const quarantined = Object.entries(classification.quarantined);
const quarantinedSet = new Set(quarantined.map(([file]) => file));

if (classification.blocking.length < 8) {
  fail(`blocking coverage fell unexpectedly to ${classification.blocking.length} spec files.`);
}
if (blockingSet.size !== classification.blocking.length) {
  fail('blocking contains duplicate spec filenames.');
}

for (const file of classification.blocking) {
  if (!file.endsWith('.spec.js') || !backendSpecSet.has(file)) {
    fail(`blocking spec is missing or has no @backend coverage: ${file}`);
  }
  if (quarantinedSet.has(file)) fail(`${file} cannot be both blocking and quarantined.`);
}

for (const [file, reason] of quarantined) {
  if (!backendSpecSet.has(file))
    fail(`quarantined spec is missing or has no @backend coverage: ${file}`);
  if (typeof reason !== 'string' || reason.trim().length < 40) {
    fail(`quarantined spec needs a specific repair reason: ${file}`);
  }
}

const classified = new Set([...blockingSet, ...quarantinedSet]);
const unclassified = backendSpecs.filter(file => !classified.has(file));
if (unclassified.length > 0) fail(`unclassified backend specs: ${unclassified.join(', ')}`);
const stale = [...classified].filter(file => !backendSpecSet.has(file));
if (stale.length > 0) fail(`classification contains stale specs: ${stale.join(', ')}`);

const includeQuarantined = process.argv.includes('--include-quarantined');
const validateOnly = process.argv.includes('--validate-only');
const forwardedArgs = process.argv
  .slice(2)
  .filter(arg => arg !== '--include-quarantined' && arg !== '--validate-only');
const selectedSpecs = includeQuarantined ? backendSpecs : classification.blocking;

console.log(
  `Validated ${classification.blocking.length} blocking and ${quarantined.length} quarantined backend spec files; all ${backendSpecs.length} @backend files are classified.`
);
if (validateOnly) process.exit(0);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'playwright',
  'test',
  ...selectedSpecs.map(file => `e2e/${file}`),
  '--grep',
  '@backend',
  ...forwardedArgs,
];

console.log(
  `Running ${selectedSpecs.length} ${includeQuarantined ? 'all classified' : 'blocking'} backend spec files against the real application; ${quarantined.length} files remain explicitly quarantined.`
);

const result = spawnSync(npx, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
