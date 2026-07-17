// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression + accessibility Playwright config.
 *
 * This is a separate config from `playwright.config.js` because:
 *   - visual snapshots run against the deterministic static-mode server;
 *   - the dedicated workflow keeps screenshot and axe failures independently blocking;
 *   - CI receives a larger, bounded per-test timeout for full-page screenshots and axe scans.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: process.env.CI ? 90 * 1000 : 45 * 1000,
  reporter: [
    ['html', { outputFolder: 'visual-report' }],
    [
      'json',
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'test-results/visual-results.json' },
    ],
    ['junit', { outputFile: 'test-results/visual-junit.xml' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    timeout: 20 * 1000,
    // Small per-pixel tolerance to survive harmless AA-font shifts between
    // Chromium patch releases. Raise only after reviewing stable baselines.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'node scripts/serve-static.js',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
