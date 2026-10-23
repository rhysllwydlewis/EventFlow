import { test, expect } from '@playwright/test';

/**
 * The Setup guide's step button carries the wording of the Next steps card, which can be long
 * ("Write a description of at least 100 characters"). It must fit on a phone: the step button has
 * a row to itself and wraps, and Skip, Back and Next stay on one row beneath it.
 */
const LONG_LABELS = [
  'Add at least 3 gallery photos',
  'Write a description of at least 100 characters',
];

async function openGuide(page, context, baseURL, width, label) {
  await context.addCookies([
    { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    { name: 'test_auth', value: 'owner', url: baseURL },
  ]);
  await page.setViewportSize({ width, height: 800 });
  await page.route(
    url => !url.href.startsWith(baseURL),
    route => route.abort()
  );
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    const json = body =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.includes('csrf')) {
      return json({ csrfToken: 'test' });
    }
    if (pathname === '/api/v1/auth/me') {
      return json({ user: { id: 'u1', role: 'supplier', email: 'a@b.test', name: 'Test' } });
    }
    return json({});
  });
  await page.goto('/dashboard-supplier.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#sdh-guide-dialog').waitFor({ state: 'attached' });
  // Put the dialog on the last step, as the script does, without depending on what the page loaded.
  await page.evaluate(text => {
    const byId = id => document.getElementById(id);
    byId('sdh-guide-count').textContent = 'Step 3 of 3';
    byId('sdh-guide-title').textContent = 'Add photos';
    const action = byId('sdh-guide-action');
    action.hidden = false;
    action.textContent = text;
    byId('sdh-guide-back').hidden = false;
    byId('sdh-guide-next').textContent = 'Finish';
    byId('sdh-guide-dialog').showModal();
  }, label);
}

for (const width of [360, 406, 768]) {
  for (const label of LONG_LABELS) {
    test(`at ${width}px "${label}" fits in its button`, async ({ page, context, baseURL }) => {
      await openGuide(page, context, baseURL, width, label);
      const buttons = await page.evaluate(() =>
        [...document.querySelectorAll('#sdh-guide-dialog .sdh-dialog__foot .sdh-btn')]
          .filter(button => !button.hidden)
          .map(button => {
            const box = button.getBoundingClientRect();
            return {
              id: button.id,
              top: Math.round(box.top),
              spills: button.scrollWidth > button.clientWidth + 1,
            };
          })
      );
      expect(buttons.map(button => button.id)).toEqual(
        expect.arrayContaining([
          'sdh-guide-skip',
          'sdh-guide-back',
          'sdh-guide-action',
          'sdh-guide-next',
        ])
      );
      expect(buttons.filter(button => button.spills)).toEqual([]);
      const top = id => buttons.find(button => button.id === id).top;
      // The step button is on its own row above the others, which share one row.
      expect(top('sdh-guide-action')).toBeLessThan(top('sdh-guide-skip'));
      expect(top('sdh-guide-skip')).toBe(top('sdh-guide-back'));
      expect(top('sdh-guide-back')).toBe(top('sdh-guide-next'));
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(wide).toBe(false);
    });
  }
}
