import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(root, 'e2e');
const classification = JSON.parse(
  fs.readFileSync(path.join(e2eDir, 'static-suite-classification.json'), 'utf8')
);

function fail(message) {
  console.error(`Static E2E classification error: ${message}`);
  process.exit(1);
}

if (typeof classification.focusedAuth !== 'string' || !classification.focusedAuth.endsWith('.spec.js')) {
  fail('focusedAuth must name one Playwright spec file.');
}

if (!classification.quarantined || Array.isArray(classification.quarantined)) {
  fail('quarantined must be an object whose values explain why each spec is isolated.');
}

const allSpecs = fs
  .readdirSync(e2eDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.spec.js'))
  .map(entry => entry.name)
  .sort();

const allSpecSet = new Set(allSpecs);
if (!allSpecSet.has(classification.focusedAuth)) {
  fail(`focused auth spec does not exist: ${classification.focusedAuth}`);
}

const quarantined = Object.entries(classification.quarantined);
for (const [file, reason] of quarantined) {
  if (file === classification.focusedAuth) {
    fail(`${file} cannot be both the focused auth suite and quarantined.`);
  }
  if (!allSpecSet.has(file)) {
    fail(`quarantined spec does not exist: ${file}`);
  }
  if (typeof reason !== 'string' || reason.trim().length < 20) {
    fail(`quarantined spec needs a useful repair reason: ${file}`);
  }
}

const excluded = new Set([classification.focusedAuth, ...quarantined.map(([file]) => file)]);
const blockingSpecs = allSpecs.filter(file => !excluded.has(file));

if (blockingSpecs.length < 10) {
  fail(`blocking coverage fell unexpectedly to ${blockingSpecs.length} spec files.`);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'playwright',
  'test',
  ...blockingSpecs.map(file => `e2e/${file}`),
  '--grep-invert',
  '@backend|@visual',
  ...process.argv.slice(2),
];

console.log(
  `Running ${blockingSpecs.length} blocking static E2E spec files; ${quarantined.length} unstable specs remain explicitly quarantined.`
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
