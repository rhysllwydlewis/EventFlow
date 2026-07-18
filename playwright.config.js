import { defineConfig, devices } from '@playwright/test';

const e2eMode = process.env.E2E_MODE || 'static';
const isCI = process.env.CI === 'true';
const runAllBrowsers = process.env.PLAYWRIGHT_ALL_BROWSERS === 'true';
// Explicit full mode must always win, including inside GitHub Actions.
const useStaticMode = e2eMode !== 'full' && (isCI || e2eMode === 'static');

const chromiumProject = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
};

const allProjects = [
  chromiumProject,
  {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    use: {
      ...devices['Desktop Safari'],
      actionTimeout: 30000,
      navigationTimeout: 60000,
    },
  },
  {
    name: 'Mobile Chrome',
    use: { ...devices['Pixel 5'] },
  },
  {
    name: 'Mobile Safari',
    use: {
      ...devices['iPhone 12'],
      actionTimeout: 30000,
      navigationTimeout: 60000,
    },
  },
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    [
      'json',
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || 'test-results/results.json' },
    ],
    ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME || 'test-results/junit.xml' }],
    ['list'],
  ],
  use: {
    baseURL:
      process.env.BASE_URL || (useStaticMode ? 'http://127.0.0.1:4173' : 'http://localhost:3000'),
    trace: process.env.PLAYWRIGHT_TRACE || 'on-first-retry',
    screenshot: process.env.PLAYWRIGHT_SCREENSHOT || 'only-on-failure',
    video: process.env.PLAYWRIGHT_VIDEO || 'retain-on-failure',
  },
  projects: isCI && !runAllBrowsers ? [chromiumProject] : allProjects,
  webServer: useStaticMode
    ? {
        command: 'node scripts/serve-static.js',
        url: 'http://127.0.0.1:4173/api/health',
        reuseExistingServer: !isCI,
        timeout: 30 * 1000,
      }
    : {
        command: 'npm start',
        url: 'http://localhost:3000/api/ready',
        reuseExistingServer: !isCI,
        timeout: 120 * 1000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          JWT_SECRET: process.env.JWT_SECRET || 'test-secret-key-for-e2e-testing-only-min-32-chars',
          MONGODB_URI:
            process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow_e2e?replicaSet=rs0',
        },
      },
});
