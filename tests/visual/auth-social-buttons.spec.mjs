// @ts-check
import { test, expect } from '@playwright/test';

const SOCIAL_BUTTON_MAX_WIDTH = 320;
const GOOGLE_DYNAMIC_WIDTH = 260;

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '360', width: 360, height: 640 },
  { name: '389', width: 389, height: 844 },
  { name: '390', width: 390, height: 844 },
  { name: '391', width: 391, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '820', width: 820, height: 1180 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1280', width: 1280, height: 720 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

const GOOGLE_STATES = [
  {
    name: 'generic',
    label: 'Sign in with Google',
    width: 'requested',
  },
  {
    name: 'personalized',
    label: 'Continue as Rhys',
    width: 304,
  },
  {
    name: 'returning-account',
    label: 'Rhys Lewis',
    width: 276,
  },
  {
    name: 'localized-long-copy',
    label: 'Continue with your Google Account',
    width: 'requested',
  },
  {
    name: 'dynamic-personalization',
    label: 'Sign in with Google',
    width: 'requested',
    dynamic: true,
  },
];

const PANELS = [
  { name: 'signin', panelId: 'panel-signin' },
  { name: 'signup', panelId: 'panel-create' },
];

const SCREENSHOT_VIEWPORTS = new Set(['320', '390', '391', '768', '1440']);
const SCREENSHOT_STATES = new Set([
  'generic',
  'personalized',
  'returning-account',
  'localized-long-copy',
  'dynamic-personalization',
]);

/**
 * Browser-level regression proof for the exact production failure behind #1597.
 *
 * Google's documented standard button can render either normal text or
 * personalized account information, and its locale may also change the copy
 * and resulting geometry. This harness deliberately exercises those variants,
 * a late personalization resize, both auth panels, and the responsive boundary
 * around the 390px EventFlow breakpoint.
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
          (function () {
            var variants = {
              generic: { label: 'Sign in with Google', width: 'requested' },
              personalized: { label: 'Continue as Rhys', width: 304 },
              'returning-account': { label: 'Rhys Lewis', width: 276 },
              'localized-long-copy': {
                label: 'Continue with your Google Account',
                width: 'requested'
              },
              'dynamic-personalization': {
                label: 'Sign in with Google',
                width: 'requested',
                dynamic: true
              }
            };

            window.google = {
              accounts: {
                id: {
                  initialize: function () {},
                  renderButton: function (container, options) {
                    var params = new URLSearchParams(window.location.search);
                    var stateName = params.get('gis_test_state') || 'generic';
                    var variant = variants[stateName] || variants.generic;
                    var requestedWidth = Number(options && options.width) || 320;
                    var targetWidth =
                      variant.width === 'requested'
                        ? requestedWidth
                        : Math.min(requestedWidth, Number(variant.width));

                    var frame = document.createElement('iframe');
                    frame.title = 'Mock Google state: ' + stateName;
                    frame.setAttribute('data-testid', 'mock-google-control');
                    frame.setAttribute('data-google-state', stateName);
                    frame.style.display = 'block';
                    frame.style.boxSizing = 'border-box';
                    frame.style.width = targetWidth + 'px';
                    frame.style.maxWidth = '100%';
                    frame.style.height = '40px';
                    frame.style.border = '1px solid rgb(218, 220, 224)';
                    frame.style.borderRadius = '999px';
                    frame.style.background = 'white';
                    frame.srcdoc =
                      '<!doctype html><body style="margin:0;padding:0 14px;box-sizing:border-box;font:14px Arial;display:flex;align-items:center;height:38px;white-space:nowrap;overflow:hidden"><span style="font-weight:600">' +
                      variant.label.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
                      '</span><span style="margin-left:auto;padding-left:12px;font-weight:700">G</span></body>';
                    container.appendChild(frame);

                    if (variant.dynamic) {
                      window.setTimeout(function () {
                        var resizedWidth = Math.min(requestedWidth, ${GOOGLE_DYNAMIC_WIDTH});
                        frame.style.width = resizedWidth + 'px';
                        frame.setAttribute('data-google-state', 'personalized-late');
                        frame.title = 'Mock Google state: personalized-late';
                        frame.srcdoc =
                          '<!doctype html><body style="margin:0;padding:0 14px;box-sizing:border-box;font:14px Arial;display:flex;align-items:center;height:38px;white-space:nowrap;overflow:hidden"><span style="font-weight:600">Continue as Rhys</span><span style="margin-left:auto;padding-left:12px;font-weight:700">G</span></body>';
                      }, 650);
                    }
                  }
                }
              }
            };
          })();
        `,
      });
    });
  });

  async function openPanel(page, panel, stateName) {
    await page.goto(`/auth?gis_test_state=${encodeURIComponent(stateName)}`, {
      waitUntil: 'domcontentloaded',
    });

    if (panel.name === 'signup') {
      await page.getByRole('tab', { name: 'Create a free account' }).click();
    }

    const panelRoot = page.locator(`#${panel.panelId}`);
    await expect(panelRoot.locator('iframe[data-testid="mock-google-control"]')).toBeVisible();
    await expect(panelRoot.locator('.auth-facebook-button')).toBeVisible();
    return panelRoot;
  }

  async function expectProviderGeometry(panelRoot) {
    const googleFrame = panelRoot.locator('iframe[data-testid="mock-google-control"]');
    const facebookButton = panelRoot.locator('.auth-facebook-button');

    await expect
      .poll(async () => {
        const googleBox = await googleFrame.boundingBox();
        const facebookBox = await facebookButton.boundingBox();
        return Math.abs((googleBox?.width || 0) - (facebookBox?.width || 0));
      })
      .toBeLessThanOrEqual(1);

    const geometry = await panelRoot.evaluate(root => {
      const host = root.querySelector('.auth-google-button');
      const frame = host?.querySelector('iframe');
      const facebook = root.querySelector('.auth-facebook-button');
      const card = root.querySelector('.auth-card');
      if (
        !(host instanceof HTMLElement) ||
        !(frame instanceof HTMLElement) ||
        !(facebook instanceof HTMLElement) ||
        !(card instanceof HTMLElement)
      ) {
        return null;
      }

      const hostRect = host.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const facebookRect = facebook.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      return {
        hostWidth: Math.round(hostRect.width),
        frameWidth: Math.round(frameRect.width),
        facebookWidth: Math.round(facebookRect.width),
        cardWidth: Math.round(cardRect.width),
        hostOverflow: getComputedStyle(host).overflow,
        frameRightInsideHost: frameRect.right <= hostRect.right + 1,
        frameLeftInsideHost: frameRect.left >= hostRect.left - 1,
        frameRightInsideCard: frameRect.right <= cardRect.right + 1,
        frameLeftInsideCard: frameRect.left >= cardRect.left - 1,
        facebookRightInsideCard: facebookRect.right <= cardRect.right + 1,
        facebookLeftInsideCard: facebookRect.left >= cardRect.left - 1,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.hostOverflow).toBe('visible');
    expect(Math.abs(geometry.frameWidth - geometry.facebookWidth)).toBeLessThanOrEqual(1);
    expect(geometry.frameWidth).toBeGreaterThan(0);
    expect(geometry.facebookWidth).toBeGreaterThan(0);
    expect(geometry.frameWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.facebookWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.hostWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.frameRightInsideHost).toBe(true);
    expect(geometry.frameLeftInsideHost).toBe(true);
    expect(geometry.frameRightInsideCard).toBe(true);
    expect(geometry.frameLeftInsideCard).toBe(true);
    expect(geometry.facebookRightInsideCard).toBe(true);
    expect(geometry.facebookLeftInsideCard).toBe(true);

    return geometry;
  }

  for (const panel of PANELS) {
    for (const state of GOOGLE_STATES) {
      test(`${panel.name}: ${state.name} remains aligned and unclipped across the viewport matrix`, async ({
        page,
      }, testInfo) => {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const panelRoot = await openPanel(page, panel, state.name);

          if (state.dynamic) {
            const initialGeometry = await expectProviderGeometry(panelRoot);
            await expect
              .poll(async () => {
                const frame = panelRoot.locator('iframe[data-testid="mock-google-control"]');
                return frame.getAttribute('data-google-state');
              })
              .toBe('personalized-late');
            const personalizedGeometry = await expectProviderGeometry(panelRoot);
            expect(personalizedGeometry.frameWidth).toBeLessThanOrEqual(initialGeometry.frameWidth);
          } else {
            await expectProviderGeometry(panelRoot);
          }

          const shouldCapture =
            testInfo.project.name === 'desktop-chromium' &&
            SCREENSHOT_VIEWPORTS.has(viewport.name) &&
            SCREENSHOT_STATES.has(state.name);

          if (shouldCapture) {
            const screenshotPath = testInfo.outputPath(
              `auth-social-${panel.name}-${state.name}-${viewport.name}px.png`
            );
            await panelRoot.locator('.auth-card').screenshot({ path: screenshotPath });
            await testInfo.attach(
              `auth-social-${panel.name}-${state.name}-${viewport.name}px`,
              {
                path: screenshotPath,
                contentType: 'image/png',
              }
            );
          }
        }
      });
    }
  }

  test('supplier signup disabled and ready states preserve provider geometry', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const panelRoot = await openPanel(page, PANELS[1], 'personalized');

      await panelRoot.getByRole('radio', { name: /Supplier/i }).click();

      const googleButton = panelRoot.locator('.auth-google-button');
      const facebookButton = panelRoot.locator('.auth-facebook-button');
      await expect(googleButton).toHaveClass(/auth-google-button--disabled/);
      await expect(facebookButton).toHaveClass(/auth-facebook-button--disabled/);
      await expect(facebookButton).toHaveAttribute('aria-disabled', 'true');
      await expectProviderGeometry(panelRoot);

      await panelRoot.locator('#reg-location').fill('Cardiff');
      await panelRoot.locator('#reg-company').fill('EventFlow Test Supplier');

      await expect(googleButton).not.toHaveClass(/auth-google-button--disabled/);
      await expect(facebookButton).not.toHaveClass(/auth-facebook-button--disabled/);
      await expect(facebookButton).toHaveAttribute('aria-disabled', 'false');
      await expectProviderGeometry(panelRoot);
    }
  });
});
