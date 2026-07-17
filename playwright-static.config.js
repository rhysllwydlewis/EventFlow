import fs from 'node:fs';
import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

const classification = JSON.parse(
  fs.readFileSync(new URL('./e2e/static-suite-classification.json', import.meta.url), 'utf8')
);

const quarantinedSpecs = Object.keys(classification.quarantined).map(file => `**/${file}`);

export default defineConfig(baseConfig, {
  testIgnore: [`**/${classification.focusedAuth}`, ...quarantinedSpecs],
  grepInvert: /@backend|@visual/,
});
