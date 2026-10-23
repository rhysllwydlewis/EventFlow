import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The settings page (/settings) for customers and suppliers, run against the static server with
 * every API call answered here, so no database is needed. These cover what the unit checks
 * cannot: a real page, real dialogs, and the exact requests the page sends.
 */

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const customer = {
  id: 'u1',
  role: 'customer',
  firstName: 'Sam',
  lastName: 'Jones',
  email: 'sam@example.test',
  phone: '',
  location: 'Cardiff',
  postcode: '',
  verified: true,
};
const supplier = { ...customer, id: 'u2', role: 'supplier', email: 'sup@example.test' };

const settingsFor = (overrides = {}) => ({
  notify: true,
  emailPrefs: {
    actionPrompts: {
      enabled: true,
      missingPackages: true,
      incompleteProfile: true,
      missingPhotos: true,
      uncategorized: true,
      packagesMissingPhotos: true,
    },
  },
  newsletterStatus: 'not-subscribed',
  communityDigestCadence: 'weekly',
  browseNudgeOptOut: false,
  verificationReminderOptOut: false,
  verified: true,
  ...overrides,
});

/**
 * Opens /settings signed in as `user`. `handlers` can answer any request first (return true when
 * handled); everything else gets a sensible default. Every request is recorded in `calls`.
 */
async function openSettings(page, context, baseURL, user, { settings, handlers = [] } = {}) {
  const calls = [];
  await context.addCookies([
    { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    { name: 'test_auth', value: 'owner', url: baseURL },
  ]);
  await page.route(
    url => !url.href.startsWith(baseURL),
    route => route.abort()
  );
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : undefined;
    calls.push({ method, pathname, body });
    for (const handler of handlers) {
      if (await handler(route, { method, pathname, body })) {
        return;
      }
    }
    if (pathname.includes('csrf')) {
      return json(route, { csrfToken: 'test' });
    }
    if (pathname === '/api/v1/auth/me') {
      return json(route, { user });
    }
    if (pathname === '/api/me/settings' && method === 'GET') {
      return settings === null ? json(route, {}, 500) : json(route, settings || settingsFor());
    }
    if (pathname === '/api/me/settings' && method === 'POST') {
      return json(route, { ok: true });
    }
    return json(route, {}, 404);
  });
  await page.goto('/settings.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#profile-form:not([hidden]), #profile-load-error:not([hidden])').waitFor();
  return calls;
}

const settingsPosts = calls =>
  calls.filter(c => c.pathname === '/api/me/settings' && c.method === 'POST');

test.describe('Settings: account details', () => {
  test('the "verification email will be sent" note shows only once the address changes', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer);
    const hint = page.locator('#email-change-hint');
    await expect(hint).toBeHidden();
    await page.fill('#profile-email', 'new@example.test');
    await expect(hint).toBeVisible();
    await page.fill('#profile-email', customer.email);
    await expect(hint).toBeHidden();
  });

  test('a failed load offers a retry and never shows an empty, savable form', async ({
    page,
    context,
    baseURL,
  }) => {
    // Other scripts on the page ask for the account too, so the failure is held until the retry.
    let failing = true;
    await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname }) => {
          if (pathname === '/api/v1/auth/me' && failing) {
            json(route, {}, 500);
            return true;
          }
          return false;
        },
      ],
    });
    await expect(page.locator('#profile-load-error')).toBeVisible();
    await expect(page.locator('#profile-form')).toBeHidden();
    failing = false;
    await page.click('#profile-retry-btn');
    await expect(page.locator('#profile-form')).toBeVisible();
    await expect(page.locator('#profile-firstName')).toHaveValue('Sam');
  });

  test('an account whose email is not verified can send the verification email again', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer, {
      settings: settingsFor({ verified: false }),
      handlers: [
        (route, { pathname }) => {
          if (pathname === '/api/v1/auth/resend-verification') {
            json(route, { ok: true });
            return true;
          }
          return false;
        },
      ],
    });
    await expect(page.locator('#email-unverified-notice')).toBeVisible();
    await expect(page.locator('#verification-reminder-row')).toBeVisible();
    await page.click('#resend-verification-btn');
    await expect(page.locator('#resend-verification-status')).toContainText(
      'Verification email sent'
    );
    const sent = calls.find(c => c.pathname === '/api/v1/auth/resend-verification');
    expect(sent.body).toEqual({ email: customer.email });
  });

  test('a verified account is not nagged', async ({ page, context, baseURL }) => {
    await openSettings(page, context, baseURL, customer);
    await expect(page.locator('#email-unverified-notice')).toBeHidden();
  });

  test('saving keeps the form on screen and reports it', async ({ page, context, baseURL }) => {
    const calls = await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname, method }) => {
          if (pathname === '/api/profile' && method === 'PUT') {
            json(route, { ok: true });
            return true;
          }
          return false;
        },
      ],
    });
    await page.fill('#profile-phone', '+44 7700 900123');
    await page.click('#profile-save-btn');
    await expect(page.locator('#profile-status')).toContainText('Changes saved');
    await expect(page.locator('#profile-form')).toBeVisible();
    const put = calls.find(c => c.pathname === '/api/profile' && c.method === 'PUT');
    expect(put.body.phone).toBe('+44 7700 900123');
    expect(put.body.email).toBeUndefined();
  });
});

test.describe('Settings: profile photo', () => {
  test('the upload control is a button a keyboard can reach and press', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer);
    // A real <button>: it takes focus, and Enter on it opens the file chooser.
    const button = page.locator('#avatar-upload-btn');
    await expect(button).toHaveJSProperty('tagName', 'BUTTON');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.press('Enter')]);
    expect(chooser).toBeTruthy();
  });

  test('a file that is not an image, or is over 5 MB, is refused before anything is sent', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer);
    await page.setInputFiles('#avatar-upload-input', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.locator('#avatar-status')).toContainText('JPG, PNG or WebP');
    await page.setInputFiles('#avatar-upload-input', {
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(6 * 1024 * 1024, 1),
    });
    await expect(page.locator('#avatar-status')).toContainText('5 MB');
    expect(calls.some(c => c.pathname === '/api/profile/avatar')).toBe(false);
  });

  test('removing the photo asks in a dialog, not a browser confirm', async ({
    page,
    context,
    baseURL,
  }) => {
    let nativeDialog = false;
    page.on('dialog', dialog => {
      nativeDialog = true;
      dialog.dismiss();
    });
    const calls = await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname, method }) => {
          if (pathname === '/api/profile/avatar' && method === 'DELETE') {
            json(route, { ok: true });
            return true;
          }
          return false;
        },
      ],
    });
    await page.click('#avatar-delete-btn');
    await expect(page.locator('#remove-photo-dialog')).toBeVisible();
    await page.click('#remove-photo-cancel');
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
    await page.click('#avatar-delete-btn');
    await page.click('#remove-photo-confirm');
    await expect(page.locator('#avatar-status')).toContainText('Photo removed');
    expect(nativeDialog).toBe(false);
  });
});

test.describe('Settings: notification preferences', () => {
  test('a customer saves the toggles, the digest and the saved-supplier reminders', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer);
    await page.locator('#notify').evaluate(el => (el.checked = false));
    await page.selectOption('#community-digest-cadence', 'daily');
    await page.locator('#browse-nudge-enabled').evaluate(el => (el.checked = false));
    await page.click('#save-settings');
    await expect(page.locator('#settings-status')).toContainText('Preferences saved');
    const [post] = settingsPosts(calls);
    expect(post.body).toEqual({
      notify: false,
      communityDigestCadence: 'daily',
      browseNudgeOptOut: true,
    });
  });

  test('a supplier also saves the reminder emails, and the master switch disables the rest', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, supplier);
    await expect(page.locator('#supplier-reminder-prefs')).toBeVisible();
    await expect(page.locator('#browse-nudge-row')).toBeHidden();
    await page.locator('#ap-enabled').evaluate(el => {
      el.checked = false;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#ap-missing-packages')).toBeDisabled();
    await page.click('#save-settings');
    await expect(page.locator('#settings-status')).toContainText('Preferences saved');
    const [post] = settingsPosts(calls);
    expect(post.body.emailPrefs.actionPrompts.enabled).toBe(false);
    expect(post.body.browseNudgeOptOut).toBeUndefined();
  });

  test('when the saved preferences could not be read, saving never overwrites them with defaults', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, supplier, { settings: null });
    await page.click('#save-settings');
    await expect(page.locator('#settings-status')).toContainText('Preferences saved');
    const [post] = settingsPosts(calls);
    expect(Object.keys(post.body)).toEqual(['notify']);
  });

  test('a failed save says so and does not change the sound settings kept on this device', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname, method }) => {
          if (pathname === '/api/me/settings' && method === 'POST') {
            json(route, { error: 'nope' }, 500);
            return true;
          }
          return false;
        },
      ],
    });
    await page.locator('#notification-volume').fill('80');
    await page.click('#save-settings');
    await expect(page.locator('#settings-status')).toContainText('Could not save');
    await expect(page.locator('#save-settings')).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('ef_notification_volume'))).toBeNull();
  });

  test('the newsletter button uses the saved address, not what is typed in the email box', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname }) => {
          if (pathname === '/api/newsletter/subscribe') {
            json(route, { ok: true });
            return true;
          }
          return false;
        },
      ],
    });
    await page.fill('#profile-email', 'someone-else@example.test');
    await page.click('#newsletter-toggle-btn');
    await expect(page.locator('#newsletter-status-text')).toContainText('Check your inbox');
    const sent = calls.find(c => c.pathname === '/api/newsletter/subscribe');
    expect(sent.body).toEqual({ email: customer.email });
  });
});

test.describe('Settings: password', () => {
  test('the page applies the same rule as the server before sending', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer);
    await page.fill('#cp-current', 'OldPassword1');
    await page.fill('#cp-new', 'onlyletters');
    await page.fill('#cp-confirm', 'onlyletters');
    await page.click('#cp-save-btn');
    await expect(page.locator('#cp-status')).toContainText('a letter and a number');
    await page.fill('#cp-new', 'letters123');
    await page.fill('#cp-confirm', 'different123');
    await page.click('#cp-save-btn');
    await expect(page.locator('#cp-status')).toContainText('do not match');
    expect(calls.some(c => c.pathname === '/api/auth/change-password')).toBe(false);
  });

  test('the strength meter reports a level, and the colour comes from the stylesheet', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer);
    await expect(page.locator('#cp-strength-bar')).toBeHidden();
    await page.fill('#cp-new', 'Abcdefgh1!xyz');
    await expect(page.locator('#cp-strength-label')).toHaveText('Very strong');
    await expect(page.locator('#cp-strength-bar')).toHaveAttribute('data-strength', '5');
    expect(await page.getAttribute('#cp-strength-label', 'style')).toBeNull();
  });
});

test.describe('Settings: delete account', () => {
  test('Escape closes the dialog and hands focus back to the button that opened it', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer);
    await page.click('#delete-account-btn');
    await expect(page.locator('#delete-account-modal')).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.getElementById('delete-account-modal').matches('dialog:modal')
      )
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#delete-account-modal')).toBeHidden();
    await expect(page.locator('#delete-account-btn')).toBeFocused();
    // ...and it opens again afterwards.
    await page.click('#delete-account-btn');
    await expect(page.locator('#delete-account-modal')).toBeVisible();
  });

  test('keyboard focus cannot leave the open dialog for the page behind it', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, customer);
    await page.click('#delete-account-btn');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const behind = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active !== document.body &&
          !document.getElementById('delete-account-modal').contains(active)
        );
      });
      expect(behind).toBe(false);
    }
  });

  test('the wrong email is refused, the right one reaches the last step, and only then is anything sent', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, customer, {
      handlers: [
        (route, { pathname, method }) => {
          if (pathname === '/api/profile' && method === 'DELETE') {
            json(route, { ok: true });
            return true;
          }
          return false;
        },
      ],
    });
    await page.click('#delete-account-btn');
    await page.click('#delete-step1-next');
    await page.fill('#delete-email-input', 'wrong@example.test');
    await page.click('#delete-step2-next');
    await expect(page.locator('#delete-email-error')).toContainText('does not match');
    await page.fill('#delete-email-input', 'SAM@example.test');
    await page.click('#delete-step2-next');
    await expect(page.locator('#delete-step-3')).toBeVisible();
    await expect(page.locator('#delete-account-modal')).toHaveAttribute(
      'aria-labelledby',
      'delete-modal-title-3'
    );
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
    await page.click('#delete-step3-confirm');
    await expect
      .poll(() => calls.find(c => c.method === 'DELETE')?.body)
      .toEqual({
        email: customer.email,
      });
  });
});

test.describe('Settings: account type', () => {
  test('switching to a customer needs CONVERT typed, then sends one request', async ({
    page,
    context,
    baseURL,
  }) => {
    const calls = await openSettings(page, context, baseURL, supplier, {
      handlers: [
        (route, { pathname }) => {
          if (pathname === '/api/v1/me/settings/account-type') {
            json(route, { ok: true, role: 'customer', redirect: '/settings.html' });
            return true;
          }
          return false;
        },
      ],
    });
    await page.click('#account-type-customer-trigger');
    await expect(page.locator('#downgrade-dialog')).toBeVisible();
    await expect(page.locator('#downgrade-confirm')).toBeDisabled();
    await page.fill('#account-type-convert-confirm', 'nope');
    await expect(page.locator('#downgrade-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#downgrade-dialog')).toBeHidden();
    await expect(page.locator('#account-type-customer-trigger')).toBeFocused();
    expect(calls.some(c => c.pathname === '/api/v1/me/settings/account-type')).toBe(false);

    await page.click('#account-type-customer-trigger');
    await page.fill('#account-type-convert-confirm', 'convert');
    await expect(page.locator('#downgrade-confirm')).toBeEnabled();
    await page.click('#downgrade-confirm');
    await expect
      .poll(() => calls.find(c => c.pathname === '/api/v1/me/settings/account-type')?.body)
      .toEqual({ targetRole: 'customer' });
  });

  test('a refused switch closes the dialog and says why beside the button', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, supplier, {
      handlers: [
        (route, { pathname }) => {
          if (pathname === '/api/v1/me/settings/account-type') {
            json(route, { error: 'Too soon', code: 'COOLDOWN_ACTIVE', retryAfterDays: 3 }, 429);
            return true;
          }
          return false;
        },
      ],
    });
    await page.click('#account-type-customer-trigger');
    await page.fill('#account-type-convert-confirm', 'CONVERT');
    await page.click('#downgrade-confirm');
    await expect(page.locator('#downgrade-dialog')).toBeHidden();
    await expect(page.locator('#account-type-customer-status')).toContainText('3 day(s)');
  });

  test('the account type card and its link are not shown to an admin', async ({
    page,
    context,
    baseURL,
  }) => {
    await openSettings(page, context, baseURL, { ...customer, role: 'admin' });
    await expect(page.locator('#account-type-card')).toBeHidden();
    await expect(page.locator('#settings-nav-account-type')).toBeHidden();
  });
});

test.describe('Settings: accessibility', () => {
  for (const [label, user] of [
    ['customer', customer],
    ['supplier', supplier],
  ]) {
    test(`no axe violations for a ${label}`, async ({ page, context, baseURL }) => {
      await openSettings(page, context, baseURL, user);
      // The page's own content; the site header and footer are shared and audited elsewhere.
      const result = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
        .analyze();
      expect(
        result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)
      ).toEqual([]);
    });
  }
});
