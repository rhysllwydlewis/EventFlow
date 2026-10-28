'use strict';

/**
 * Admin shared styling (header buttons, long words, wide-table actions, email banners) and list
 * paging ("Showing 51-100 of 349"): the pager's numbers, the search totals and offset, and the
 * pages wired to use them.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../middleware/audit', () => {
  const actual = jest.requireActual('../../middleware/audit');
  return { ...actual, auditLog: jest.fn().mockResolvedValue({}) };
});
const mockStore = {};
jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => mockStore[name] || []),
  findOne: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
  uid: jest.fn(prefix => `${prefix}_1`),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const AdminPager = require('../../public/assets/js/utils/admin-pager');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = 'public/assets/js/pages/';

describe('AdminPager numbers', () => {
  it('says which rows a page covers', () => {
    expect(AdminPager.range(1, 50, 349)).toEqual({ page: 1, pages: 7, first: 1, last: 50 });
    expect(AdminPager.range(7, 50, 349)).toEqual({ page: 7, pages: 7, first: 301, last: 349 });
    expect(AdminPager.range(3, 50, 0)).toEqual({ page: 1, pages: 1, first: 0, last: 0 });
  });

  it('keeps a page number inside the list (a filter can shrink it)', () => {
    expect(AdminPager.range(99, 50, 120).page).toBe(3);
    expect(AdminPager.range(-4, 50, 120).page).toBe(1);
    expect(AdminPager.range('x', 50, 120).page).toBe(1);
  });

  it('slices one page of rows', () => {
    const rows = Array.from({ length: 120 }, (_, index) => index);
    expect(AdminPager.slice(rows, 1, 50)).toHaveLength(50);
    expect(AdminPager.slice(rows, 3, 50)).toEqual(rows.slice(100));
    expect(AdminPager.slice([], 1, 50)).toEqual([]);
  });

  it('words the line the same way on every page', () => {
    expect(AdminPager.label(2, 50, 349, 'tickets')).toBe('Showing 51–100 of 349 tickets');
    expect(AdminPager.label(1, 50, 12, 'tickets')).toBe('Showing all 12 tickets');
    expect(AdminPager.label(1, 50, 0, 'tickets')).toBe('No tickets');
  });
});

describe('AdminPager in the page', () => {
  /** Just enough DOM to run mount() without a browser. */
  function fakeElement(tag) {
    const listeners = {};
    return {
      tag,
      hidden: false,
      disabled: false,
      textContent: '',
      children: [],
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
      insertAdjacentElement(position, node) {
        this.inserted = { position, node };
      },
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
      click() {
        listeners.click();
      },
    };
  }

  beforeEach(() => {
    global.document = { createElement: fakeElement };
  });
  afterEach(() => {
    delete global.document;
  });

  it('shows the line and moves between pages', () => {
    const wrapper = fakeElement('div');
    const changes = [];
    const pager = AdminPager.mount({ after: wrapper, onChange: page => changes.push(page) });
    const [text, previous, next] = wrapper.inserted.node.children;
    expect(wrapper.inserted.position).toBe('afterend');

    pager.update({ page: 1, size: 50, total: 349, noun: 'tickets' });
    expect(text.textContent).toBe('Showing 1–50 of 349 tickets');
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    next.click();

    pager.update({ page: 7, size: 50, total: 349, noun: 'tickets' });
    expect(next.disabled).toBe(true);
    previous.click();
    expect(changes).toEqual([2, 6]);
  });

  it('hides the buttons when everything fits on one page', () => {
    const wrapper = fakeElement('div');
    const pager = AdminPager.mount({ after: wrapper, onChange: () => {} });
    const [text, previous, next] = wrapper.inserted.node.children;
    pager.update({ page: 1, size: 50, total: 12, noun: 'packages' });
    expect(text.textContent).toBe('Showing all 12 packages');
    expect(previous.hidden).toBe(true);
    expect(next.hidden).toBe(true);
  });
});

describe('GET /api/admin/search', () => {
  const app = () => {
    const server = express();
    server.use(express.json());
    server.use('/api/admin', require('../../routes/admin'));
    return server;
  };

  beforeEach(() => {
    Object.keys(mockStore).forEach(key => delete mockStore[key]);
    mockStore.users = Array.from({ length: 37 }, (_, index) => ({
      id: `u${index}`,
      name: `Person ${index}`,
      email: `person${index}@example.test`,
      role: 'customer',
    }));
    mockStore.tickets = [{ id: 't1', subject: 'Hello person', status: 'open' }];
  });

  it('returns the first 10 of each category and how many matched in all', async () => {
    const res = await request(app()).get('/api/admin/search?q=person').expect(200);
    expect(res.body.results.users).toHaveLength(10);
    expect(res.body.totals).toMatchObject({ users: 37, tickets: 1 });
  });

  it('gives the next ten for "Show more" with an offset', async () => {
    const res = await request(app())
      .get('/api/admin/search?q=person&types=users&limit=10&offset=30')
      .expect(200);
    expect(res.body.results.users.map(user => user.id)).toEqual([
      'u30',
      'u31',
      'u32',
      'u33',
      'u34',
      'u35',
      'u36',
    ]);
    expect(res.body.totals.users).toBe(37);
  });

  it('never returns more than 100 a category, the cap the API enforces', async () => {
    const res = await request(app()).get('/api/admin/search?q=person&limit=5000').expect(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.results.users).toHaveLength(37);
  });

  it('still refuses a query that is too short', async () => {
    await request(app()).get('/api/admin/search?q=a').expect(400);
  });
});

describe('External contacts request size', () => {
  it('is capped at 100, the limit the API accepts', () => {
    const route = read('routes/admin-external-contacts.js');
    expect(route).toMatch(/Math\.min\(Number\(rawLimit\) \|\| 50, 100\)/);
  });

  it('the page asks for 100 at a time until it has them all', () => {
    const page = read(`${PAGES}admin-external-contacts-init.js`);
    expect(page).toContain('const REQUEST_SIZE = 100;');
    expect(page).toMatch(/limit=\$\{REQUEST_SIZE\}&skip=\$\{everything\.length\}/);
    expect(page).toContain('const CONTACT_PAGE_SIZE = 50;');
  });

  it('changing a filter goes back to page one, a reload or page change keeps the page', () => {
    const page = read(`${PAGES}admin-external-contacts-init.js`);
    expect(page).toMatch(/options && options\.keepPage === true/);
    expect(page).toMatch(/applyFilters\(\{ keepPage: true \}\)/);
    // the filter listeners pass the event object, which must not count as "keep the page"
    expect(page).toMatch(/addEventListener\('change', applyFilters\)/);
  });
});

describe('pages that page their lists', () => {
  it.each([
    ['admin-tickets.html', 'admin-tickets-init.js'],
    ['admin-packages.html', 'admin-packages-init.js'],
    ['admin-emails.html', 'admin-emails-init.js'],
    ['admin-external-contacts.html', 'admin-external-contacts-init.js'],
  ])('%s loads the pager before %s, with a bumped version', (html, script) => {
    const source = read(`public/${html}`);
    const pager = source.indexOf('/assets/js/utils/admin-pager.js?v=18.5.13');
    expect(pager).toBeGreaterThan(-1);
    expect(pager).toBeLessThan(source.indexOf(script));
    expect(source).toContain(`${script}?v=18.5.13`);
  });

  it('Tickets and Packages draw 50 a page and go back to page one on a new filter', () => {
    const tickets = read(`${PAGES}admin-tickets-init.js`);
    expect(tickets).toContain('const TICKET_PAGE_SIZE = 50;');
    expect(tickets).toMatch(/ticketPage = 1;\s*renderTickets\(\);/);
    const packages = read(`${PAGES}admin-packages-init.js`);
    expect(packages).toContain('const PACKAGE_PAGE_SIZE = 50;');
    expect(packages.match(/applyFiltersAndRender\(\{ resetPage: true \}\)/g)).toHaveLength(2);
  });

  it('Emails asks for the page the pager is on, 25 a time', () => {
    const emails = read(`${PAGES}admin-emails-init.js`);
    expect(emails).toContain('const EMAIL_PAGE_SIZE = 25;');
    expect(emails).toMatch(/page: String\(currentPage\),\s*limit: String\(EMAIL_PAGE_SIZE\)/);
  });

  it('Community Audit and Appeals ask for 50 a page and offer Previous / Next', () => {
    const admin = read('public/assets/js/community/admin.js');
    expect(admin).toContain('const LIST_PAGE_SIZE = 50;');
    expect(admin).toMatch(/appeals\?page=\$\{listPage\.appeals\}&limit=\$\{LIST_PAGE_SIZE\}/);
    expect(admin).toMatch(/audit\?page=\$\{listPage\.audit\}&limit=\$\{LIST_PAGE_SIZE\}/);
    // the generated page carries the new script version
    expect(read('public/admin-community.html')).toContain('community/admin.js?v=18.6.2');
    expect(read('scripts/generate-community-pages.mjs')).toContain(
      "'/assets/js/community/admin.js': '18.6.2'"
    );
  });

  it('Search throws away a "Show more" answer from an earlier search or category choice', () => {
    const search = read(`${PAGES}admin-search-init.js`);
    // the token is captured before asking and checked before drawing, like a new search does
    expect(search).toMatch(/const token = searchToken;/);
    expect(search).toMatch(/if \(token !== searchToken\) \{\s*return;\s*\}\s*const results = \{/);
    // a category already loading ignores a second click, and keeps its button disabled on redraw
    expect(search).toMatch(/if \(loadingMore\.has\(type\)\) \{\s*return;\s*\}/);
    expect(search).toContain("const busy = loadingMore.has(type) ? ' disabled' : '';");
    expect(search.match(/loadingMore\.clear\(\)/g)).toHaveLength(2);
  });

  it('External contacts updates the loaded list after a status save instead of reloading it all', () => {
    const page = read(`${PAGES}admin-external-contacts-init.js`);
    expect(page).toMatch(/applyStatusChange\(id, newStatus\);/);
    // the save handler no longer calls loadData(): that was one request per 100 enquiries each time
    const handler = page.slice(page.indexOf("$('ecSaveStatusBtn').addEventListener"));
    expect(handler.slice(0, handler.indexOf('} catch (err)'))).not.toContain('loadData()');
    expect(page).toContain('function summaryFrom(contacts)');
  });

  it('Search says "10 of 37" and has a Show more button that offsets by what is shown', () => {
    const search = read(`${PAGES}admin-search-init.js`);
    expect(search).toMatch(/total > shown \? `\$\{shown\} of \$\{total\}`/);
    expect(search).toContain('data-more="${type}"');
    expect(search).toMatch(/const offset = \(currentResults\[type\] \|\| \[\]\)\.length;/);
    expect(search).toMatch(/offset=\$\{offset\}/);
    expect(read('public/admin-search.html')).toContain('admin-search-init.js?v=18.5.13');
  });
});

describe('shared admin styling', () => {
  const workspace = read('public/assets/css/admin-workspace.css');

  it('header icon buttons, back buttons and back links are coloured for a white card', () => {
    expect(workspace).toMatch(/\.btn-icon,[\s\S]*?\.link-white \{ color: #0b8073 !important; \}/);
    expect(workspace).toMatch(/\.btn-icon,[\s\S]*?\.btn-secondary \{ background: #fff;/);
  });

  it('the two email heroes keep their gradient and white controls', () => {
    expect(workspace).toMatch(/:is\(\.email-centre-hero, \.email-preview-hero\) \.btn-icon/);
    expect(read('public/assets/css/admin-emails.css')).toMatch(
      /\.email-centre-hero \.dashboard-title \{ color: #fff; \}/
    );
    expect(read('public/assets/css/email-previews.css')).toMatch(
      /\.email-preview-hero \.dashboard-title \{ color: #fff; \}/
    );
  });

  it('long words break in text, but table cells are left alone', () => {
    expect(workspace).toMatch(
      /main :is\(p, li, dd, h1, h2, h3, h4, strong, \.small\) \{ overflow-wrap: anywhere; \}/
    );
    expect(workspace).not.toMatch(/main :is\(td/);
  });

  it('Users and Suppliers keep the Actions column in view', () => {
    expect(workspace).toContain('.table-wrapper--sticky-actions table :is(th, td):last-child');
    expect(read('public/admin-users.html')).toContain('table-wrapper--sticky-actions');
    expect(read('public/admin-suppliers.html')).toContain('table-wrapper--sticky-actions');
  });

  it('Suppliers keeps the subscription controls behind a "Subscription" summary', () => {
    const suppliers = read(`${PAGES}admin-suppliers-init.js`);
    expect(suppliers).toContain('<details class="row-more">');
    expect(suppliers).toContain('<summary>Subscription</summary>');
    expect(workspace).toContain('details.row-more > summary');
  });

  it('Success, warning and info buttons have text that can be read', () => {
    expect(workspace).toMatch(/\.btn-success \{ background: #047857;/);
    expect(workspace).toMatch(/\.btn-warning \{ background: #b45309;/);
    expect(workspace).toMatch(/\.btn-info \{ background: #2563eb;/);
  });

  it('every page that loads the workspace stylesheet loads the new version', () => {
    const pages = fs
      .readdirSync(path.join(ROOT, 'public'))
      .filter(name => name.endsWith('.html'))
      .filter(name => read(`public/${name}`).includes('admin-workspace.css'));
    expect(pages.length).toBeGreaterThan(30);
    for (const name of pages) {
      expect(read(`public/${name}`)).toContain('admin-workspace.css?v=2');
      expect(read(`public/${name}`)).not.toContain('admin-workspace.css?v=1');
    }
  });

  it('Media no longer paints its Back button white-on-white inline', () => {
    expect(read('public/admin-media.html')).not.toMatch(/id="backToDashboard"[^>]*color:white/);
  });

  it('Partners row buttons and badges, and the Payments captions, use readable text', () => {
    const partners = read('public/admin-partners.html');
    expect(partners).toContain('.ap-action-btn--view { color: #4338ca; }');
    expect(partners).toContain('.p-badge--success { color: #047857; }');
    expect(read('public/admin-payments.html')).toContain('.payments-stats-grid .stat-card h3');
  });
});
