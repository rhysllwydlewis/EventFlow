// @ts-check
import { test, expect } from '@playwright/test';

const MOCK_GOOGLE_WIDTH = 304;

/**
 * Browser-level regression proof for the exact production failure behind #1597:
 * Google GIS may personalize into a rendered child narrower than EventFlow's
 * 320px host container. Facebook must follow the rendered control, while
 * EventFlow must not clip or resize Google's child.
 */
test.describe('auth provider geometry', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/config**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('googleAuth')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ googleClientId: 'visual-test-google-client' }),
        });
        return;
      }
      if (url.searchParams.has('facebookAuth')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ facebookAppId: 'visual-test-facebook-app' }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('https://accounts.google.com/gsi/client', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.google = {
            accounts: {
              id: {
                initialize: function () {},
                renderButton: function (container) {
                  var frame = document.createElement('iframe');
                  frame.title = 'Mock personalized Google sign-in';
                  frame.setAttribute('data-testid', 'mock-google-personalized');
                  frame.style.display = 'block';
                  frame.style.width = '${MOCK_GOOGLE_WIDTH}px';
                  frame.style.height = '40px';
                  frame.style.border = '1px solid rgb(218, 220, 224)';
                  frame.style.borderRadius = '999px';
                  frame.style.background = 'white';
                  frame.srcdoc = '<!doctype html><body style="margin:0;font:14px Arial;display:flex;align-items:center;height:38px;padding:0 14px;box-sizing:border-box"><strong>Sign in as Rhys</strong><span style="margin-left:auto">G</span></body>';
                  container.appendChild(frame);
                }
              }
            }
          };
        `,
      });
    });
  });

  const panels = [
    { name: 'signin', panelId: 'panel-signin' },
    { name: 'signup', panelId: 'panel-create' },
  ];

  for (const panel of panels) {
    test(`${panel.name}: Facebook matches personalized Google control without clipping it`, async ({
      page,
    }, testInfo) => {
      await page.goto('/auth', { waitUntil: 'domcontentloaded' });

      if (panel.name === 'signup') {
        await page.getByRole('tab', { name: 'Create a free account' }).click();
      }

      const panelRoot = page.locator(`#${panel.panelId}`);
      const googleHost = panelRoot.locator('.auth-google-button');
      const googleFrame = googleHost.locator('iframe[data-testid="mock-google-personalized"]');
      const facebookButton = panelRoot.locator('.auth-facebook-button');

      await expect(googleFrame).toBeVisible();
      await expect(facebookButton).toBeVisible();

      await expect
        .poll(async () => {
          const googleBox = await googleFrame.boundingBox();
          const facebookBox = await facebookButton.boundingBox();
          const googleWidth = Math.round(googleBox?.width || 0);
          const facebookWidth = Math.round(facebookBox?.width || 0);
          return googleWidth > 0 && Math.abs(googleWidth - facebookWidth) <= 1;
        })
        .toBe(true);

      const geometry = await panelRoot.evaluate(root => {
        const host = root.querySelector('.auth-google-button');
        const frame = host?.querySelector('iframe');
        const facebook = root.querySelector('.auth-facebook-button');
        if (!(host instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
          return null;
        }
        if (!(facebook instanceof HTMLElement)) {
          return null;
        }
        const hostRect = host.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const facebookRect = facebook.getBoundingClientRect();
        return {
          hostWidth: Math.round(hostRect.width),
          frameWidth: Math.round(frameRect.width),
          facebookWidth: Math.round(facebookRect.width),
          hostOverflow: getComputedStyle(host).overflow,
          frameRightInsideHost: frameRect.right <= hostRect.right + 1,
          frameLeftInsideHost: frameRect.left >= hostRect.left - 1,
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry?.frameWidth).toBeGreaterThan(0);
      expect(geometry?.frameWidth).toBeLessThanOrEqual(MOCK_GOOGLE_WIDTH);
      expect(geometry?.frameWidth).toBeLessThanOrEqual(geometry?.hostWidth || 0);
      expect(Math.abs((geometry?.frameWidth || 0) - (geometry?.facebookWidth || 0))).toBeLessThanOrEqual(1);
      expect(geometry?.hostOverflow).toBe('visible');
      expect(geometry?.frameRightInsideHost).toBe(true);
      expect(geometry?.frameLeftInsideHost).toBe(true);

      const screenshotPath = testInfo.outputPath(`auth-social-${panel.name}-proof.png`);
      await panelRoot.locator('.auth-card').screenshot({ path: screenshotPath });
      await testInfo.attach(`auth-social-${panel.name}-proof`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
    });
  }
});
