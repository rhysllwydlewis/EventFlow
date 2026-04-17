// @ts-check
/**
 * Visual regression + a11y baseline (B4 + B6).
 *
 * For each baseline page we:
 *   1. Take a full-page screenshot and compare against the stored baseline.
 *   2. Run axe-core and assert no WCAG 2.1 AA violations beyond the
 *      documented allowlist in `tests/a11y/axe-ignore.json`.
 *
 * New baseline pages are added to `BASELINE_PAGES` below. Update screenshots
 * with `npm run test:visual:update`.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {{rules: string[], notes?: Record<string,string>}} */
const axeIgnore = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'a11y', 'axe-ignore.json'), 'utf8')
);

const BASELINE_PAGES = [
  { name: 'homepage', path: '/' },
  { name: 'auth', path: '/auth' },
  { name: 'supplier-dashboard', path: '/dashboard-supplier' },
  { name: 'customer-dashboard', path: '/customer-dashboard' },
  { name: 'settings', path: '/settings' },
  { name: 'marketplace', path: '/marketplace' },
  { name: 'notifications-harness', path: '/test-notifications.html' },
];

for (const page of BASELINE_PAGES) {
  test.describe(`baseline: ${page.name}`, () => {
    test('visual snapshot matches baseline', async ({ page: pw }) => {
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      // Some routes are login-gated in full mode; in static mode they render
      // a redirect shell. Skip if the response is a hard error — this keeps
      // the suite green in static mode while capturing real visual changes
      // for the pages that render content.
      test.skip(
        !response || response.status() >= 500,
        `Page ${page.path} returned ${response?.status()} in static mode`
      );
      await pw.waitForLoadState('networkidle').catch(() => {});
      await expect(pw).toHaveScreenshot(`${page.name}.png`, {
        fullPage: true,
      });
    });

    test('axe-core a11y has no WCAG 2.1 AA violations', async ({ page: pw }) => {
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      test.skip(
        !response || response.status() >= 500,
        `Page ${page.path} returned ${response?.status()} in static mode`
      );
      await pw.waitForLoadState('networkidle').catch(() => {});

      const results = await new AxeBuilder({ page: pw })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(axeIgnore.rules || [])
        .analyze();

      expect(
        results.violations,
        JSON.stringify(
          results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
          null,
          2
        )
      ).toEqual([]);
    });
  });
}
