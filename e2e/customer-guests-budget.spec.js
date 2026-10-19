import fs from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * Customer guest list (/guests) and budget (/budget) pages, run against the static server with
 * every API call answered here, so no database is needed. These cover the behaviour the source
 * checks in tests/unit/guests-manager.test.js and budget-page.test.js cannot: a real page, real
 * dialogs, and the exact requests the pages send.
 */

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Opens `path` signed in (the static server's protected-page guard looks for test_auth), with the
 * cookie banner out of the way and non-local requests blocked.
 */
async function open(page, context, baseURL, path) {
  await context.addCookies([
    { name: 'eventflow_cookie_consent', value: 'rejected', url: baseURL },
    { name: 'test_auth', value: 'owner', url: baseURL },
  ]);
  await page.route(
    url => !url.href.startsWith(baseURL),
    route => route.abort()
  );
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

test.describe('Customer budget page', () => {
  const makePlan = () => ({
    id: 'p1',
    name: 'Our wedding',
    eventDate: '2027-06-19',
    budget: '10000',
    budgetUpdatedAt: 'v1',
    budgetItems: [
      { id: 'a', category: 'Venue', item: 'Venue hire', estimated: 5000, actual: 5200, paid: 2000 },
      { id: 'b', category: 'Catering', item: 'Wedding breakfast', estimated: 3000 },
    ],
  });

  /** Answers the plan APIs from `plans`; `onSave` decides what a budget save returns. */
  async function mockPlans(page, plans, onSave) {
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.includes('csrf')) {
        return json(route, { csrfToken: 'test' });
      }
      if (pathname === '/api/me/plans') {
        return json(route, { plans });
      }
      if (pathname.endsWith('/budget') && request.method() === 'POST') {
        return onSave(route, JSON.parse(request.postData()));
      }
      return json(route, {}, 404);
    });
  }

  test('shows the plan total and what is committed', async ({ page, context, baseURL }) => {
    await mockPlans(page, [makePlan()], route => json(route, {}, 500));
    await open(page, context, baseURL, '/budget.html');
    await expect(page.locator('.bp-table--items tbody tr')).toHaveCount(2);
    const summary = page.locator('.bp-summary, #bp-summary').first();
    await expect(summary).toContainText('£10,000');
    await expect(summary).toContainText('£8,200');
  });

  test('every save sends the version it started from and moves on to the new one', async ({
    page,
    context,
    baseURL,
  }) => {
    const saves = [];
    await mockPlans(page, [makePlan()], (route, body) => {
      saves.push(body);
      return json(route, {
        success: true,
        budgetItems: body.budgetItems,
        budgetUpdatedAt: `v${saves.length + 1}`,
      });
    });
    await open(page, context, baseURL, '/budget.html');
    for (const name of ['Flowers', 'Cake']) {
      await page.locator('.bp-head [data-action="add"]').click();
      await page.fill('#bp-f-item', name);
      await page.fill('#bp-f-estimated', '100');
      await page.click('#bp-item-save');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }
    expect(saves.map(save => save.baseVersion)).toEqual(['v1', 'v2']);
    expect(saves[1].budgetItems).toHaveLength(4);
  });

  test('a save refused because the budget changed elsewhere says so and keeps the dialog open', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockPlans(page, [makePlan()], route =>
      json(
        route,
        { error: 'This budget was changed somewhere else. Reload to see the latest.' },
        409
      )
    );
    await open(page, context, baseURL, '/budget.html');
    await page.locator('.bp-head [data-action="add"]').click();
    await page.fill('#bp-f-item', 'Flowers');
    await page.fill('#bp-f-estimated', '100');
    await page.click('#bp-item-save');
    await expect(page.locator('#bp-form-error')).toContainText('changed somewhere else');
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('#bp-item-save')).toBeEnabled();
  });

  test('Download PDF produces a real multi-page PDF (the PDF library is served from our own origin)', async ({
    page,
    context,
    baseURL,
  }) => {
    const plan = makePlan();
    plan.budgetItems = Array.from({ length: 60 }, (_, index) => ({
      id: `item${index}`,
      category: index % 2 ? 'Catering' : 'Venue',
      item: `Budget line number ${index + 1}`,
      estimated: 100 + index,
    }));
    await mockPlans(page, [plan], route => json(route, {}, 500));
    await open(page, context, baseURL, '/budget.html');
    await expect(page.locator('.bp-table--items tbody tr')).toHaveCount(60);
    await page.locator('#bp-export-menu summary').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-action="export-pdf"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^eventflow-budget-.*\.pdf$/);
    const bytes = fs.readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [];
    expect(pages.length).toBeGreaterThan(1);
    await expect(page.locator('#bp-toast')).toContainText('downloaded as PDF');
  });

  test('if the PDF library fails to load the page says so, and the next try loads it again', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockPlans(page, [makePlan()], route => json(route, {}, 500));
    let attempts = 0;
    await page.route('**/assets/js/vendor/jspdf.umd.min.js*', route => {
      attempts += 1;
      return attempts === 1 ? route.abort() : route.continue();
    });
    await open(page, context, baseURL, '/budget.html');
    await expect(page.locator('.bp-table--items tbody tr')).toHaveCount(2);
    await page.locator('#bp-export-menu summary').click();
    await page.locator('[data-action="export-pdf"]').click();
    await expect(page.locator('#bp-toast')).toContainText('could not create the PDF');
    await page.locator('#bp-export-menu summary').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-action="export-pdf"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(attempts).toBe(2);
  });

  test('switching plan puts it in the address, so a reload stays on that plan', async ({
    page,
    context,
    baseURL,
  }) => {
    const second = { ...makePlan(), id: 'p2', name: 'Birthday', budgetItems: [] };
    await mockPlans(page, [makePlan(), second], route => json(route, {}, 500));
    await open(page, context, baseURL, '/budget.html?plan=p1&source=test');
    await expect(page.locator('#bp-plan-select')).toHaveValue('p1');
    await page.selectOption('#bp-plan-select', 'p2');
    await expect.poll(() => new URL(page.url()).searchParams.get('plan')).toBe('p2');
    expect(new URL(page.url()).searchParams.get('source')).toBe('test');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#bp-plan-select')).toHaveValue('p2');
  });
});

test.describe('Customer guest list', () => {
  const existing = [
    {
      id: 'g1',
      name: 'Ann Existing',
      email: 'ann@example.com',
      rsvpStatus: 'pending',
      partySize: 1,
    },
  ];

  /**
   * Answers the plan and guest APIs; bulk imports are recorded in `bulk`. `respond(route, body)`
   * can answer a bulk import differently from the default (every guest added, none skipped).
   */
  async function mockGuests(page, bulk, respond) {
    await page.route('**/api/**', route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname.includes('csrf')) {
        return json(route, { csrfToken: 'test' });
      }
      if (pathname === '/api/me/plans') {
        return json(route, {
          plans: [
            { id: 'p1', name: 'Our wedding' },
            { id: 'p2', name: 'Birthday' },
          ],
        });
      }
      if (pathname.endsWith('/guests/bulk') && request.method() === 'POST') {
        const body = JSON.parse(request.postData());
        bulk.push(body);
        if (respond) {
          return respond(route, body);
        }
        return json(
          route,
          {
            success: true,
            guests: body.guests.map((guest, index) => ({ id: `new${index}`, ...guest })),
            skipped: [],
          },
          201
        );
      }
      if (pathname.endsWith('/guests') && request.method() === 'GET') {
        return json(route, { guests: pathname.includes('/p1/') ? existing : [] });
      }
      return json(route, {}, 404);
    });
  }

  test('an import is one request, and guests already on the list are left out', async ({
    page,
    context,
    baseURL,
  }) => {
    const bulk = [];
    await mockGuests(page, bulk);
    await open(page, context, baseURL, '/guests.html?plan=p1');
    await page.locator('[data-action="import"]').first().click();
    await page.setInputFiles('#gm-csv', {
      name: 'guests.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Name,Email\nBob New,bob@example.com\nAnn Existing,ANN@example.com\nCy New,cy@example.com\n'
      ),
    });
    await expect(page.locator('#gm-import-status')).toContainText(
      '2 new guests ready to import, 1 guest already on your list'
    );
    await page.locator('dialog [type="submit"]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(bulk).toHaveLength(1);
    expect(bulk[0].guests.map(guest => guest.name)).toEqual(['Bob New', 'Cy New']);
    await expect(page.locator('.gm-name')).toHaveCount(3);
  });

  /** A CSV file with `count` new guests, plus any extra lines. */
  const csvFile = (count, extra = '') => ({
    name: 'guests.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Name,Email\n${Array.from({ length: count }, (_, i) => `Guest ${i},g${i}@example.com`).join('\n')}\n${extra}`
    ),
  });

  test('rows the server refuses are listed by name and the rest are added', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockGuests(page, [], (route, body) =>
      json(
        route,
        {
          success: true,
          guests: [body.guests[0], body.guests[2]].map((guest, i) => ({ id: `new${i}`, ...guest })),
          skipped: [{ index: 1, error: 'Guest name is required' }],
        },
        201
      )
    );
    await open(page, context, baseURL, '/guests.html?plan=p1');
    await page.locator('[data-action="import"]').first().click();
    await page.setInputFiles('#gm-csv', csvFile(3));
    await expect(page.locator('#gm-import-status')).toContainText('3 new guests ready to import');
    await page.locator('dialog [type="submit"]').click();
    await expect(page.locator('#gm-import-status')).toContainText(
      'Imported 2 guests. 1 row could not be added:'
    );
    await expect(page.locator('.gm-import-skipped li')).toHaveText([
      'Guest 1: Guest name is required',
    ]);
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(page.locator('.gm-name')).toHaveCount(3);
  });

  test('a refused import adds nothing and can be tried again', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockGuests(page, [], route =>
      json(route, { error: 'Too many requests. Please wait a few minutes.' }, 429)
    );
    await open(page, context, baseURL, '/guests.html?plan=p1');
    await page.locator('[data-action="import"]').first().click();
    await page.setInputFiles('#gm-csv', csvFile(2));
    await page.locator('dialog [type="submit"]').click();
    await expect(page.locator('#gm-import-status')).toContainText('Too many requests');
    await expect(page.locator('dialog [type="submit"]')).toBeEnabled();
    await expect(page.locator('#gm-csv')).toBeEnabled();
    await expect(page.locator('.gm-name')).toHaveCount(1);
  });

  test('the 500 guest limit counts guests that would be sent, not ones already on the list', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockGuests(page, []);
    await open(page, context, baseURL, '/guests.html?plan=p1');
    await page.locator('[data-action="import"]').first().click();
    await page.setInputFiles('#gm-csv', csvFile(501));
    await expect(page.locator('#gm-import-status')).toContainText('Import up to 500 at a time');
    await expect(page.locator('dialog [type="submit"]')).toBeDisabled();
    await page.setInputFiles('#gm-csv', csvFile(500, 'Ann Existing,ann@example.com\n'));
    await expect(page.locator('#gm-import-status')).toContainText(
      '500 new guests ready to import, 1 guest already on your list'
    );
    await expect(page.locator('dialog [type="submit"]')).toBeEnabled();
  });

  test('switching plan puts it in the address, so a reload stays on that plan', async ({
    page,
    context,
    baseURL,
  }) => {
    await mockGuests(page, []);
    await open(page, context, baseURL, '/guests.html?plan=p1&source=test');
    await expect(page.locator('#gm-plan-select')).toHaveValue('p1');
    await page.selectOption('#gm-plan-select', 'p2');
    await expect.poll(() => new URL(page.url()).searchParams.get('plan')).toBe('p2');
    expect(new URL(page.url()).searchParams.get('source')).toBe('test');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gm-plan-select')).toHaveValue('p2');
  });
});
