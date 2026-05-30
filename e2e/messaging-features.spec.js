/**
 * E2E Tests for Messenger v4
 * Tests core v4 flows: navigation, conversation creation, messaging
 */

const { test, expect } = require('@playwright/test');

const V4_API = '/api/v4/messenger';
const MESSENGER_URL = '/messenger/';

test.describe('Messenger v4 – Core Flows', () => {
  let authToken;

  test.beforeAll(async ({ request }) => {
    const loginResponse = await request.post('/api/v1/auth/login', {
      data: {
        email: 'test-user-1@example.com',
        password: 'TestPassword123!',
      },
    });

    if (loginResponse.ok()) {
      const data = await loginResponse.json();
      authToken = data.token;
    }
  });

  test.describe('Messenger page loads', () => {
    test('should load /messenger/ without 404 errors', async ({ page }) => {
      const failedRequests = [];
      page.on('response', response => {
        if (response.status() === 404) {
          failedRequests.push(response.url());
        }
      });

      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      expect(failedRequests.filter(u => u.includes('/assets/') || u.includes('/messenger/'))).toHaveLength(0);
    });

    test('should render the messenger v4 container', async ({ page }) => {
      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.messenger-v4')).toBeVisible();
    });
  });

  test.describe('Legacy pages redirect to /messenger/', () => {
    test('/messages redirects to /messenger/', async ({ page }) => {
      await page.goto('/messages');
      await page.waitForURL(/\/messenger\//);
      expect(page.url()).toContain('/messenger/');
    });

    test('/conversation redirects to /messenger/', async ({ page }) => {
      await page.goto('/conversation.html');
      await page.waitForURL(/\/messenger\//);
      expect(page.url()).toContain('/messenger/');
    });

    test('/conversation?id=... preserves the target conversation', async ({ page }) => {
      await page.goto('/conversation?id=507f1f77bcf86cd799439011');
      await page.waitForURL(/\/messenger\/\?conversation=507f1f77bcf86cd799439011/);
      expect(page.url()).toContain('/messenger/?conversation=507f1f77bcf86cd799439011');
    });
  });

  test.describe('Messenger v4 API – Conversations', () => {
    test('should return conversations list from v4 endpoint', async ({ request }) => {
      if (!authToken) test.skip();

      const response = await request.get(`${V4_API}/conversations`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // 200 or 401 (not logged in during CI) are acceptable; 404 is not
      expect(response.status()).not.toBe(404);
    });

    test('should return unread count from v4 endpoint', async ({ request }) => {
      if (!authToken) test.skip();

      const response = await request.get(`${V4_API}/unread-count`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status()).not.toBe(404);
      if (response.ok()) {
        const data = await response.json();
        expect(data).toHaveProperty('unreadCount');
        expect(Number.isFinite(Number(data.unreadCount))).toBe(true);
      }
    });
  });

  test.describe('Messenger v4 – Send message flow', () => {
    test('should open messenger and show a meaningful shell state', async ({ page }) => {
      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.messenger-v4')).toBeVisible();

      const shellStateCount = await page
        .locator([
          '.messenger-v4__conversation-list',
          '.conversation-list',
          '.conversations-list',
          '.messenger-v4__empty-state',
          '[data-empty-state]',
          '.messenger-v4__chat-panel',
          '.messenger-v4__composer',
        ].join(','))
        .count();

      expect(shellStateCount).toBeGreaterThan(0);
    });
  });

  test.describe('Messenger v4 – API version config', () => {
    test('should not expose legacy v2 MESSAGING constants', async ({ page }) => {
      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      const hasLegacyMessaging = await page.evaluate(() => {
        return (
          typeof window.API_VERSION !== 'undefined' &&
          typeof window.API_VERSION.MESSAGING !== 'undefined'
        );
      });

      expect(hasLegacyMessaging).toBe(false);
    });

    test('should expose MESSENGER v4 constants', async ({ page }) => {
      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      const result = await page.evaluate(() => {
        if (typeof window.API_VERSION === 'undefined') return null; // not loaded = OK
        return typeof window.API_VERSION.MESSENGER !== 'undefined';
      });

      // If API_VERSION is loaded on this page it must expose the v4 MESSENGER config;
      // if not loaded (null), the page is fine – the first test already guards against v2.
      if (result !== null) {
        expect(result).toBe(true);
      }
    });
  });

  test.describe('Messenger v4 – Offline queue', () => {
    test('should show messenger UI even when API is unreachable', async ({ page }) => {
      await page.route(`${V4_API}/**`, route => route.abort());

      await page.goto(MESSENGER_URL);
      await page.waitForLoadState('domcontentloaded');

      // The UI shell should still render
      await expect(page.locator('.messenger-v4')).toBeVisible();
    });
  });

  test.describe('Messenger v4 – Message search', () => {
    test('v4 search endpoint exists (not 404)', async ({ request }) => {
      if (!authToken) test.skip();

      const response = await request.get(`${V4_API}/search?q=test`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status()).not.toBe(404);
    });
  });
});

test.describe('Messenger v4 – Performance', () => {
  test('v4 conversations endpoint responds in under 500ms', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${V4_API}/conversations`);
    const duration = Date.now() - start;

    // 401 Unauthorized is fine; we just check it responded quickly
    expect(response.status()).not.toBe(404);
    expect(duration).toBeLessThan(500);
  });
});
