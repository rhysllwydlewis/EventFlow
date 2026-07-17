// @ts-check
/**
 * Visual regression + a11y baseline.
 *
 * For each approved baseline page we:
 *   1. Take a full-page screenshot and compare against the stored baseline.
 *   2. Run axe-core and assert no WCAG 2.1 AA violations beyond the
 *      documented allowlist in `tests/a11y/axe-ignore.json`.
 *
 * Pages without an approved committed screenshot may remain in the axe suite,
 * but their screenshot test is explicitly skipped until a baseline is reviewed.
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

// Routes here must render the expected page in static mode. Auth-gated pages
// (e.g. /settings, /dashboard-supplier) silently redirect or fall through to
// the SPA shell, which would produce misleading baselines, so they are not
// included until full backend mode is available to this suite.
const BASELINE_PAGES = [
  { name: 'homepage', path: '/' },
  { name: 'auth', path: '/auth' },
  { name: 'pricing', path: '/pricing' },
  { name: 'for-suppliers', path: '/for-suppliers' },
  { name: 'marketplace', path: '/marketplace' },
  {
    name: 'notifications-harness',
    path: '/test-notifications.html',
    screenshotApproved: false,
  },
];

/**
 * Normalise a declared baseline path into the pathname expected after any
 * client-side redirect. Query strings and `.html` are ignored for comparison.
 *
 * @param {string} declaredPath
 * @returns {string}
 */
function expectedPathname(declaredPath) {
  return declaredPath.split('?')[0].replace(/\.html$/, '');
}

/**
 * Shared precondition check for screenshot and axe tests.
 *
 * @param {import('@playwright/test').Page} pw
 * @param {import('@playwright/test').Response | null} response
 * @param {string} declaredPath
 */
function skipIfPageUnavailable(pw, response, declaredPath) {
  test.skip(
    !response || response.status() >= 500,
    `Page ${declaredPath} returned ${response?.status()} in static mode`
  );
  const finalPathname = new URL(pw.url()).pathname;
  const expected = expectedPathname(declaredPath);
  test.skip(
    !finalPathname.startsWith(expected) && expected !== '/',
    `Page ${declaredPath} redirected to ${finalPathname} in static mode`
  );
}

/**
 * Give pages a bounded opportunity to finish background requests. Some pages
 * intentionally keep connections or timers alive, so waiting for networkidle
 * must never consume the whole test timeout.
 *
 * @param {import('@playwright/test').Page} pw
 */
async function settlePage(pw) {
  await pw.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  await pw.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await pw.waitForTimeout(250);
}

for (const page of BASELINE_PAGES) {
  test.describe(`baseline: ${page.name}`, () => {
    test('visual snapshot matches baseline', async ({ page: pw }) => {
      test.skip(
        page.screenshotApproved === false,
        `Screenshot baseline for ${page.name} has not yet been approved and committed`
      );
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      skipIfPageUnavailable(pw, response, page.path);
      await settlePage(pw);
      await expect(pw).toHaveScreenshot(`${page.name}.png`, {
        fullPage: true,
      });
    });

    test('axe-core a11y has no WCAG 2.1 AA violations', async ({ page: pw }) => {
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      skipIfPageUnavailable(pw, response, page.path);
      await settlePage(pw);

      const results = await new AxeBuilder({ page: pw })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(axeIgnore.rules || [])
        .analyze();

      expect(
        results.violations,
        JSON.stringify(
          results.violations.map(violation => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.length,
          })),
          null,
          2
        )
      ).toEqual([]);
    });
  });
}
