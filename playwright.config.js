import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    [
      'json',
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'test-results/results.json' },
    ],
    ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME || 'test-results/junit.xml' }],
    ['list'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: (() => {
      const e2eMode = process.env.E2E_MODE || 'static';
      const isCI = process.env.CI === 'true';
      const useStaticMode = isCI || e2eMode === 'static';

      if (process.env.BASE_URL) {
        return process.env.BASE_URL;
      }

      return useStaticMode ? 'http://127.0.0.1:4173' : 'http://localhost:3000';
    })(),

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  /* In CI only chromium is installed; use all browsers locally */
  projects: process.env.CI
    ? [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [
        {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        },

        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },

        {
          name: 'webkit',
          use: {
            ...devices['Desktop Safari'],
            // Webkit/Safari needs more time for JS execution and rendering
            actionTimeout: 30000, // Set explicit timeout (default is 0/no timeout)
            navigationTimeout: 60000, // Increased from 30s default
          },
        },

        /* Test against mobile viewports. */
        {
          name: 'Mobile Chrome',
          use: { ...devices['Pixel 5'] },
        },
        {
          name: 'Mobile Safari',
          use: {
            ...devices['iPhone 12'],
            // Mobile Safari also needs generous timeouts
            actionTimeout: 30000,
            navigationTimeout: 60000,
          },
        },
      ],

  /* Run your local dev server before starting the tests */
  webServer: (() => {
    // Determine E2E mode: 'static' (default) or 'full' (backend)
    const e2eMode = process.env.E2E_MODE || 'static';
    const isCI = process.env.CI === 'true';

    // In CI, always use static mode
    const useStaticMode = isCI || e2eMode === 'static';

    if (useStaticMode) {
      // Static mode: lightweight server, no backend/database
      return {
        command: 'node scripts/serve-static.js',
        url: 'http://127.0.0.1:4173/api/health',
        reuseExistingServer: !isCI,
        timeout: 30 * 1000,
      };
    } else {
      // Full mode: backend with MongoDB
      return {
        command: 'npm start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: true,
        timeout: 120 * 1000,
        env: {
          NODE_ENV: 'test',
          JWT_SECRET: 'test-secret-key-for-e2e-testing-only-min-32-chars',
        },
      };
    }
  })(),
});
