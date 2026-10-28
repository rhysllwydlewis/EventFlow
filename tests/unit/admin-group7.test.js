'use strict';

/**
 * Admin audit Group 7 (smaller items): contact-form text stored as typed, signup counts for
 * Analytics, deep links, Locations, retired pages and the small page fixes.
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

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = 'public/assets/js/pages/';

jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: jest.fn() }));
jest.mock('../../services/supplierEnquiryNotifier', () => ({
  notifySupplierOfEnquiry: jest.fn(),
}));
jest.mock('../../utils/appWebSocket', () => ({ getAppWebSocketServer: () => null }));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

describe('Contact form stores what was typed', () => {
  const saved = {};
  let app;

  beforeEach(() => {
    Object.keys(saved).forEach(key => delete saved[key]);
    const contact = require('../../routes/contact');
    contact.initializeDependencies({
      dbUnified: {
        insertOne: jest.fn(async (collection, doc) => {
          saved[collection] = doc;
          return doc;
        }),
        read: jest.fn(async () => [{ id: 'sup_1', name: 'Venue' }]),
      },
      writeLimiter: (req, res, next) => next(),
      verifyAltcha: jest.fn(async () => ({ success: true })),
    });
    app = express();
    app.use(express.json());
    app.use('/api/v1', contact);
  });

  it("keeps an apostrophe and an ampersand as they were typed (no 'Can&#x27;t')", async () => {
    await request(app)
      .post('/api/v1/contact')
      .send({
        name: "Rhys O'Neil & Co",
        email: 'rhys@example.test',
        subject: "Can't make it <soon>",
        message: 'Tom & Jerry say "hi"',
      })
      .expect(200);

    expect(saved.contact_enquiries.senderName).toBe("Rhys O'Neil & Co");
    expect(saved.contact_enquiries.subject).toBe("Can't make it <soon>");
    expect(saved.contact_enquiries.message).toBe('Tom & Jerry say "hi"');
  });

  it('does the same for an enquiry to a supplier', async () => {
    await request(app)
      .post('/api/v1/contact-supplier')
      .send({
        name: "Ann O'Brien",
        email: 'ann@example.test',
        message: "We'd like a quote & a call",
        supplierId: 'sup_1',
      })
      .expect(200);

    expect(saved.enquiries.senderName).toBe("Ann O'Brien");
    expect(saved.enquiries.message).toBe("We'd like a quote & a call");
  });
});

describe('GET /api/admin/metrics counts new accounts, so Analytics does not download every user', () => {
  const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  it('reports sign-ups in the last 7 and 30 days', async () => {
    Object.keys(mockStore).forEach(key => delete mockStore[key]);
    mockStore.users = [
      { id: 'a', role: 'customer', createdAt: daysAgo(1) },
      { id: 'b', role: 'customer', createdAt: daysAgo(6) },
      { id: 'c', role: 'supplier', createdAt: daysAgo(20) },
      { id: 'd', role: 'customer', createdAt: daysAgo(90) },
      { id: 'e', role: 'customer' },
      { id: 'f', role: 'customer', createdAt: 'not a date' },
    ];
    const server = express();
    server.use(express.json());
    server.use('/api/admin', require('../../routes/admin'));
    const res = await request(server).get('/api/admin/metrics').expect(200);
    expect(res.body.counts.usersTotal).toBe(6);
    expect(res.body.counts.signupsLast7Days).toBe(2);
    expect(res.body.counts.signupsLast30Days).toBe(3);
  });

  it('the Analytics page uses those counts and no longer fetches /api/admin/users', () => {
    const page = read(`${PAGES}admin-analytics-init.js`);
    expect(page).toContain('counts.signupsLast7Days');
    expect(page).toContain('counts.signupsLast30Days');
    expect(page).not.toContain("'/api/admin/users'");
  });

  it('"Open PostHog" is really hidden when PostHog is not set up', () => {
    const css = read('public/assets/css/admin-behaviour-analytics.css');
    expect(css).toMatch(/\.behaviour-posthog-link\[hidden\] \{\s*display: none !important;/);
  });
});

describe('links from other pages land on the right thing', () => {
  it('Packages reads ?supplierId, ?add and ?id once both lists are loaded', () => {
    const page = read(`${PAGES}admin-packages-init.js`);
    expect(page).toContain("params.get('supplierId')");
    expect(page).toContain("params.get('add') === '1'");
    expect(page).toContain("params.get('id')");
    expect(page).toMatch(
      /Promise\.all\(\[loadPackages\(\), loadSuppliers\(\)\]\)\.then\(applyDeepLink\)/
    );
    expect(page).toContain('pkg.supplierId === supplierFilterId');
    expect(read('public/admin-packages.html')).toContain('id="supplierFilterNote"');
  });

  it("the supplier page's Add New Package asks for the Add form, and its photo button says what it does", () => {
    const page = read(`${PAGES}admin-supplier-detail-init.js`);
    expect(page).toContain('&add=1');
    expect(read('public/admin-supplier-detail.html')).toContain(
      'id="uploadPhotoBtn">Review photos<'
    );
  });

  it('Photos shows only the linked supplier', () => {
    const page = read(`${PAGES}admin-photos-init.js`);
    expect(page).toContain("new URLSearchParams(window.location.search).get('supplierId')");
    expect(page).toMatch(/selectedSupplier = suppliers\.find\(s => s\.id === linkedSupplierId\)/);
  });

  it('Tickets opens ?ticket=ID once, and #contacts opens the Contact form tab', () => {
    const page = read(`${PAGES}admin-tickets-init.js`);
    expect(page).toContain("get('ticket')");
    expect(page).toContain('openLinkedTicket();');
    expect(page).toContain("window.location.hash === '#contacts'");
    // the tab's loader is defined later in the file, so the hash is handled on DOMContentLoaded
    expect(page).toMatch(
      /addEventListener\('DOMContentLoaded', \(\) => \{\s*if \(window\.location\.hash === '#contacts'\)/
    );
  });

  it('Cashout requests opens ?request=ID once', () => {
    const page = read(`${PAGES}admin-cashout-requests-init.js`);
    expect(page).toContain("get('request')");
    expect(page).toContain('openLinkedRequest(items);');
  });

  it('Cashout requests fetches a linked request that is older than the newest 100', () => {
    const page = read(`${PAGES}admin-cashout-requests-init.js`);
    expect(page).toContain('/api/v1/admin/cashout-requests/${encodeURIComponent(id)}');
    expect(page).toContain('openModal(id, [payload.request, ...items]);');
    expect(page).toContain('res.status === 404');
  });

  it('the Email Centre opens ?logId=ID', () => {
    const page = read(`${PAGES}admin-emails-init.js`);
    expect(page).toContain("get('logId')");
    expect(page).toContain('openDetail(linkedLogId)');
  });

  it('the Media/Content overview no longer links to a tab that does not exist', () => {
    const overview = read(`${PAGES}admin-management-overhaul.js`);
    expect(overview).not.toContain('tab=homepage');
    expect(overview).toContain("href: '/admin-homepage'");
  });

  it('a recommendation that points at the page you are on is not an "Open" link', () => {
    const overview = read(`${PAGES}admin-management-overhaul.js`);
    expect(overview).toContain('function pointsAtThisPage(href)');
    expect(overview).toContain('if (pointsAtThisPage(task.href))');
  });
});

describe('SEO page', () => {
  const html = read('public/admin-seo.html');
  const page = read(`${PAGES}admin-seo-init.js`);

  it('asks before hiding a query and lets one be put back', () => {
    expect(page).toContain("title: 'Hide this query?'");
    expect(page).toContain("'DELETE'");
    expect(page).toContain('data-restore-query');
    expect(html).toContain('id="seo-noiseTable"');
  });

  it('hiding or restoring a query reloads every report built from the queries', () => {
    const reload = page.match(
      /async function reloadNoiseDependentReports\(\) \{[\s\S]*?\n {2}\}/
    )[0];
    for (const loader of [
      'loadFinancialEstimate',
      'loadContentGaps',
      'loadOverview',
      'loadNoise',
    ]) {
      expect(reload).toContain(`${loader}()`);
    }
    expect(page.match(/await reloadNoiseDependentReports\(\);/g)).toHaveLength(2);
  });

  it('checks the value per click before saving and asks before clearing it', () => {
    expect(html).toContain('max="100"');
    expect(page).toContain('valuePerClick > 100');
    expect(page).toContain("title: 'Clear the value per click?'");
  });

  it('has page margins and a skip link that is hidden until focused', () => {
    const css = read('public/assets/css/admin-workspace.css');
    expect(css).toMatch(/main\.admin-main,/);
    expect(css).toMatch(/\.efl-skip \{ position: absolute; left: -9999px;/);
    expect(css).toMatch(/\.efl-skip:focus \{ left: 1rem; top: 1rem; \}/);
  });
});

describe('Debug page', () => {
  it('tabs stay readable on hover and are not full-width on a phone', () => {
    const css = read('public/assets/css/admin-debug-mobile-improvements.css');
    expect(css).toMatch(/\.sc-tabs \.sc-tab-btn:hover,[\s\S]*?background: transparent;/);
    expect(css).toMatch(/\.sc-tab-btn \{[^}]*width: auto;/);
  });
});

describe('Locations page', () => {
  const html = read('public/admin-locations.html');
  const page = read(`${PAGES}admin-locations.js`);

  it('can be searched', () => {
    expect(html).toContain('id="efl-admin-search"');
    expect(page).toContain("searchEl.addEventListener('input', renderList)");
  });

  it('can unpublish and retire a page, and restore a retired one', () => {
    expect(page).toContain("unpublish: { status: 'draft' }");
    expect(page).toContain("retire: { status: 'retired' }");
    expect(page).toContain("restore: { status: 'draft' }");
    expect(page).toContain('data-action="unpublish"');
    expect(page).toContain('data-action="retire"');
    expect(page).toContain('data-action="restore"');
  });

  it('asks before publishing, unpublishing or retiring', () => {
    expect(page).toContain('function confirmationFor(action, name)');
    expect(page).toMatch(/publish: \{\s*message: `Publish \$\{name\}\?/);
    expect(page).toContain('await adminConfirm(question.message, question.label)');
  });
});

describe('retired pages and version tags', () => {
  it('Stock Photos and Content Dates pages and their now-unused files are gone', () => {
    for (const file of [
      'public/admin-pexels.html',
      'public/admin-content-dates.html',
      'public/assets/js/pages/admin-pexels-init.js',
      'public/assets/css/admin-pexels.css',
    ]) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(false);
    }
    // the redirects stay, so old bookmarks still work
    const server = read('server.js');
    expect(server).toContain("['/admin-pexels', '/admin-pexels.html']");
    expect(server).toContain("['/admin-content-dates', '/admin-content-dates.html']");
  });

  it('every script and stylesheet an admin page loads from /assets carries a ?v= tag', () => {
    const missing = [];
    for (const name of fs.readdirSync(path.join(ROOT, 'public'))) {
      if (!/^admin.*\.html$/.test(name)) {
        continue;
      }
      const source = read(`public/${name}`);
      const references =
        source.match(/<(?:script[^>]*\ssrc|link[^>]*\shref)=["']\/assets\/[^"']+["']/g) || [];
      for (const reference of references) {
        const url = reference.match(/["'](\/assets\/[^"']+)["']/)[1];
        if (!url.includes('?v=') && !/\.(?:ico|svg|png|webmanifest)$/.test(url)) {
          missing.push(`${name}: ${url}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('Messenger status choices match what the server can answer', () => {
  it('the dashboard and the Messenger page offer Active, Closed, Archived and Deleted (not Blocked)', () => {
    for (const file of ['public/admin.html', 'public/admin-messenger.html']) {
      const html = read(file);
      for (const value of ['active', 'closed', 'archived', 'deleted']) {
        expect(html).toContain(`<option value="${value}">`);
      }
      expect(html).not.toContain('<option value="blocked">');
    }
  });

  it('the Messenger page shows the label the server worked out', () => {
    expect(read(`${PAGES}admin-messenger-init.js`)).toContain('conv.displayStatus || conv.status');
  });
});

describe('the reply to a contact-form enquiry reads normally', () => {
  it('turns old escaped names and subjects back before they go into the email', () => {
    const admin = read('routes/admin.js');
    expect(admin).toContain("validator.unescape(String(enquiry.senderName || ''))");
    expect(admin).toContain("validator.unescape(String(enquiry.subject || ''))");
  });
});
