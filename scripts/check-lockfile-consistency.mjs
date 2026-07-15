import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function dependencyMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compareSection(section, expectedValue, actualValue) {
  const expected = dependencyMap(expectedValue);
  const actual = dependencyMap(actualValue);
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const issues = [];

  for (const name of names) {
    if (!(name in actual)) {
      issues.push(`${section}.${name} is missing from package-lock.json`);
      continue;
    }
    if (!(name in expected)) {
      issues.push(`${section}.${name} is stale in package-lock.json`);
      continue;
    }
    if (expected[name] !== actual[name]) {
      issues.push(
        `${section}.${name} differs: package.json=${JSON.stringify(expected[name])}, package-lock.json=${JSON.stringify(actual[name])}`
      );
    }
  }

  return issues;
}

function main() {
  const packageJson = readJson(PACKAGE_PATH);
  const packageLock = readJson(LOCK_PATH);
  const lockRoot = packageLock.packages && packageLock.packages[''];

  if (!lockRoot) {
    console.error('package-lock.json does not contain packages[""] root metadata.');
    process.exitCode = 1;
    return;
  }

  const issues = SECTIONS.flatMap(section =>
    compareSection(section, packageJson[section], lockRoot[section])
  );

  if (issues.length > 0) {
    console.error('package.json and package-lock.json dependency metadata are inconsistent:');
    issues.forEach(issue => console.error(`- ${issue}`));
    console.error('\nRegenerate the lockfile with: npm install --package-lock-only --ignore-scripts');
    process.exitCode = 1;
    return;
  }

  console.log('package.json and package-lock.json dependency metadata are consistent.');
}

main();
