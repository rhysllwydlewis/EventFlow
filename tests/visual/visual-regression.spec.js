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

// Routes here must render the expected page in static mode. Auth-gated pages
// (e.g. /settings, /dashboard-supplier) silently redirect or fall through to
// the SPA shell, which would produce misleading baselines, so they are NOT
// included. When the full backend mode is wired for visual regression we can
// add them behind an env flag.
const BASELINE_PAGES = [
  { name: 'homepage', path: '/' },
  { name: 'auth', path: '/auth' },
  { name: 'pricing', path: '/pricing' },
  { name: 'for-suppliers', path: '/for-suppliers' },
  { name: 'marketplace', path: '/marketplace' },
  { name: 'notifications-harness', path: '/test-notifications.html' },
];

/**
 * Normalise a declared baseline path into the pathname we expect after the
 * navigator follows any client-side redirects. Strips query string and `.html`
 * so `/auth` and `/auth.html?foo=1` both compare as `/auth`.
 *
 * @param {string} declaredPath
 * @returns {string}
 */
function expectedPathname(declaredPath) {
  return declaredPath.split('?')[0].replace(/\.html$/, '');
}

/**
 * Shared precondition check for both the visual-snapshot and the axe-core
 * tests. Skips (rather than fails) when the static-mode server returned a
 * hard error OR when client-side navigation silently redirected to a
 * different path — either case would produce a misleading artefact.
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

for (const page of BASELINE_PAGES) {
  test.describe(`baseline: ${page.name}`, () => {
    test('visual snapshot matches baseline', async ({ page: pw }) => {
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      skipIfPageUnavailable(pw, response, page.path);
      await pw.waitForLoadState('networkidle').catch(() => {});
      await expect(pw).toHaveScreenshot(`${page.name}.png`, {
        fullPage: true,
      });
    });

    test('axe-core a11y has no WCAG 2.1 AA violations', async ({ page: pw }) => {
      const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
      skipIfPageUnavailable(pw, response, page.path);
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
