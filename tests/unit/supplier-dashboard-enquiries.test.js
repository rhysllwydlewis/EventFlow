'use strict';

/**
 * Enquiries on the supplier dashboard: the card, the drawer with list, filters and detail, the
 * status buttons, every empty / error / unapproved state, customer text kept as text, and the CSV
 * export with its empty-state message. The scripts run in jsdom against a scripted API.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const enquiriesSource = read('public/assets/js/pages/supplier-dashboard-enquiries.js');
const exportSource = read('public/assets/js/dashboard-supplier-export.js');
const homeSource = read('public/assets/js/pages/supplier-dashboard-home.js');
const css = read('public/assets/css/supplier-dashboard-home.css');

const runner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');
/** Runs the enquiries scenario with the given options. */
const run = options =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, 'enquiries', Buffer.from(JSON.stringify(options || {}), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

describe('enquiries: page structure', () => {
  test('a card and a drawer dialog exist, with filters, a list, a detail pane and a live region', () => {
    expect(html).toMatch(/<section id="sdh-enquiries"[^>]*data-needs-profile/);
    expect(html).toMatch(
      /<dialog id="sdh-enquiries-dialog"[^>]*aria-labelledby="sdh-enquiries-title"/
    );
    [
      'sdh-enquiries-status',
      'sdh-enquiries-source',
      'sdh-enquiries-list',
      'sdh-enquiries-detail',
      'sdh-enquiries-more',
      'sdh-enquiries-back',
      'sdh-enquiries-live',
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(html).toMatch(/supplier-dashboard-enquiries\.js\?v=\d/);
  });

  test('the drawer is a side panel on desktop and a bottom sheet on a phone, one pane at a time there', () => {
    expect(css).toMatch(/\.sdh-dialog--drawer \{[^}]*margin: 0 0 0 auto/);
    expect(css).toMatch(
      /@media \(max-width: 899px\) \{\s*\.sdh-page \.sdh-dialog--drawer \{[^}]*height: 94dvh/
    );
    expect(css).toContain('.sdh-drawer--detail .sdh-drawer__listpane');
  });

  test('customer text is only ever put on the page as text, never as markup', () => {
    expect(enquiriesSource).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(enquiriesSource).toContain('textContent');
  });

  test('the summary carries an Enquiries figure with a trend, and a button that opens the drawer', () => {
    expect(homeSource).toContain('data-sdh-action="open-enquiries"');
    expect(homeSource).toContain("new CustomEvent('sdh:open-enquiries')");
    expect(enquiriesSource).toContain("document.addEventListener('sdh:open-enquiries'");
  });

  test('the page says what happens: you are notified, and can reply by email from the drawer', () => {
    expect(enquiriesSource).toContain('You are notified when an enquiry arrives');
    expect(enquiriesSource).toContain('Open one to reply to the customer by email.');
    expect(enquiriesSource).toContain('/reply`');
    expect(enquiriesSource).not.toContain('not emailed');
  });
});

describe('enquiries: the card and the drawer', () => {
  const log = run({});

  test('the card asks for the latest three, shows the counts and the latest rows, and has the honest note', () => {
    expect(log.requestsAfterRender).toEqual(['GET /api/supplier/enquiries?days=90&page=1&limit=3']);
    expect(log.card).toContain(
      '1 new of 2 in the last 90 days (1 quote request, 1 contact message).'
    );
    expect(log.cardRows).toBe(2);
    expect(log.openHidden).toBe(false);
    expect(log.card).toContain('reply to the customer by email');
  });

  test('the drawer lists the enquiries and the counts', () => {
    expect(log.drawerOpen).toBe(true);
    expect(log.listRows).toBe(2);
    expect(log.list).toContain('Carol');
    expect(log.list).toContain('Contact form');
    expect(log.counts).toContain('1 new of 2');
    expect(log.moreHidden).toBe(true);
  });

  test('hostile customer text stays text in the card, the list and the detail', () => {
    expect(log.noInjectedNodes).toBe(0);
    expect(log.listInjected).toBe(0);
    expect(log.detailInjected).toBe(0);
    expect(log.pwned).toBe(0);
    expect(log.messageText).toContain('<img src=x onerror="window.__pwned=1">');
    // Line breaks in the message are kept (pre-wrap), not turned into markup.
    expect(log.messageText).toContain('\nsecond line');
  });

  test("the detail shows the customer's contact details with working mail and phone links, and one reply form", () => {
    expect(log.detail).toContain('Email');
    expect(log.mailto).toBe('mailto:alice@example.com');
    expect(log.tel).toBe('tel:07123456789');
    expect(log.detail).toContain('Event date12 June 2027');
    expect(log.detail).toContain('Budget2000');
    expect(log.replyForms).toBe(1);
    expect(log.replyTextareas).toBe(1);
    expect(log.otherInputs).toBe(0);
    expect(log.replyLabel).toMatch(/^Reply to /);
  });

  test('the status buttons offer the other states and send a PATCH with the new one', () => {
    expect(log.statusButtons).toEqual(['Mark as read', 'Mark as handled']);
    expect(log.afterPatch).toEqual(['PATCH /api/supplier/enquiries/qr_1 {"status":"handled"}']);
    expect(log.statusAfter).toContain('Status: Handled');
  });

  test('changing a status keeps the filtered list and puts focus on the detail heading, not the page', () => {
    expect(log.rowsAfterStatusWithFilter).toBe(1);
    expect(log.focusAfterStatus).toBe('sdh-enquiry-title');
  });

  test('the card and the drawer keep separate rows, and only the newest list request may draw', () => {
    expect(enquiriesSource).toContain('cardItems');
    expect(enquiriesSource).toContain('view.listTicket');
    expect(enquiriesSource).toContain('if (ticket !== view.listTicket)');
  });

  test('a filter goes to the server and the list follows it', () => {
    expect(log.filteredRequest).toBeGreaterThanOrEqual(1);
    expect(log.filteredRows).toBe(1);
  });
});

describe('enquiries: states', () => {
  test('an unapproved supplier is told so and nothing is requested', () => {
    const log = run({ approved: false, openDrawer: false });
    expect(log.requestsAfterRender).toEqual([]);
    expect(log.card).toContain('Enquiries open once your profile has been approved.');
    expect(log.openHidden).toBe(true);
  });

  test('a 403 SUPPLIER_NOT_APPROVED from the server gives the same message', () => {
    const log = run({
      openDrawer: false,
      script: { listStatus: 403, listData: { code: 'SUPPLIER_NOT_APPROVED' } },
    });
    expect(log.card).toContain('Enquiries open once your profile has been approved.');
  });

  test('a failed request shows an error with Try again, never an empty list', () => {
    const log = run({ openDrawer: false, script: { listStatus: 500 } });
    expect(log.card).toContain('Your enquiries could not be loaded');
    expect(log.card).toContain('Try again');
    expect(log.card).not.toContain('No quote requests');
  });

  test('when the drawer cannot load it says so with Try again', () => {
    const log = run({ script: { listStatus: 500 } });
    expect(log.list).toContain('Your enquiries could not be loaded');
    expect(log.list).toContain('Try again');
  });

  test('an enquiry that cannot be opened says why and offers no status buttons', () => {
    const missing = run({ script: { detailStatus: 404 } });
    expect(missing.detail).toContain('This enquiry could not be opened');
    expect(missing.messageText).toBe('It is no longer available.');
    expect(missing.statusButtons).toEqual([]);
    expect(missing.statusAfter).toBe('');
    expect(missing.afterPatch).toEqual([]);

    const offline = run({ script: { detailStatus: 500 } });
    expect(offline.messageText).toBe('Check your connection and try again.');
    expect(offline.statusButtons).toEqual([]);
  });

  test('a dropped connection during a status change is reported and the buttons come back', () => {
    const log = run({ script: { patchThrows: true } });
    expect(log.toasts).toEqual(['toast:error:The status could not be changed. Please try again.']);
    expect(log.buttonsDisabledAfter).toBe(0);
    expect(log.statusAfter).toContain('Status: New');
  });

  test('a status change that fails is reported and leaves the buttons usable', () => {
    const log = run({ script: { patchFails: true } });
    expect(log.toasts).toEqual(['toast:error:Could not update']);
    expect(log.statusAfter).toContain('Status: New');
  });
});

describe('CSV export', () => {
  /** Runs exportAll with a scripted fetch and returns what it said and saved. */
  async function exportWith(response) {
    const said = [];
    const saved = [];
    const button = {
      disabled: false,
      querySelector: () => ({ textContent: '' }),
      addEventListener() {},
    };
    const window = {
      SupplierDashboardHome: { toast: (message, tone) => said.push(`${tone}:${message}`) },
    };
    const document = {
      readyState: 'complete',
      getElementById: () => null,
      createElement: () => ({
        setAttribute: (name, value) => saved.push(`${name}=${value}`),
        click() {},
        hidden: false,
      }),
      body: { appendChild() {}, removeChild() {} },
      addEventListener() {},
    };
    vm.runInNewContext(exportSource, {
      window,
      document,
      console,
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      fetch: async () => response,
    });
    await window.SupplierDashboardExport.exportAll(button);
    return { said, saved };
  }

  const headers = values => ({ get: name => values[name.toLowerCase()] || null });

  test('the button says what is exported', () => {
    expect(html).toContain('Export conversations and enquiries (CSV)');
    expect(html).not.toContain('Export latest 100 conversations');
    expect(exportSource).toContain('/api/supplier/enquiries/export');
  });

  test('an empty export is a message, not an empty file, and it reads the header rather than the body', async () => {
    const { said, saved } = await exportWith({
      ok: true,
      status: 200,
      headers: headers({ 'x-export-row-count': '0' }),
      blob: async () => ({}),
    });
    expect(said).toEqual([
      'info:Nothing to export yet: you have no conversations, quote requests or enquiries.',
    ]);
    expect(saved).toEqual([]);
  });

  test('a missing row-count header is unknown, not zero: the file is still saved', async () => {
    const { said, saved } = await exportWith({
      ok: true,
      status: 200,
      headers: headers({}),
      blob: async () => ({}),
    });
    expect(said).toEqual(['success:Export ready.']);
    expect(saved).toContain('download=enquiries-and-conversations.csv');
  });

  test('a file with rows is saved under the name the server gave, and the row count is reported', async () => {
    const { said, saved } = await exportWith({
      ok: true,
      status: 200,
      headers: headers({
        'x-export-row-count': '3',
        'content-disposition': 'attachment; filename="enquiries-and-conversations-2026-07-16.csv"',
      }),
      blob: async () => ({}),
    });
    expect(saved).toContain('download=enquiries-and-conversations-2026-07-16.csv');
    expect(said).toEqual(['success:Exported 3 rows.']);
  });

  test('a truncated export is saved and the supplier is told it is not the whole history', async () => {
    const { said, saved } = await exportWith({
      ok: true,
      status: 200,
      headers: headers({
        'x-export-row-count': '2002',
        'x-export-truncated': 'true',
        'content-disposition': 'attachment; filename="enquiries-and-conversations-2026-07-16.csv"',
      }),
      blob: async () => ({}),
    });
    expect(saved).toContain('download=enquiries-and-conversations-2026-07-16.csv');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^info:Exported the newest 2002 rows\. .*older .* not in the file/);
  });

  test('an export the server did not cut short still reports success', async () => {
    const { said } = await exportWith({
      ok: true,
      status: 200,
      headers: headers({ 'x-export-row-count': '2', 'x-export-truncated': 'false' }),
      blob: async () => ({}),
    });
    expect(said).toEqual(['success:Exported 2 rows.']);
  });

  test('an unapproved supplier is told why, and any other failure says it failed', async () => {
    const unapproved = await exportWith({
      ok: false,
      status: 403,
      headers: headers({}),
      json: async () => ({ code: 'SUPPLIER_NOT_APPROVED' }),
    });
    expect(unapproved.said).toEqual(['error:You can export once your profile has been approved.']);
    const failed = await exportWith({
      ok: false,
      status: 500,
      headers: headers({}),
      json: async () => ({}),
    });
    expect(failed.said).toEqual([
      'error:Could not export your conversations and enquiries. Please try again.',
    ]);
  });
});

describe('reply sent but not marked handled', () => {
  test('the page shows the server warning instead of claiming the enquiry was marked handled', () => {
    expect(enquiriesSource).toContain('result.data.warning');
    const start = enquiriesSource.indexOf('if (result.data.warning)');
    const block = enquiriesSource.slice(start, start + 520);
    // The server's warning already begins "Your reply was sent", so it is shown as it is, once.
    expect(block).toContain("api.toast(result.data.warning, 'info')");
    expect(block).not.toContain('Reply sent. ${result.data.warning}');
    // The "marked as handled" announcement is only in the branch with no warning.
    expect(block.indexOf('The enquiry is marked as handled')).toBeGreaterThan(
      block.indexOf('} else {')
    );
  });
});
