import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(root, 'e2e');
const classificationPath = path.join(e2eDir, 'static-suite-classification.json');
const classification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));

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

const quarantined = Object.entries(classification.quarantined);
if (quarantined.length === 0) {
  fail('the quarantine cannot be emptied without repairing and reclassifying the affected specs.');
}

const focusedAuthPath = path.join(e2eDir, classification.focusedAuth);
if (!fs.existsSync(focusedAuthPath)) {
  fail(`focused auth spec does not exist: ${classification.focusedAuth}`);
}

for (const [file, reason] of quarantined) {
  if (file === classification.focusedAuth) {
    fail(`${file} cannot be both the focused auth suite and quarantined.`);
  }
  if (!file.endsWith('.spec.js') || path.basename(file) !== file) {
    fail(`quarantined entry must be a top-level spec filename: ${file}`);
  }
  if (!fs.existsSync(path.join(e2eDir, file))) {
    fail(`quarantined spec does not exist: ${file}`);
  }
  if (typeof reason !== 'string' || reason.trim().length < 20) {
    fail(`quarantined spec needs a useful repair reason: ${file}`);
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const listed = spawnSync(
  npx,
  ['playwright', 'test', '--config=playwright-static.config.js', '--list'],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  }
);

const output = `${listed.stdout || ''}\n${listed.stderr || ''}`;
if (listed.status !== 0) {
  console.error(output);
  fail('Playwright could not list the blocking static suite.');
}

const totalMatch = output.match(/Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/i);
if (!totalMatch) {
  console.error(output);
  fail('could not confirm the size of the blocking static suite.');
}

const testCount = Number(totalMatch[1]);
const fileCount = Number(totalMatch[2]);
if (testCount < 100 || fileCount < 10) {
  fail(`blocking coverage fell unexpectedly to ${testCount} tests in ${fileCount} files.`);
}

if (output.includes(classification.focusedAuth)) {
  fail(`${classification.focusedAuth} must run only in the dedicated auth job.`);
}

for (const [file] of quarantined) {
  if (output.includes(file)) {
    fail(`quarantined spec leaked into the blocking suite: ${file}`);
  }
}

console.log(
  `Static E2E classification valid: ${testCount} blocking tests in ${fileCount} files; ${quarantined.length} specs quarantined with repair reasons.`
);
