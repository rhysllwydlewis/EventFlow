// @ts-check

import { test, expect } from '@playwright/test';

const HARNESS_PATH = '/test-jadeassist-launcher-polish.html';
const DISMISSAL_KEY = 'jadeassist-polish-browser-test-dismissed-at';

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

  test('uses the configured one-hour dismissal instead of the former 30-day lockout', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const root = document.querySelector('.jade-widget-root');
      root.shadowRoot.querySelector('.jade-launcher-dismiss').click();
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.jade-widget-root');
          return {
            hidden: root.hidden,
            stored: Number(localStorage.getItem('jadeassist-polish-browser-test-dismissed-at')),
          };
        })
      )
      .toMatchObject({ hidden: true });

    const storedTimestamp = await page.evaluate(key => Number(localStorage.getItem(key)), DISMISSAL_KEY);
    expect(storedTimestamp).toBeGreaterThan(0);

    await page.evaluate(key => {
      localStorage.setItem(key, String(Date.now() - 2 * 60 * 60 * 1000));
    }, DISMISSAL_KEY);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPolishedLauncher(page);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.jade-widget-root');
          return {
            hidden: root.hidden,
            dismissal: localStorage.getItem('jadeassist-polish-browser-test-dismissed-at'),
          };
        })
      )
      .toEqual({ hidden: false, dismissal: null });
  });
});
