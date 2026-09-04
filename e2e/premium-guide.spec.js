import { test, expect } from '@playwright/test';

const ARTICLE = '/articles/event-travel-costs-guide';

async function openGuide(page) {
  const response = await page.goto(ARTICLE, { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('[data-gp-article]')).toBeVisible();
  await expect(page.locator('.gp-title')).toContainText('Event Travel Costs');
}

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('premium event travel guide', () => {
  test('desktop layout, reading rail and calculator render as a premium article', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuide(page);

    await expect(page.locator('.gp-rail')).toBeVisible();
    await expect(page.locator('.gp-toc-mobile')).toBeHidden();
    await expect(page.locator('.gp-calc')).toBeVisible();
    await expect(page.locator('[data-gp-out="hmrc-amount"]')).toHaveText('£66.00');
    await expect(page.locator('[data-gp-out="verdict"]')).toContainText('£47.83');
    await expectNoPageOverflow(page);

    const styles = await page.locator('.gp-calc__head').evaluate(element => {
      const computed = getComputedStyle(element);
      return {
        backgroundImage: computed.backgroundImage,
        color: computed.color,
      };
    });
    expect(styles.backgroundImage).toContain('linear-gradient');
    expect(styles.backgroundImage.toLowerCase()).toContain('rgb(8, 107, 96)');
    expect(styles.color).toBe('rgb(255, 255, 255)');

    await testInfo.attach('premium-guide-desktop', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('calculator reacts to real inputs using the 2026/27 55p rate', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openGuide(page);

    const setRange = async (selector, value) => {
      await page.locator(selector).evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };

    await setRange('#gp-calc-miles', 200);
    await setRange('#gp-calc-mpg', 50);
    await setRange('#gp-calc-price', 160);

    await expect(page.locator('[data-gp-out="fuel"]')).toHaveText('£29.09');
    await expect(page.locator('[data-gp-out="hmrc-amount"]')).toHaveText('£110.00');
    await expect(page.locator('[data-gp-out="verdict"]')).toContainText('£80.91');
    await expect(page.locator('[data-gp-readout="gp-calc-price"]')).toHaveText('160.0p/L');
  });

  test('tablet layout stays contained and uses the compact contents navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openGuide(page);

    await expect(page.locator('.gp-rail')).toBeHidden();
    await expect(page.locator('.gp-toc-mobile')).toBeVisible();
    await expect(page.locator('.gp-table-wrap')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('mobile layout is overflow-safe and keeps wide tables inside their own scroller', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGuide(page);

    await expect(page.locator('.gp-rail')).toBeHidden();
    await expect(page.locator('.gp-toc-mobile')).toBeVisible();
    await page.locator('.gp-toc-mobile summary').click();
    await expect(page.locator('.gp-toc-mobile')).toHaveAttribute('open', '');
    await expectNoPageOverflow(page);

    const table = await page.locator('.gp-table-wrap').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(table.scrollWidth).toBeGreaterThan(table.clientWidth);

    const heroSource = await page.locator('.gp-hero__img').evaluate(image => ({
      sizes: image.getAttribute('sizes'),
      srcset: image.getAttribute('srcset'),
    }));
    expect(heroSource.sizes).toBe('100vw');
    expect(heroSource.srcset).toContain('640w');
    expect(heroSource.srcset).toContain('1600w');

    await testInfo.attach('premium-guide-mobile', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('scrollspy follows the reader into the mileage section', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuide(page);

    await page.locator('#calculating-fuel-and-mileage-costs').evaluate(element => {
      element.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(250);

    await expect(
      page.locator('.gp-toc__link[href="#calculating-fuel-and-mileage-costs"]')
    ).toHaveClass(/is-active/);
    const progress = Number(
      (await page.locator('[data-gp-ring-pct]').textContent())?.replace('%', '')
    );
    expect(progress).toBeGreaterThan(0);
  });

  test('reduced-motion users get fully visible static content', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openGuide(page);

    const reveal = await page
      .locator('.gp-reveal')
      .first()
      .evaluate(element => {
        const computed = getComputedStyle(element);
        return { opacity: computed.opacity, animationName: computed.animationName };
      });
    expect(reveal.opacity).toBe('1');
    expect(reveal.animationName).toBe('none');

    const heroAnimation = await page
      .locator('.gp-hero__media')
      .evaluate(element => getComputedStyle(element).animationName);
    expect(heroAnimation).toBe('none');
  });
});
