// @ts-check

import { test, expect } from '@playwright/test';

const HARNESS_PATH = '/__jadeassist-launcher-polish';
const DISMISSAL_KEY = 'jadeassist-polish-browser-test-dismissed-at';
const HARNESS_HTML = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JadeAssist launcher polish harness</title>
    <style>
      html, body { min-height: 100%; margin: 0; }
      body {
        background: linear-gradient(145deg, #f8fafc, #e7f3f1);
        color: #0b1220;
        font-family: Inter, system-ui, sans-serif;
      }
      main { max-width: 46rem; margin: 0 auto; padding: 4rem 1.5rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>JadeAssist launcher browser harness</h1>
      <p>This deterministic page verifies the paired launcher controls in a real browser.</p>
    </main>
    <script src="/assets/js/vendor/jade-widget.js"></script>
    <script>
      window.JADEASSIST_CONFIG = { launcherDismissDurationMs: 60 * 60 * 1000 };
    </script>
    <script src="/assets/js/jadeassist-launcher-polish.js"></script>
    <script>
      window.JadeWidget.init({
        apiBaseUrl: 'http://127.0.0.1:4173',
        assistantName: 'Jade',
        greetingTooltipText: '',
        avatarUrl: '/assets/images/jadeassist-agent.png',
        notificationBadgeUrl: '/assets/images/jadeassist-notification-badge.png',
        closeButtonUrl: '/assets/images/jadeassist-close-button.png',
        launcherDismissible: true,
        launcherDismissStorageKey: '${DISMISSAL_KEY}',
        launcherDismissDurationMs: 30 * 24 * 60 * 60 * 1000,
        showDelayMs: 0,
        offsetBottom: '6rem',
        offsetLeft: '6rem',
        offsetBottomMobile: '5rem',
        offsetLeftMobile: '2rem',
        scale: 0.85,
      });
    </script>
  </body>
</html>`;

async function waitForPolishedLauncher(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('.jade-widget-root');
    const shadow = root?.shadowRoot;
    return Boolean(
      root?.getAttribute('data-eventflow-launcher-polished') === 'true' &&
        shadow?.querySelector('.jade-avatar-button') &&
        shadow?.querySelector('.jade-avatar-badge-asset') &&
        shadow?.querySelector('.jade-launcher-dismiss') &&
        shadow?.querySelector('.jade-launcher-dismiss-asset')
    );
  });
}

test.describe('JadeAssist launcher polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**${HARNESS_PATH}`, route =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HARNESS_HTML })
    );
    await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded' });
    await waitForPolishedLauncher(page);
  });

  test('mirrors both corner assets and preserves a genuine 44px touch target', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.jade-widget-root');
      const shadow = root.shadowRoot;
      const avatar = shadow.querySelector('.jade-avatar-button');
      const badge = shadow.querySelector('.jade-avatar-badge-asset');
      const closeButton = shadow.querySelector('.jade-launcher-dismiss');
      const closeAsset = shadow.querySelector('.jade-launcher-dismiss-asset');

      avatar.style.animationPlayState = 'paused';
      closeButton.style.animationPlayState = 'paused';

      const avatarRect = avatar.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const closeButtonRect = closeButton.getBoundingClientRect();
      const closeAssetRect = closeAsset.getBoundingClientRect();
      const avatarStyle = getComputedStyle(avatar);
      const closeStyle = getComputedStyle(closeButton);

      const centre = rect => ({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });

      return {
        polished: root.getAttribute('data-eventflow-launcher-polished'),
        ariaLabel: closeButton.getAttribute('aria-label'),
        hitTargetWidth: closeButtonRect.width,
        hitTargetHeight: closeButtonRect.height,
        avatarCentre: centre(avatarRect),
        badgeCentre: centre(badgeRect),
        closeCentre: centre(closeAssetRect),
        badgeWidth: badgeRect.width,
        closeAssetWidth: closeAssetRect.width,
        avatarAnimationName: avatarStyle.animationName,
        closeAnimationName: closeStyle.animationName,
        avatarAnimationDuration: avatarStyle.animationDuration,
        closeAnimationDuration: closeStyle.animationDuration,
      };
    });

    expect(metrics.polished).toBe('true');
    expect(metrics.ariaLabel).toBe('Close JadeAssist assistant');
    expect(metrics.hitTargetWidth).toBeGreaterThanOrEqual(44);
    expect(metrics.hitTargetHeight).toBeGreaterThanOrEqual(44);
    expect(Math.abs(metrics.badgeWidth - metrics.closeAssetWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(metrics.badgeCentre.y - metrics.closeCentre.y)).toBeLessThanOrEqual(2);

    const leftDistance = metrics.avatarCentre.x - metrics.closeCentre.x;
    const rightDistance = metrics.badgeCentre.x - metrics.avatarCentre.x;
    expect(Math.abs(leftDistance - rightDistance)).toBeLessThanOrEqual(2);

    expect(metrics.avatarAnimationName).toBe('eventflow-jade-launcher-float');
    expect(metrics.closeAnimationName).toBe(metrics.avatarAnimationName);
    expect(metrics.closeAnimationDuration).toBe(metrics.avatarAnimationDuration);
  });

  test('keeps the notification visible when its image fails', async ({ page }) => {
    await page.evaluate(() => {
      const root = document.querySelector('.jade-widget-root');
      const asset = root.shadowRoot.querySelector('.jade-avatar-badge-asset');
      asset.dispatchEvent(new Event('error'));
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.jade-widget-root');
          const badge = root.shadowRoot.querySelector('.jade-avatar-badge');
          const style = getComputedStyle(badge);
          return {
            text: badge.textContent.trim(),
            fallback: badge.classList.contains('jade-avatar-badge--asset-fallback'),
            background: style.backgroundColor,
            color: style.color,
          };
        })
      )
      .toEqual({
        text: '1',
        fallback: true,
        background: 'rgb(239, 68, 68)',
        color: 'rgb(255, 255, 255)',
      });
  });

  test('hides the complete launcher and expires the configured dismissal', async ({ page }) => {
    await page.evaluate(() => {
      const root = document.querySelector('.jade-widget-root');
      root.shadowRoot.querySelector('.jade-launcher-dismiss').click();
    });

    await expect(page.locator('.jade-widget-root')).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.jade-widget-root');
          const avatar = root.shadowRoot.querySelector('.jade-avatar-button');
          const avatarRect = avatar.getBoundingClientRect();
          const style = getComputedStyle(root);
          return {
            hidden: root.hidden,
            ariaHidden: root.getAttribute('aria-hidden'),
            display: style.display,
            visibility: style.visibility,
            avatarWidth: avatarRect.width,
            avatarHeight: avatarRect.height,
          };
        })
      )
      .toEqual({
        hidden: true,
        ariaHidden: 'true',
        display: 'none',
        visibility: 'hidden',
        avatarWidth: 0,
        avatarHeight: 0,
      });

    const storedTimestamp = await page.evaluate(key => Number(localStorage.getItem(key)), DISMISSAL_KEY);
    expect(storedTimestamp).toBeGreaterThan(0);

    await page.evaluate(key => {
      localStorage.setItem(key, String(Date.now() - 2 * 60 * 60 * 1000));
    }, DISMISSAL_KEY);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPolishedLauncher(page);
    await expect(page.locator('.jade-widget-root')).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.jade-widget-root');
          const avatar = root.shadowRoot.querySelector('.jade-avatar-button');
          return {
            hidden: root.hidden,
            ariaHidden: root.getAttribute('aria-hidden'),
            visible: getComputedStyle(root).display !== 'none',
            avatarWidth: avatar.getBoundingClientRect().width,
            dismissal: localStorage.getItem('jadeassist-polish-browser-test-dismissed-at'),
          };
        })
      )
      .toMatchObject({ hidden: false, ariaHidden: null, visible: true, dismissal: null });

    const restoredAvatarWidth = await page.evaluate(() => {
      const root = document.querySelector('.jade-widget-root');
      return root.shadowRoot.querySelector('.jade-avatar-button').getBoundingClientRect().width;
    });
    expect(restoredAvatarWidth).toBeGreaterThan(0);
  });
});