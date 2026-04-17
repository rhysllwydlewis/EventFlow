#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'public/assets/css/styles.css');
const snapshotPath = path.join(root, 'scripts/button-opt-out-snapshot.json');
const shouldUpdate = process.argv.includes('--update');

function extractNotClasses(selector) {
  return [...selector.matchAll(/:not\(\.([a-zA-Z0-9_-]+)\)/g)].map(match => match[1]);
}

function loadCurrentExclusions() {
  const css = fs.readFileSync(cssPath, 'utf8');
  const selectorMatches = [...css.matchAll(/button:not\([^{}]+?\.ef-cta/g)].map(match => match[0]);
  if (selectorMatches.length < 2) {
    throw new Error(
      'Could not locate both button opt-out selectors in public/assets/css/styles.css'
    );
  }
  return {
    desktop: extractNotClasses(selectorMatches[0]),
    mobile: extractNotClasses(selectorMatches[1]),
  };
}

function readSnapshot() {
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}

function writeSnapshot(data) {
  fs.writeFileSync(snapshotPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function diff(current, snapshot) {
  const added = {};
  const removed = {};
  for (const key of ['desktop', 'mobile']) {
    const currentSet = new Set(current[key] || []);
    const snapshotSet = new Set((snapshot && snapshot[key]) || []);
    added[key] = [...currentSet].filter(name => !snapshotSet.has(name));
    removed[key] = [...snapshotSet].filter(name => !currentSet.has(name));
  }
  return { added, removed };
}

try {
  const current = loadCurrentExclusions();
  if (shouldUpdate) {
    writeSnapshot(current);
    console.log(`Updated ${path.relative(root, snapshotPath)} from current CSS selectors.`);
    process.exit(0);
  }

  const snapshot = readSnapshot();
  if (!snapshot) {
    console.error(
      `Missing snapshot at ${path.relative(root, snapshotPath)}. Run: node scripts/check-button-opt-out.mjs --update`
    );
    process.exit(1);
  }

  const { added, removed } = diff(current, snapshot);
  const addedAny = added.desktop.length > 0 || added.mobile.length > 0;
  const removedAny = removed.desktop.length > 0 || removed.mobile.length > 0;

  if (addedAny) {
    console.error('Detected newly added button opt-out classes (blocked):');
    if (added.desktop.length > 0) {
      console.error(`  desktop: ${added.desktop.join(', ')}`);
    }
    if (added.mobile.length > 0) {
      console.error(`  mobile: ${added.mobile.join(', ')}`);
    }
    console.error(
      'Do not add new exclusions silently. Revisit the migration plan before changing these selectors.'
    );
    process.exit(1);
  }

  if (removedAny) {
    console.log('Button opt-out classes were removed (migration progress).');
    if (removed.desktop.length > 0) {
      console.log(`  desktop removed: ${removed.desktop.join(', ')}`);
    }
    if (removed.mobile.length > 0) {
      console.log(`  mobile removed: ${removed.mobile.join(', ')}`);
    }
    console.log('Run `node scripts/check-button-opt-out.mjs --update` to refresh the snapshot.');
    process.exit(0);
  }

  console.log('Button opt-out selectors unchanged vs snapshot.');
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
