// @ts-check
import { test, expect } from '@playwright/test';

const sampleTemplates = [
  {
    name: 'verification',
    purpose: 'Email address verification',
    filePath: 'email-templates/verification.html',
    category: 'account',
    categoryLabel: 'Account/security',
    variables: ['name', 'verificationLink'],
    html: '<!doctype html><html><body><main style="max-width:600px"><h1>Confirm your EventFlow account</h1><a href="https://event-flow.co.uk/verify?token=preview">Verify</a></main></body></html>',
  },
  {
    name: 'subscription-payment-failed',
    purpose: 'Failed payment action required',
    filePath: 'email-templates/subscription-payment-failed.html',
    category: 'billing',
    categoryLabel: 'Billing/subscription',
    variables: ['name', 'planName', 'amount'],
    html: '<!doctype html><html><body><main style="max-width:600px"><h1>Update your payment method</h1></main></body></html>',
  },
];

test('admin email previews gallery renders cards and preview frames with mocked admin API', async ({
  page,
}) => {
  await page.route('**/api/admin/email-previews', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, templates: sampleTemplates }),
    });
  });
  await page.route('**/api/csrf-token', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'visual-token' }),
    });
  });

  await page.goto('/admin-email-previews', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Email template previews' })).toBeVisible();
  await expect(page.locator('.email-preview-card')).toHaveCount(2);
  await expect(page.locator('iframe.email-preview-frame')).toHaveCount(2);
  await expect(page.getByText('subscription-payment-failed')).toBeVisible();
});
