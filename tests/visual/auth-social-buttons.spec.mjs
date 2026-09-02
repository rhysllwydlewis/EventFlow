// @ts-check
import { test, expect } from '@playwright/test';

const SOCIAL_BUTTON_MAX_WIDTH = 320;
const GIS_HORIZONTAL_GUTTER = 10;
const GOOGLE_DYNAMIC_WIDTH = 260;

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '360', width: 360, height: 640 },
  { name: '375', width: 375, height: 667 },
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
    name: 'personalized-one-session',
    label: 'Sign in as Rhys',
    sublabel: 'rhys@example.com',
    width: 'requested',
  },
  {
    name: 'personalized-multiple-sessions',
    label: 'Sign in as Rhys',
    sublabel: 'rhys@example.com  ▾',
    width: 'requested',
  },
  {
    name: 'compact-personalized',
    label: 'Continue as Rhys',
    sublabel: 'rhys@example.com',
    width: 304,
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
  'personalized-one-session',
  'personalized-multiple-sessions',
  'compact-personalized',
  'localized-long-copy',
  'dynamic-personalization',
]);

/**
 * Browser-level regression proof for the production failure behind #1597.
 *
 * Google documents that the standard button may switch between generic and
 * personalized content based on session state, and that locale can change its
 * visible copy. GIS also renders the real button inside an iframe with extra
 * horizontal gutter and negative margins. That gutter must remain intact: if
 * EventFlow constrains the iframe itself to the host width, the right edge of
 * the pill is cut off exactly as seen in production.
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
            var gutter = ${GIS_HORIZONTAL_GUTTER};
            var variants = {
              generic: { label: 'Sign in with Google', width: 'requested' },
              'personalized-one-session': {
                label: 'Sign in as Rhys',
                sublabel: 'rhys@example.com',
                width: 'requested'
              },
              'personalized-multiple-sessions': {
                label: 'Sign in as Rhys',
                sublabel: 'rhys@example.com  ▾',
                width: 'requested'
              },
              'compact-personalized': {
                label: 'Continue as Rhys',
                sublabel: 'rhys@example.com',
                width: 304
              },
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

            function frameHtml(variant, visibleWidth) {
              var safeLabel = String(variant.label || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;');
              var safeSublabel = String(variant.sublabel || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;');
              var secondary = safeSublabel
                ? '<span style="display:block;color:#5f6368;font:11px Arial;margin-top:1px;overflow:hidden;text-overflow:ellipsis">' +
                  safeSublabel +
                  '</span>'
                : '';

              return (
                '<!doctype html><html><body style="margin:0;width:' +
                (visibleWidth + gutter * 2) +
                'px;height:44px;overflow:hidden;background:transparent">' +
                '<div data-testid="mock-google-visible-pill" style="box-sizing:border-box;margin:2px ' +
                gutter +
                'px;width:' +
                visibleWidth +
                'px;height:40px;border:1px solid #747775;border-radius:20px;background:#fff;color:#1f1f1f;display:flex;align-items:center;padding:0 10px;font-family:Arial;overflow:hidden">' +
                '<span style="width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#4285f4;flex:0 0 20px">G</span>' +
                '<span style="display:block;min-width:0;margin-left:10px;font-size:12px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong style="font-weight:600">' +
                safeLabel +
                '</strong>' +
                secondary +
                '</span>' +
                '<span style="margin-left:auto;padding-left:8px;font-weight:700;color:#4285f4">G</span>' +
                '</div></body></html>'
              );
            }

            function updateFrame(frame, variant, visibleWidth, stateName) {
              frame.setAttribute('data-google-state', stateName);
              frame.setAttribute('data-visible-width', String(visibleWidth));
              frame.style.width = visibleWidth + gutter * 2 + 'px';
              frame.srcdoc = frameHtml(variant, visibleWidth);
            }

            window.google = {
              accounts: {
                id: {
                  initialize: function () {},
                  renderButton: function (container, options) {
                    var params = new URLSearchParams(window.location.search);
                    var stateName = params.get('gis_test_state') || 'generic';
                    var variant = variants[stateName] || variants.generic;
                    var requestedWidth = Number(options && options.width) || 320;
                    var visibleWidth =
                      variant.width === 'requested'
                        ? requestedWidth
                        : Math.min(requestedWidth, Number(variant.width));

                    var wrapper = document.createElement('div');
                    wrapper.className = 'S9gUrf-YoZ4jf';
                    wrapper.style.position = 'relative';

                    var placeholder = document.createElement('div');
                    wrapper.appendChild(placeholder);

                    var frame = document.createElement('iframe');
                    frame.title = 'Mock Google state: ' + stateName;
                    frame.setAttribute('data-testid', 'mock-google-control');
                    frame.style.display = 'block';
                    frame.style.position = 'relative';
                    frame.style.top = '0px';
                    frame.style.left = '0px';
                    frame.style.height = '44px';
                    frame.style.border = '0px';
                    frame.style.margin = '-2px -' + gutter + 'px';
                    updateFrame(frame, variant, visibleWidth, stateName);
                    wrapper.appendChild(frame);
                    container.appendChild(wrapper);

                    if (variant.dynamic) {
                      window.setTimeout(function () {
                        var resizedWidth = Math.min(requestedWidth, ${GOOGLE_DYNAMIC_WIDTH});
                        updateFrame(
                          frame,
                          {
                            label: 'Sign in as Rhys',
                            sublabel: 'rhys@example.com'
                          },
                          resizedWidth,
                          'personalized-late'
                        );
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
        const visibleWidth = Number(await googleFrame.getAttribute('data-visible-width')) || 0;
        const facebookBox = await facebookButton.boundingBox();
        return Math.abs(visibleWidth - (facebookBox?.width || 0));
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
      const frameStyles = getComputedStyle(frame);
      const marginLeft = Number.parseFloat(frameStyles.marginLeft || '0') || 0;
      const marginRight = Number.parseFloat(frameStyles.marginRight || '0') || 0;
      const visibleWidth = Number(frame.dataset.visibleWidth || 0);
      const footprintWidth = Math.round(frameRect.width + marginLeft + marginRight);

      return {
        hostWidth: Math.round(hostRect.width),
        frameWidth: Math.round(frameRect.width),
        facebookWidth: Math.round(facebookRect.width),
        cardWidth: Math.round(cardRect.width),
        visibleWidth,
        footprintWidth,
        marginLeft,
        marginRight,
        hostOverflow: getComputedStyle(host).overflow,
        frameMaxWidth: frameStyles.maxWidth,
        frameLeftInsideCard: frameRect.left >= cardRect.left - 1,
        frameRightInsideCard: frameRect.right <= cardRect.right + 1,
        facebookLeftInsideCard: facebookRect.left >= cardRect.left - 1,
        facebookRightInsideCard: facebookRect.right <= cardRect.right + 1,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.hostOverflow).toBe('visible');
    expect(geometry.frameMaxWidth).toBe('none');
    expect(geometry.marginLeft).toBe(-GIS_HORIZONTAL_GUTTER);
    expect(geometry.marginRight).toBe(-GIS_HORIZONTAL_GUTTER);
    expect(geometry.frameWidth).toBe(geometry.visibleWidth + GIS_HORIZONTAL_GUTTER * 2);
    expect(geometry.footprintWidth).toBe(geometry.visibleWidth);
    expect(Math.abs(geometry.facebookWidth - geometry.visibleWidth)).toBeLessThanOrEqual(1);
    expect(geometry.visibleWidth).toBeGreaterThan(0);
    expect(geometry.visibleWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.facebookWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.hostWidth).toBeLessThanOrEqual(SOCIAL_BUTTON_MAX_WIDTH);
    expect(geometry.frameLeftInsideCard).toBe(true);
    expect(geometry.frameRightInsideCard).toBe(true);
    expect(geometry.facebookLeftInsideCard).toBe(true);
    expect(geometry.facebookRightInsideCard).toBe(true);

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
            expect(personalizedGeometry.visibleWidth).toBeLessThanOrEqual(
              initialGeometry.visibleWidth
            );
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
      const panelRoot = await openPanel(page, PANELS[1], 'personalized-one-session');

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
