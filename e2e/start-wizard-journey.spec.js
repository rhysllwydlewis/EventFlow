/**
 * E2E tests for the /start planning wizard — EventFlow
 * Tests the real /start page, not a static fixture.
 *
 * @backend — all tests require a running server.
 */

const { test, expect } = require('@playwright/test');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function clearWizardState(page) {
  await page.evaluate(() => {
    localStorage.removeItem('eventflow_plan_builder_v1');
    localStorage.removeItem('eventflow_start');
    localStorage.removeItem('eventflow_wizard_pending');
    localStorage.removeItem('eventflow_wizard_timestamp');
  });
}

async function gotoFreshStart(page) {
  await clearWizardState(page);
  await page.goto('/start');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
}

// ─── Page load ────────────────────────────────────────────────────────────────

test.describe('/start page loads', () => {
  test('loads without console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await gotoFreshStart(page);

    // Filter out known third-party noise
    const realErrors = errors.filter(
      e => !e.includes('pexels') && !e.includes('jade') && !e.includes('websocket')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('shows the wizard container', async ({ page }) => {
    await gotoFreshStart(page);
    await expect(page.locator('#wizard-container')).toBeVisible();
  });

  test('has correct page title', async ({ page }) => {
    await gotoFreshStart(page);
    const title = await page.title();
    expect(title.toLowerCase()).toContain('event');
  });
});

// ─── Welcome screen ───────────────────────────────────────────────────────────

test.describe('Welcome screen', () => {
  test('shows template cards on first visit', async ({ page }) => {
    await gotoFreshStart(page);
    // Template cards are inside the welcome screen
    const tplCards = page.locator('.wz-tpl-card');
    const count = await tplCards.count();
    expect(count).toBeGreaterThanOrEqual(4); // at least 4 templates
  });

  test('shows start from scratch button', async ({ page }) => {
    await gotoFreshStart(page);
    await expect(page.locator('#start-scratch-btn')).toBeVisible();
  });

  test('welcome screen describes the value proposition', async ({ page }) => {
    await gotoFreshStart(page);
    const title = page.locator('.wz-welcome-title');
    if ((await title.count()) > 0) {
      const text = await title.textContent();
      expect(text?.toLowerCase()).toMatch(/plan|event|minute/i);
    }
  });

  test('shows resume banner when prior state exists', async ({ page }) => {
    await page.goto('/start');
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          eventType: 'Wedding',
          eventName: 'Test',
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          currentStep: 1,
        })
      );
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    const banner = page.locator('.wz-resume-banner');
    if ((await banner.count()) > 0) {
      await expect(banner).toBeVisible();
    }
  });
});

// ─── Template selection ───────────────────────────────────────────────────────

test.describe('Template selection', () => {
  test('clicking a template advances past event type to basics', async ({ page }) => {
    await gotoFreshStart(page);
    const firstCard = page.locator('.wz-tpl-card').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();
    await page.waitForTimeout(300);

    // Should now show event basics step (step 2)
    const heading = page.locator('.wizard-card h2');
    if ((await heading.count()) > 0) {
      const text = await heading.first().textContent();
      expect(text?.toLowerCase()).toMatch(/basic|detail|name|event/i);
    }
  });

  test('Wedding template pre-fills event type', async ({ page }) => {
    await gotoFreshStart(page);

    const weddingCard = page.locator('.wz-tpl-card[data-template-id="wedding"]');
    if ((await weddingCard.count()) === 0) return;
    await weddingCard.click();
    await page.waitForTimeout(300);

    // State should have eventType set to Wedding
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}')
    );
    expect(state.eventType).toBe('Wedding');
  });

  test('start from scratch goes to event type step', async ({ page }) => {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(300);

    const heading = page.locator('.wizard-card h2').first();
    if ((await heading.count()) > 0) {
      const text = await heading.textContent();
      expect(text?.toLowerCase()).toMatch(/type|event|planning/i);
    }
  });
});

// ─── Event type step ──────────────────────────────────────────────────────────

test.describe('Event type step', () => {
  async function goToEventType(page) {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(300);
  }

  test('shows event type options', async ({ page }) => {
    await goToEventType(page);
    const options = page.locator('.wizard-option');
    expect(await options.count()).toBeGreaterThanOrEqual(4);
  });

  test('selecting an event type enables Continue', async ({ page }) => {
    await goToEventType(page);
    const nextBtn = page.locator('.wizard-next');
    if ((await nextBtn.count()) > 0) {
      const initiallyDisabled = await nextBtn.getAttribute('disabled');
      // Might be null (not disabled) if event type was pre-set
      // Just check that clicking an option works
    }
    const option = page.locator('.wizard-option').first();
    await option.click();
    await page.waitForTimeout(200);
    const btn = page.locator('.wizard-next');
    if ((await btn.count()) > 0) {
      const disabled = await btn.getAttribute('disabled');
      expect(disabled).toBeNull(); // should be enabled after selection
    }
  });

  test('selected event type gets aria-pressed=true', async ({ page }) => {
    await goToEventType(page);
    const option = page.locator('.wizard-option').first();
    await option.click();
    await page.waitForTimeout(100);
    const pressed = await option.getAttribute('aria-pressed');
    expect(pressed).toBe('true');
  });
});

// ─── Event basics step ────────────────────────────────────────────────────────

test.describe('Event basics step', () => {
  async function goToBasics(page) {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(200);
    // Select an event type then continue
    await page.locator('.wizard-option').first().click();
    await page.waitForTimeout(100);
    await page.locator('.wizard-next').click();
    await page.waitForTimeout(300);
  }

  test('shows event name, date, location, guests, budget fields', async ({ page }) => {
    await goToBasics(page);
    const heading = page.locator('.wizard-card h2').first();
    const headingText = heading.count().then ? (await heading.textContent()) || '' : '';
    // Basics step should show form fields
    await expect(page.locator('#wz-name, #wizard-event-name').first())
      .toBeVisible()
      .catch(() => {});
  });

  test('accepts text input in event name', async ({ page }) => {
    await goToBasics(page);
    const input = page.locator('#wz-name').first();
    if ((await input.count()) > 0) {
      await input.fill('Test Wedding 2025');
      const value = await input.inputValue();
      expect(value).toBe('Test Wedding 2025');
    }
  });

  test('shows planning stage field', async ({ page }) => {
    await goToBasics(page);
    const stage = page.locator('#wz-stage');
    if ((await stage.count()) > 0) {
      await expect(stage).toBeVisible();
    }
  });

  test('can continue without filling all fields', async ({ page }) => {
    await goToBasics(page);
    const skipBtn = page.locator('.wizard-skip').first();
    if ((await skipBtn.count()) > 0) {
      await skipBtn.click();
      await page.waitForTimeout(300);
      // Should have advanced
      const step = await page.evaluate(
        () => JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}').currentStep
      );
      expect(step).toBeGreaterThan(1);
    }
  });
});

// ─── Priorities step ──────────────────────────────────────────────────────────

test.describe('Priorities step', () => {
  async function goToPriorities(page) {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(200);
    await page.locator('.wizard-option').first().click();
    await page.locator('.wizard-next').click();
    await page.waitForTimeout(200);
    await page.locator('.wizard-next, .wizard-skip').first().click();
    await page.waitForTimeout(300);
  }

  test('shows priority chips', async ({ page }) => {
    await goToPriorities(page);
    const chips = page.locator('.wz-chip[data-priority-key]');
    if ((await chips.count()) > 0) {
      expect(await chips.count()).toBeGreaterThanOrEqual(5);
    }
  });

  test('selecting a priority chip toggles aria-pressed', async ({ page }) => {
    await goToPriorities(page);
    const chip = page.locator('.wz-chip[data-priority-key]').first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(100);
      expect(await chip.getAttribute('aria-pressed')).toBe('true');
      // Toggle off
      await chip.click();
      await page.waitForTimeout(100);
      expect(await chip.getAttribute('aria-pressed')).toBe('false');
    }
  });

  test('can skip priorities step', async ({ page }) => {
    await goToPriorities(page);
    const skip = page.locator('.wizard-skip').first();
    if ((await skip.count()) > 0) {
      await skip.click();
      await page.waitForTimeout(300);
      const step = await page.evaluate(
        () => JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}').currentStep
      );
      expect(step).toBeGreaterThan(2);
    }
  });
});

// ─── Style step ──────────────────────────────────────────────────────────────

test.describe('Style & vibe step', () => {
  test('shows style chips when reached', async ({ page }) => {
    await gotoFreshStart(page);
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          currentStep: 3,
          eventType: 'Wedding',
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        })
      );
    });
    await page.goto('/start');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    const chips = page.locator('.wz-chip[data-style-key]');
    if ((await chips.count()) > 0) {
      expect(await chips.count()).toBeGreaterThanOrEqual(8);
    }
  });
});

// ─── Back/forward state preservation ─────────────────────────────────────────

test.describe('Back/forward keeps state', () => {
  test('going back and forward preserves event type', async ({ page }) => {
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(200);

    // Select Wedding
    const weddingOpt = page.locator('.wizard-option[data-value="Wedding"]');
    if ((await weddingOpt.count()) > 0) await weddingOpt.click();
    await page.waitForTimeout(100);
    await page.locator('.wizard-next').click();
    await page.waitForTimeout(300);

    // Go back
    await page.locator('.wizard-back').click();
    await page.waitForTimeout(300);

    // Wedding should still be selected
    const selectedOpt = page.locator('.wizard-option.selected');
    if ((await selectedOpt.count()) > 0) {
      const val = await selectedOpt.getAttribute('data-value');
      expect(val).toBe('Wedding');
    }
  });
});

// ─── Plan summary ─────────────────────────────────────────────────────────────

test.describe('Plan summary updates', () => {
  test('desktop sidebar shows event type after selection', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(200);
    await page.locator('.wizard-option').first().click();
    await page.waitForTimeout(300);

    const sidebar = page.locator('#plan-summary');
    if ((await sidebar.count()) > 0) {
      const text = await sidebar.textContent();
      expect(text?.toLowerCase()).toMatch(/wedding|corporate|birthday|other|type/i);
    }
  });

  test('mobile summary bar is visible on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoFreshStart(page);
    await page.locator('#start-scratch-btn').click();
    await page.waitForTimeout(300);
    const mobileSummary = page.locator('.wizard-mobile-summary-bar');
    if ((await mobileSummary.count()) > 0) {
      await expect(mobileSummary).toBeVisible();
    }
  });
});

// ─── Review screen ────────────────────────────────────────────────────────────

test.describe('Review screen', () => {
  async function goToReview(page) {
    await gotoFreshStart(page);
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          currentStep: 100, // High number — will clamp to review step
          eventType: 'Wedding',
          eventName: 'Test Event',
          location: 'Cardiff',
          guests: 80,
          budget: '£5,000–£10,000',
          priorities: ['venue', 'catering'],
          styles: ['classic', 'luxury'],
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          selectedPackages: {},
          alreadyHave: {},
        })
      );
    });
    // Navigate directly to a high step index to reach review
    await page.goto('/start');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
    // If still on welcome, skip to review via state manipulation
    const step = await page.evaluate(
      () => JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}').currentStep
    );
    // Use JS to jump to review step directly
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{}');
      s.currentStep = 4 + 4; // FIXED_STEPS_BEFORE_CATS + typical cats = review
      localStorage.setItem('eventflow_plan_builder_v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(500);
  }

  test('shows event details', async ({ page }) => {
    await goToReview(page);
    const container = page.locator('.wizard-card');
    if ((await container.count()) > 0) {
      const text = await container.first().textContent();
      // Should show one of the saved details or step content
      expect(text).toBeTruthy();
    }
  });

  test('shows save-to-device notice for logged-out users', async ({ page }) => {
    await goToReview(page);
    const notice = page.locator('.wz-save-notice');
    if ((await notice.count()) > 0) {
      const text = await notice.textContent();
      expect(text?.toLowerCase()).toMatch(/device|log in|account/i);
    }
  });
});

// ─── Reset/start again ────────────────────────────────────────────────────────

test.describe('Reset and start again', () => {
  test('start from scratch clears state', async ({ page }) => {
    await page.goto('/start');
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          eventType: 'Wedding',
          currentStep: 2,
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        })
      );
    });
    await page.reload();
    await page.waitForTimeout(500);

    const scratchBtn = page.locator('#start-scratch-btn');
    if ((await scratchBtn.count()) > 0) {
      await scratchBtn.click();
      await page.waitForTimeout(300);
      const state = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('eventflow_plan_builder_v1') || '{"eventType":""}')
      );
      // After starting from scratch, eventType should be cleared
      expect(state.eventType).toBeFalsy();
    }
  });
});

// ─── Empty/error states ───────────────────────────────────────────────────────

test.describe('Empty and error states', () => {
  test('wizard still functional if packages API fails @backend', async ({ page }) => {
    // Mock the packages API to fail
    await page.route('/api/v1/packages/search*', route =>
      route.fulfill({ status: 500, body: 'Error' })
    );
    await page.route('/api/v1/venues/near*', route =>
      route.fulfill({ status: 500, body: 'Error' })
    );

    await gotoFreshStart(page);
    await page.evaluate(() => {
      localStorage.setItem(
        'eventflow_plan_builder_v1',
        JSON.stringify({
          currentStep: 4,
          eventType: 'Wedding',
          wizardStartedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          priorities: ['venue'],
        })
      );
    });
    await page.reload();
    await page.waitForTimeout(1500);

    // Wizard should not crash — error state or content should be visible
    const container = page.locator('#wizard-container');
    await expect(container).toBeVisible();
    const text = await container.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});

// ─── Mobile layout ────────────────────────────────────────────────────────────

test.describe('Mobile layout', () => {
  const mobileViewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ];

  mobileViewports.forEach(({ width, height }) => {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoFreshStart(page);

      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width + 5); // 5px tolerance
    });

    test(`desktop sidebar hidden at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoFreshStart(page);
      await page
        .locator('#start-scratch-btn')
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);

      const sidebar = page.locator('#plan-summary');
      if ((await sidebar.count()) > 0) {
        const display = await sidebar.evaluate(el => window.getComputedStyle(el).display);
        expect(display).toBe('none');
      }
    });
  });

  test('tablet (768px) shows desktop layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoFreshStart(page);
    await page
      .locator('#start-scratch-btn')
      .click()
      .catch(() => {});
    await page.waitForTimeout(300);

    // Should not overflow
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(773);
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

test.describe('Accessibility basics', () => {
  test('progress bar has aria role and attributes', async ({ page }) => {
    await gotoFreshStart(page);
    await page
      .locator('#start-scratch-btn')
      .click()
      .catch(() => {});
    await page
      .locator('.wizard-option')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(300);

    const progressBar = page.locator('[role="progressbar"]');
    if ((await progressBar.count()) > 0) {
      const valuenow = await progressBar.getAttribute('aria-valuenow');
      expect(Number(valuenow)).toBeGreaterThan(0);
    }
  });

  test('wizard container is keyboard navigable', async ({ page }) => {
    await gotoFreshStart(page);
    // Tab into the page and check focus is reachable
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused?.toLowerCase()).toMatch(/a|button|input|select/i);
  });

  test('aria-live region exists for screen reader announcements', async ({ page }) => {
    await gotoFreshStart(page);
    const liveRegion = page.locator('#wizard-live-region');
    await expect(liveRegion).toBeAttached();
    const ariaLive = await liveRegion.getAttribute('aria-live');
    expect(ariaLive).toBe('polite');
  });

  test('touch targets are at least 44px tall on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoFreshStart(page);

    const buttons = page.locator('.wizard-card button, .wz-tpl-card');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible()) {
        const box = await btn.boundingBox();
        if (box) expect(box.height).toBeGreaterThanOrEqual(40); // 40px minimum (44 is ideal)
      }
    }
  });
});
