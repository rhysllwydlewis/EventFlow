// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression + accessibility Playwright config (B4 + B6).
 *
 * This is a *separate* config from `playwright.config.js` because:
 *   - Visual snapshots should only run against the static-mode server to
 *     keep baselines deterministic (no database / timestamps / random IDs).
 *   - The main e2e suite runs every PR; the visual suite is soft-fail for
 *     the first 2 weeks (see `.github/workflows/visual-regression.yml`).
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { outputFolder: 'visual-report' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    // Small per-pixel tolerance to survive harmless AA-font shifts between
    // Chromium patch releases. Raise only if baselines stabilise.
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
