'use strict';

/**
 * Admin pages whose main job did nothing: popups built without the class that shows them, buttons
 * using inline handlers the Content-Security-Policy blocks, a confirm dialog read as an object, a
 * list that stopped at 20 rows, and a Reject that put the listing back in the pending queue.
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
jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue({}),
  auditMiddleware: () => (req, res, next) => next(),
  AUDIT_ACTIONS: { DATA_EXPORT: 'data_export' },
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
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
const dbUnified = require('../../db-unified');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = 'public/assets/js/pages/';

describe('popups are given the class that shows them (components.css hides .modal-overlay)', () => {
  it.each(['admin-reports-init.js', 'admin-content-init.js'])(
    '%s never builds a bare modal-overlay',
    file => {
      const source = read(`${PAGES}${file}`);
      expect(source).toMatch(/className = 'modal-overlay active'/);
      expect(source).not.toMatch(/className = 'modal-overlay'/);
    }
  );

  it('the Users subscription dialog adds and removes active along with display', () => {
    const source = read(`${PAGES}admin-users-init.js`);
    expect(source).toMatch(
      /modal\.style\.display = 'flex';\s*[^\n]*\n\s*modal\.classList\.add\('active'\)/
    );
    expect(source).toMatch(
      /modal\.classList\.remove\('active'\);\s*modal\.style\.display = 'none'/
    );
  });

  it('the stray Close button beside the subscription dialog is gone', () => {
    expect(read('public/admin-users.html')).not.toContain('closeSubPanel');
    expect(read(`${PAGES}admin-users-init.js`)).not.toContain('closeSubPanel');
  });
});

describe('no inline event handlers on the pages the policy blocked', () => {
  it.each(['admin-photos-init.js', 'admin-marketplace-init.js', 'admin-partners-init.js'])(
    '%s has no onclick/onchange attributes',
    file => {
      const code = read(`${PAGES}${file}`)
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      expect(code).not.toMatch(/\son(click|change|input|submit)\s*=/);
    }
  );

  it('Photos handles its card buttons with one delegated listener', () => {
    const source = read(`${PAGES}admin-photos-init.js`);
    expect(source).toContain('data-photo-action="approve"');
    expect(source).toContain('data-photo-action="reject"');
    expect(source).toMatch(/queueEl\.addEventListener\('click'/);
  });

  it('Marketplace maps every card action and the tick box to a delegated listener', () => {
    const source = read(`${PAGES}admin-marketplace-init.js`);
    for (const action of ['edit', 'approve', 'reject', 'sold', 'delete']) {
      expect(source).toContain(`data-listing-action="${action}"`);
    }
    expect(source).toContain('data-listing-select=');
    expect(source).toMatch(/listingsContainer\.addEventListener\('click'/);
    expect(source).toMatch(/listingsContainer\.addEventListener\('change'/);
  });

  it('Partners closes the slide-in panel before opening the credit modal', () => {
    const source = read(`${PAGES}admin-partners-init.js`);
    expect(source).toMatch(
      /case 'adjust-credits':[\s\S]*?closeDetailPanel\(\);\s*openCreditModal\(partnerId\);/
    );
    expect(source).not.toContain('openCreditModalFromPanel');
  });
});

describe('the dialogs that were hidden are keyboard and screen-reader accessible', () => {
  it.each([
    ['admin-reports.html', 'admin-reports-init.js', 1],
    ['admin-content.html', 'admin-content-init.js', 4],
  ])('%s loads modal-a11y.js before %s and enhances %i dialog(s)', (page, script, count) => {
    const html = read(`public/${page}`);
    const helper = html.indexOf('/assets/js/utils/modal-a11y.js');
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(html.indexOf(script));
    const source = read(`${PAGES}${script}`);
    expect(
      source.match(/EFModalA11y\?\.enhance\(modal, \{ labelledBy: '(\w+)' \}\)/g)
    ).toHaveLength(count);
    // every labelledBy id exists as a heading id
    for (const [, id] of source.matchAll(/labelledBy: '(\w+)'/g)) {
      expect(source).toContain(`<h3 id="${id}">`);
    }
  });

  it('the Reviewing status has a badge style', () => {
    expect(read('public/admin-reports.html')).toMatch(/\.badge-reviewing\s*\{/);
  });
});

describe('Photos confirm dialog', () => {
  it('reads the plain true/false AdminShared.showConfirmModal resolves', () => {
    const shared = read('public/assets/js/admin-shared.js');
    expect(shared).toMatch(/resolve\(true\)/);
    expect(shared).toMatch(/resolve\(false\)/);
    const source = read(`${PAGES}admin-photos-init.js`);
    expect(source).not.toContain('result.confirmed');
    expect(source).toMatch(/return confirmed === true;/);
  });
});

describe('Reports list', () => {
  const source = read(`${PAGES}admin-reports-init.js`);

  it('asks for 100 per page and keeps fetching until every page is loaded', () => {
    expect(source).toMatch(/const PAGE_SIZE = 100;/);
    expect(source).toMatch(/perPage=\$\{PAGE_SIZE\}&page=\$\{page\}/);
    expect(source).toMatch(/page <= totalPages && page <= MAX_PAGES/);
  });

  it('offers the Reviewing status and Resolve/Dismiss on every unfinished report', () => {
    expect(read('public/admin-reports.html')).toContain(
      '<option value="reviewing">Reviewing</option>'
    );
    expect(source).toMatch(/report\.status !== 'resolved' && report\.status !== 'dismissed'/);
  });

  it('says how many reports are shown out of how many exist', () => {
    expect(source).toMatch(/Showing \$\{filtered\.length\} of/);
  });
});

describe('Marketplace reject route', () => {
  const adminRouter = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.read.mockResolvedValue([{ id: 'lst1', title: 'Dress', status: 'pending' }]);
  });

  it('moves a rejected listing to removed so it leaves the pending queue', async () => {
    const res = await request(app)
      .post('/api/admin/marketplace/listings/lst1/approve')
      .send({ approved: false });
    expect(res.status).toBe(200);
    expect(res.body.listing).toMatchObject({ approved: false, status: 'removed' });
    expect(dbUnified.updateOne.mock.calls[0][2].$set).toMatchObject({
      approved: false,
      status: 'removed',
    });
  });

  it('still makes an approved listing active', async () => {
    const res = await request(app)
      .post('/api/admin/marketplace/listings/lst1/approve')
      .send({ approved: true });
    expect(res.body.listing).toMatchObject({ approved: true, status: 'active' });
  });
});

describe('the shared keyboard-shortcuts help dialog is shown', () => {
  it('admin-shared.js builds the help overlay with the active class', () => {
    const source = read('public/assets/js/admin-shared.js');
    expect(source).toMatch(/helpModal\.className = 'modal-overlay active';/);
    expect(source).not.toMatch(/helpModal\.className = 'modal-overlay';/);
  });

  it('every page that loads admin-shared.js (and the community generator) uses one, current version', () => {
    const pages = fs
      .readdirSync(path.join(ROOT, 'public'))
      .filter(name => name.endsWith('.html'))
      .filter(name => read(`public/${name}`).includes('/assets/js/admin-shared.js'));
    expect(pages.length).toBeGreaterThan(30);

    const versionIn = text => (text.match(/\/assets\/js\/admin-shared\.js\?v=([\d.]+)/) || [])[1];
    const versions = new Set(pages.map(name => versionIn(read(`public/${name}`))));
    // One version everywhere (a page left on an older one keeps serving a week-old cached copy)
    expect([...versions]).toHaveLength(1);
    const [current] = [...versions];
    expect(current).toBeDefined();
    // ...at least the one that fixed the help dialog, and the generator agrees
    const asNumber = version =>
      version.split('.').reduce((total, part) => total * 1000 + Number(part), 0);
    expect(asNumber(current)).toBeGreaterThanOrEqual(asNumber('18.5.9'));
    expect(read('scripts/generate-community-pages.mjs')).toContain(`admin-shared.js?v=${current}`);
  });
});

describe('script versions are bumped on every page that loads a changed script', () => {
  it.each([
    ['admin-reports.html', 'admin-reports-init.js', '18.5.9'],
    ['admin-content.html', 'admin-content-init.js', '18.5.9'],
    ['admin-photos.html', 'admin-photos-init.js', '18.5.9'],
    ['admin-marketplace.html', 'admin-marketplace-init.js', '18.5.9'],
    ['admin-partners.html', 'admin-partners-init.js', '18.5.12'],
  ])('%s loads %s as v=%s or later', (page, script, version) => {
    const versionAfter = (text, script) => {
      const at = text.indexOf(`${script}?v=`);
      return at < 0 ? null : (text.slice(at + script.length + 3).match(/^[\d.]+/) || [null])[0];
    };
    const loaded = versionAfter(read(`public/${page}`), script);
    expect(loaded).not.toBeNull();
    const asNumber = text =>
      text.split('.').reduce((total, part) => total * 1000 + Number(part), 0);
    expect(asNumber(loaded)).toBeGreaterThanOrEqual(asNumber(version));
  });
});
