'use strict';

/**
 * Admin pages that said "saved" when nothing was saved (audit group 3, F1 to F9).
 *
 * Server behaviour is exercised against the real routers with an in-memory database; the page
 * scripts are checked by reading their source for the exact request or markup that was wrong.
 */

const fs = require('fs');
const path = require('path');

const mockStore = {};

const mockMatches = (record, filter = {}) =>
  Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some(branch => mockMatches(record, branch));
    }
    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return record[key] !== expected.$ne;
    }
    return record[key] === expected;
  });

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
  return {
    ...actual,
    auditLog: jest.fn().mockResolvedValue({}),
    auditMiddleware: () => (req, res, next) => next(),
  };
});
jest.mock('../../middleware/permissions', () => {
  const actual = jest.requireActual('../../middleware/permissions');
  return { ...actual, requirePermission: () => (req, res, next) => next() };
});
jest.mock('../../utils/auditTrail', () => ({
  ...jest.requireActual('../../utils/auditTrail'),
  createAuditLog: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => mockStore[name] || []),
  find: jest.fn(async (name, filter) =>
    (mockStore[name] || []).filter(r => mockMatches(r, filter))
  ),
  findOne: jest.fn(
    async (name, filter) => (mockStore[name] || []).find(r => mockMatches(r, filter)) || null
  ),
  updateOne: jest.fn(async (name, filter, update) => {
    const record = (mockStore[name] || []).find(r => mockMatches(r, filter));
    if (!record) {
      return false;
    }
    for (const [key, value] of Object.entries(update.$set || update)) {
      // Like the real database, a dotted key is a path into a nested object
      const path = key.split('.');
      const last = path.pop();
      const target = path.reduce((node, part) => node[part], record);
      target[last] = value;
    }
    return true;
  }),
  writeAndVerify: jest.fn(async (name, value) => {
    mockStore[name] = value;
    return { success: true, data: value };
  }),
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
const { getAuditLogs } = require('../../middleware/audit');

const ROOT = path.join(__dirname, '../..');
const source = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function appWith(routerPath) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require(routerPath));
  return app;
}

function resetStore() {
  Object.keys(mockStore).forEach(key => delete mockStore[key]);
  mockStore.users = [
    { id: 'u1', name: 'Ada', email: 'ada@example.test', role: 'customer', suspended: false },
    { id: 'u2', name: 'Bob', email: 'bob@example.test', role: 'customer' },
  ];
  mockStore.suppliers = [
    {
      id: 's1',
      name: 'Old Name',
      category: 'Venues',
      location: 'Leeds',
      approved: true,
      description_short: 'Barn hall',
    },
    { id: 's2', name: 'Other', category: 'Venues', approved: true, description_short: 'garden' },
  ];
  mockStore.reviews = [];
  mockStore.audit_logs = [];
}

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
});

describe('F1 Suspend User', () => {
  it('the page sends suspended:true and shows the server message', () => {
    const page = source('public/assets/js/pages/admin-user-detail-init.js');
    expect(page).toMatch(/\{ suspended: true, reason \}/);
    expect(page).toMatch(/data && data\.message/);
  });

  it('the endpoint suspends when it receives the flag', async () => {
    const response = await request(appWith('../../routes/admin-user-management'))
      .post('/api/admin/users/u1/suspend')
      .send({ suspended: true, reason: 'Spam' });
    expect(response.status).toBe(200);
    expect(mockStore.users[0].suspended).toBe(true);
    expect(mockStore.users[0].suspensionReason).toBe('Spam');
  });

  it('unsuspend clears every suspension field, including the reason the suspend route wrote', async () => {
    const app = appWith('../../routes/admin-user-management');
    await request(app)
      .post('/api/admin/users/u1/suspend')
      .send({ suspended: true, reason: 'Spam', duration: '7d' });
    const response = await request(app).post('/api/admin/users/u1/unsuspend');
    expect(response.status).toBe(200);
    expect(mockStore.users[0]).toMatchObject({
      suspended: false,
      suspensionReason: null,
      suspensionDuration: null,
      suspensionExpiresAt: null,
    });
  });
});

describe('F2 saving a user', () => {
  const app = () => appWith('../../routes/admin-user-management');

  it('answers 409 when the email belongs to someone else, and changes nothing', async () => {
    const response = await request(app())
      .put('/api/admin/users/u1')
      .send({ name: 'New Name', email: 'BOB@example.test' });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
    expect(mockStore.users[0].name).toBe('Ada');
  });

  it('rejects an invalid email', async () => {
    const response = await request(app())
      .put('/api/admin/users/u1')
      .send({ email: 'not-an-email' });
    expect(response.status).toBe(400);
  });

  it('saves a new email lowercased, and keeping your own email is fine', async () => {
    const changed = await request(app())
      .put('/api/admin/users/u1')
      .send({ email: ' New@Example.test ' });
    expect(changed.status).toBe(200);
    expect(mockStore.users[0].email).toBe('new@example.test');

    const same = await request(app())
      .put('/api/admin/users/u2')
      .send({ email: 'bob@example.test', name: 'Robert' });
    expect(same.status).toBe(200);
    expect(mockStore.users[1].name).toBe('Robert');
  });

  it('reports a failed write as an error, not success', async () => {
    dbUnified.updateOne.mockResolvedValueOnce(false);
    const response = await request(app()).put('/api/admin/users/u1').send({ name: 'X' });
    expect(response.status).toBe(500);
  });

  it('turns a database duplicate-key failure into 409', async () => {
    dbUnified.updateOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    const response = await request(app()).put('/api/admin/users/u1').send({ name: 'X' });
    expect(response.status).toBe(409);
  });
});

describe('F3 supplier Edit Details', () => {
  const app = () => appWith('../../routes/admin-user-management');

  it('saves each field the page can send', async () => {
    const response = await request(app()).put('/api/admin/suppliers/s1').send({
      category: 'Catering',
      price_display: '£££',
      website: 'https://example.test',
      email: 'Hello@Example.test',
      phone: '0113 496 0000',
      description_short: 'Great food',
    });
    expect(response.status).toBe(200);
    expect(mockStore.suppliers[0]).toMatchObject({
      category: 'Catering',
      price_display: '£££',
      website: 'https://example.test',
      email: 'hello@example.test',
      phone: '0113 496 0000',
      description_short: 'Great food',
    });
    expect(mockStore.suppliers[0].name).toBe('Old Name');
  });

  it.each([
    [{ name: '   ' }, /name cannot be empty/i],
    [{ website: 'javascript:alert(1)' }, /http/i],
    [{ email: 'nope' }, /valid email/i],
    [{ category: '' }, /category/i],
    [{ category: 'Photographer' }, /must be one of/i],
    [{ phone: '1'.repeat(40) }, /30 characters/],
  ])('rejects %j', async (body, message) => {
    const response = await request(app()).put('/api/admin/suppliers/s1').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(message);
    expect(mockStore.suppliers[0].name).toBe('Old Name');
  });

  it('allows clearing the website and phone', async () => {
    mockStore.suppliers[0].website = 'https://old.test';
    const response = await request(app())
      .put('/api/admin/suppliers/s1')
      .send({ website: '', phone: '' });
    expect(response.status).toBe(200);
    expect(mockStore.suppliers[0].website).toBe('');
  });
});

describe('F4 supplier photo Delete', () => {
  it('uses the existing delete route with the photo address, not a missing /admin/photos/:id', () => {
    const page = source('public/assets/js/pages/admin-supplier-detail-init.js');
    expect(page).not.toMatch(/api\/admin\/photos\/\$\{id\}`, 'DELETE'/);
    expect(page).toMatch(/\/api\/photos\/delete\?type=supplier&id=/);
    expect(page).toMatch(/data-action="deletePhoto" data-url=/);
  });

  it('the route the page now calls exists and accepts an admin', () => {
    const photos = source('routes/photos.js');
    expect(photos).toMatch(/router\.delete\('\/photos\/delete'/);
    expect(photos).toMatch(/supplier\.ownerUserId !== user\.id && user\.role !== 'admin'/);
  });
});

describe('F5 Settings maintenance switch', () => {
  it('does not write to the status text inside the action that replaces the button content', () => {
    const page = source('public/assets/js/pages/admin-settings-init.js');
    const handler = page.slice(
      page.indexOf("getElementById('quickToggleMaintenance').addEventListener")
    );
    const action = handler.slice(handler.indexOf('safeAction('), handler.indexOf('loadingText'));
    expect(action).not.toMatch(/updateMaintenanceButton|loadMaintenanceMode/);
    const after = handler.slice(handler.indexOf('loadingText'));
    expect(after).toMatch(/updateMaintenanceButton\(newState\)/);
    expect(after).toMatch(/await loadMaintenanceMode\(\)/);
  });

  it('disableButton restores the original markup, not just its text', () => {
    const shared = source('public/assets/js/admin-shared.js');
    expect(shared).toMatch(/const originalHtml = button\.innerHTML;/);
    expect(shared).toMatch(/button\.innerHTML = originalHtml;/);
  });
});

describe('F6 Settings audit log filter', () => {
  it('matches any of a comma-separated list of target types', async () => {
    mockStore.audit_logs = [
      { id: 1, targetType: 'features', timestamp: '2026-01-03T00:00:00Z' },
      { id: 2, targetType: 'settings', timestamp: '2026-01-02T00:00:00Z' },
      { id: 3, targetType: 'user', timestamp: '2026-01-04T00:00:00Z' },
      { id: 4, targetType: 'maintenance', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const logs = await getAuditLogs({ targetType: 'features,settings,maintenance', limit: 20 });
    expect(logs.map(log => log.id)).toEqual([1, 2, 4]);
  });

  it('still matches a single type', async () => {
    mockStore.audit_logs = [
      { id: 1, targetType: 'user', timestamp: '2026-01-03T00:00:00Z' },
      { id: 2, targetType: 'features', timestamp: '2026-01-02T00:00:00Z' },
    ];
    expect((await getAuditLogs({ targetType: 'user' })).map(log => log.id)).toEqual([1]);
  });
});

describe('F7 Community admin', () => {
  it('toasts through AdminShared when there is no global showToast', () => {
    const core = source('public/assets/js/community/core.js');
    expect(core).toMatch(/window\.AdminShared && window\.AdminShared\.showToast/);
  });

  it('requests open, in-review and escalated reports and quarantined replies as well as discussions', () => {
    const admin = source('public/assets/js/community/admin.js');
    expect(admin).toMatch(/\['open', 'in_review', 'escalated'\]/);
    expect(admin).toMatch(/\['discussion', 'reply'\]/);
    expect(admin).toMatch(/content\?state=quarantined&type=\$\{type\}/);
    expect(admin).not.toMatch(/item\.title \? 'discussion' : 'reply'/);
  });

  it('moderation cards use a one-column layout so long text is not cut off', () => {
    const admin = source('public/assets/js/community/admin.js');
    expect(admin.match(/<li class="efc-discussion">/g)).toBeNull();
    expect(admin.match(/<li class="efc-discussion efc-discussion--stacked">/g)).toHaveLength(5);
    expect(source('public/assets/css/community.css')).toMatch(
      /\.efc-discussion--stacked \{\s*grid-template-columns: minmax\(0, 1fr\);/
    );
    expect(source('scripts/generate-community-pages.mjs')).toMatch(
      /'\/assets\/css\/community\.css': '18\.6\.3'/
    );
  });

  it('the generator bumps the scripts it changed and the generated admin page carries them', () => {
    const generator = source('scripts/generate-community-pages.mjs');
    expect(generator).toMatch(/'\/assets\/js\/community\/core\.js': '18\.6\.1'/);
    expect(generator).toMatch(/'\/assets\/js\/community\/admin\.js': '18\.6\.1'/);
    const page = source('public/admin-community.html');
    expect(page).toMatch(/community\/core\.js\?v=18\.6\.1/);
    expect(page).toMatch(/community\/admin\.js\?v=18\.6\.1/);
  });
});

describe('F8 Reviews', () => {
  const app = () => appWith('../../routes/admin-v2');

  beforeEach(() => {
    mockStore.reviews = [
      { id: 'r1', status: 'pending', supplierId: 's1', authorId: 'u1', rating: 4 },
      { id: 'r2', status: 'approved', flagged: true, supplierId: 's1', authorId: 'u2' },
      { id: 'r3', status: 'rejected', flagged: true, supplierId: 's1', authorId: 'u2' },
      { id: 'r4', status: 'approved', supplierId: 's2', authorId: 'u1' },
    ];
  });

  it('lists waiting and reported reviews, not rejected or settled ones, with names', async () => {
    const response = await request(app()).get('/api/admin/reviews/pending');
    expect(response.status).toBe(200);
    expect(response.body.data.map(review => review.id)).toEqual(['r1', 'r2']);
    expect(response.body.data[0]).toMatchObject({ supplierName: 'Old Name', authorName: 'Ada' });
  });

  it('approving a reported review takes it out of the queue for good', async () => {
    const approve = await request(app()).post('/api/admin/reviews/r2/approve');
    expect(approve.status).toBe(200);
    expect(mockStore.reviews[1].flagged).toBe(false);
    const queue = await request(app()).get('/api/admin/reviews/pending');
    expect(queue.body.data.map(review => review.id)).toEqual(['r1']);
  });

  it('rejecting a reported review clears the report flag too', async () => {
    mockStore.reviews[1].status = 'pending';
    await request(app()).post('/api/admin/reviews/r2/reject').send({ reason: 'Valid report' });
    expect(mockStore.reviews[1]).toMatchObject({ status: 'rejected', flagged: false });
    const queue = await request(app()).get('/api/admin/reviews/pending');
    expect(queue.body.data.map(review => review.id)).toEqual(['r1']);
  });

  it('rejecting a published legacy review unpublishes it as the public pages read it', async () => {
    const { isApprovedReview } = require('../../utils/reviewShape');
    mockStore.reviews = [
      { id: 'legacy', status: 'pending', approved: true, flagged: true, supplierId: 's1' },
    ];
    expect(isApprovedReview(mockStore.reviews[0])).toBe(true);
    await request(app()).post('/api/admin/reviews/legacy/reject').send({ reason: 'Valid report' });
    expect(isApprovedReview(mockStore.reviews[0])).toBe(false);
    expect(mockStore.reviews[0].flagged).toBe(false);
  });

  it('approving a legacy review publishes it as the public pages read it', async () => {
    const { isApprovedReview } = require('../../utils/reviewShape');
    mockStore.reviews = [{ id: 'legacy', status: 'pending', approved: false, supplierId: 's1' }];
    await request(app()).post('/api/admin/reviews/legacy/approve');
    expect(isApprovedReview(mockStore.reviews[0])).toBe(true);
  });

  it('keeps a v2 review moderation state in step with the decision', async () => {
    const { reviewState } = require('../../utils/reviewShape');
    mockStore.reviews = [
      { id: 'v2', status: 'pending', moderation: { state: 'pending' }, supplierId: 's1' },
    ];
    await request(app()).post('/api/admin/reviews/v2/approve');
    expect(mockStore.reviews[0].moderation.state).toBe('approved');
    expect(reviewState(mockStore.reviews[0])).toBe('approved');
    await request(app()).post('/api/admin/reviews/v2/reject').send({});
    expect(reviewState(mockStore.reviews[0])).toBe('rejected');
    expect(mockStore.reviews[0]['moderation.state']).toBeUndefined();
  });

  it('the page offers Approve/Reject for plain pending reviews and names, not ids', () => {
    const page = source('public/assets/js/pages/admin-reviews-init.js');
    expect(page).toMatch(/data-action="publish"/);
    expect(page).toMatch(/data-action="decline"/);
    expect(page).toMatch(/review\.supplierName \|\| review\.supplierId/);
    expect(page).toMatch(/review\.authorName \|\| review\.authorId/);
  });
});

describe('F9 Suppliers page', () => {
  const app = () => appWith('../../routes/admin');

  it('Smart Tag only touches the selected suppliers', async () => {
    const response = await request(app())
      .post('/api/admin/suppliers/smart-tags')
      .send({ supplierIds: ['s1'] });
    expect(response.status).toBe(200);
    expect(response.body.taggedCount).toBe(1);
    expect(mockStore.suppliers[0].tags).toEqual(expect.arrayContaining(['venue']));
    expect(mockStore.suppliers[1].tags).toBeUndefined();
  });

  it('Smart Tag refuses an empty selection instead of tagging everyone', async () => {
    const response = await request(app())
      .post('/api/admin/suppliers/smart-tags')
      .send({ supplierIds: [] });
    expect(response.status).toBe(400);
    expect(mockStore.suppliers.every(supplier => supplier.tags === undefined)).toBe(true);
  });

  it('turning auto-approve on leaves rejected, needs-changes and suspended suppliers alone', async () => {
    mockStore.settings = {
      features: { autoApproveSupplierVerification: false, autoApproveReviews: true },
    };
    mockStore.suppliers = [
      { id: 'p', name: 'Waiting', approved: false, verificationStatus: 'pending_review' },
      { id: 'a', name: 'Listed', approved: true, verificationStatus: 'pending_review' },
      { id: 'n', name: 'New', approved: false, verificationStatus: 'unverified' },
      { id: 'r', name: 'Rejected', approved: false, verificationStatus: 'rejected' },
      { id: 'c', name: 'Changes', approved: false, verificationStatus: 'needs_changes' },
      { id: 'x', name: 'Suspended', approved: false, verificationStatus: 'suspended' },
    ];
    const response = await request(app())
      .put('/api/admin/settings/features')
      .send({ autoApproveSupplierVerification: true });
    expect(response.status).toBe(200);
    const byId = Object.fromEntries(mockStore.suppliers.map(supplier => [supplier.id, supplier]));
    expect(byId.p.approved).toBe(true);
    expect(byId.a.verificationStatus).toBe('approved');
    expect(byId.n.approved).toBe(true);
    expect(byId.r.approved).toBe(false);
    expect(byId.c.approved).toBe(false);
    expect(byId.x.approved).toBe(false);
  });

  it('the page asks before turning auto-approve on and clears the selection on filter and page change', () => {
    const page = source('public/assets/js/pages/admin-suppliers-init.js');
    expect(page).toMatch(/title: 'Turn on auto-approve\?'/);
    const filters = page.slice(page.indexOf('currentPage = 1;'));
    expect(
      page.slice(page.indexOf('selectedSuppliers.clear();\n    currentPage = 1;'))
    ).toBeTruthy();
    expect(filters).toBeTruthy();
    expect(page).toMatch(
      /function changePage\(delta\) \{\s*\/\/[^\n]*\n\s*selectedSuppliers\.clear\(\);/
    );
    expect(page).toMatch(/selectedSuppliers\.clear\(\);\s*currentPage = 1;/);
  });
});

describe('cache versions', () => {
  it.each([
    ['public/admin-user-detail.html', 'admin-user-detail-init.js?v=18.5.10'],
    ['public/admin-supplier-detail.html', 'admin-supplier-detail-init.js?v=18.5.10'],
    ['public/admin-settings.html', 'admin-settings-init.js?v=18.5.10'],
    ['public/admin-reviews.html', 'admin-reviews-init.js?v=18.5.10'],
    ['public/admin-suppliers.html', 'admin-suppliers-init.js?v=18.5.10'],
    ['public/admin-settings.html', 'admin-shared.js?v=18.5.10'],
  ])('%s loads %s', (file, reference) => {
    expect(source(file)).toContain(reference);
  });
});
