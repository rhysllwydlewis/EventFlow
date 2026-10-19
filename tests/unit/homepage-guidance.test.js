'use strict';

/**
 * Homepage guidance switch: the stored setting, the admin API, the per-request
 * body class on the public homepage, and the admin card that drives it.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) {
      return res.status(401).json({ error: 'auth required' });
    }
    req.user = { id: 'u1', email: 'admin@example.com', role };
    return next();
  },
  roleRequired: role => (req, res, next) =>
    req.user && req.user.role === role ? next() : res.status(403).json({ error: 'forbidden' }),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) =>
    req.get('x-csrf-token') === 'good' ? next() : res.status(403).json({ error: 'csrf' }),
}));

jest.mock('../../middleware/audit', () => ({ auditLog: jest.fn() }));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  writeAndVerify: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');
const { auditLog } = require('../../middleware/audit');
const {
  buildHomepageGuidance,
  getHomepageGuidanceEnabled,
  normaliseHomepageGuidance,
  updateHomepageGuidance,
  validateHomepageGuidancePayload,
} = require('../../utils/homepage-manager');
const { applyHomepageGuidance, removeBodyClass } = require('../../utils/template-renderer');
const router = require('../../routes/admin-homepage-manager');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('homepage guidance setting', () => {
  test('is on unless an admin has explicitly switched it off', () => {
    expect(buildHomepageGuidance({}).enabled).toBe(true);
    expect(buildHomepageGuidance({ homepageGuidance: null }).enabled).toBe(true);
    expect(buildHomepageGuidance({ homepageGuidance: 'off' }).enabled).toBe(true);
    expect(buildHomepageGuidance({ homepageGuidance: { enabled: 0 } }).enabled).toBe(true);
    expect(buildHomepageGuidance({ homepageGuidance: { enabled: false } }).enabled).toBe(false);
  });

  test('keeps only well-formed audit fields', () => {
    expect(normaliseHomepageGuidance({ enabled: true, updatedAt: 5, updatedBy: {} })).toEqual({
      enabled: true,
      updatedAt: null,
      updatedBy: null,
    });
  });

  test('accepts only a boolean', () => {
    expect(validateHomepageGuidancePayload({ enabled: false })).toBeNull();
    expect(validateHomepageGuidancePayload({ enabled: 'false' })).toEqual(expect.any(String));
    expect(validateHomepageGuidancePayload({})).toEqual(expect.any(String));
    expect(validateHomepageGuidancePayload(undefined)).toEqual(expect.any(String));
  });

  test('an update records who and when and leaves other settings alone', () => {
    const next = updateHomepageGuidance({ siteName: 'EventFlow' }, false, {
      email: 'admin@example.com',
    });
    expect(next.siteName).toBe('EventFlow');
    expect(next.homepageGuidance).toMatchObject({ enabled: false, updatedBy: 'admin@example.com' });
    expect(Number.isNaN(Date.parse(next.homepageGuidance.updatedAt))).toBe(false);
  });

  test('reads the stored value through the unified database', async () => {
    dbUnified.read.mockResolvedValueOnce({ homepageGuidance: { enabled: false } });
    await expect(getHomepageGuidanceEnabled()).resolves.toBe(false);
    dbUnified.read.mockResolvedValueOnce(null);
    await expect(getHomepageGuidanceEnabled()).resolves.toBe(true);
  });
});

describe('admin guidance API', () => {
  const app = () => {
    const instance = express();
    instance.use(express.json());
    instance.use('/api/v1/admin/homepage/manager', router);
    return instance;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.read.mockResolvedValue({ siteName: 'EventFlow' });
    dbUnified.writeAndVerify.mockImplementation(async (_name, data) => ({ data }));
  });

  test('requires an admin', async () => {
    const url = '/api/v1/admin/homepage/manager/guidance';
    await request(app()).get(url).expect(401);
    await request(app()).get(url).set('x-test-role', 'customer').expect(403);
    await request(app())
      .put(url)
      .set('x-test-role', 'customer')
      .send({ enabled: false })
      .expect(403);
  });

  test('reports on when nothing is stored', async () => {
    const res = await request(app())
      .get('/api/v1/admin/homepage/manager/guidance')
      .set('x-test-role', 'admin')
      .expect(200);
    expect(res.body.guidance.enabled).toBe(true);
  });

  test('saving needs the CSRF token and a boolean', async () => {
    const url = '/api/v1/admin/homepage/manager/guidance';
    await request(app()).put(url).set('x-test-role', 'admin').send({ enabled: false }).expect(403);
    await request(app())
      .put(url)
      .set({ 'x-test-role': 'admin', 'x-csrf-token': 'good' })
      .send({ enabled: 'nope' })
      .expect(400);
    expect(dbUnified.writeAndVerify).not.toHaveBeenCalled();
  });

  test('switching off is stored with the rest of the settings and audited', async () => {
    const res = await request(app())
      .put('/api/v1/admin/homepage/manager/guidance')
      .set({ 'x-test-role': 'admin', 'x-csrf-token': 'good' })
      .send({ enabled: false })
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      guidance: { enabled: false, updatedBy: 'admin@example.com' },
    });
    const [collection, saved] = dbUnified.writeAndVerify.mock.calls[0];
    expect(collection).toBe('settings');
    expect(saved.siteName).toBe('EventFlow');
    expect(saved.homepageGuidance.enabled).toBe(false);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'HOMEPAGE_GUIDANCE_UPDATED', details: { enabled: false } })
    );
  });

  test('a failed write is reported rather than pretending it worked', async () => {
    dbUnified.writeAndVerify.mockRejectedValueOnce(new Error('db down'));
    await request(app())
      .put('/api/v1/admin/homepage/manager/guidance')
      .set({ 'x-test-role': 'admin', 'x-csrf-token': 'good' })
      .send({ enabled: true })
      .expect(500);
  });
});

describe('homepage body class', () => {
  const page = '<html><body class="ef-home-flow ef-home-guidance"><main></main></body></html>';

  test('switching off removes only the guidance class', () => {
    const out = applyHomepageGuidance(page, false);
    expect(out).toContain('<body class="ef-home-flow">');
    expect(out).toContain('<main></main>');
  });

  test('leaving it on keeps the page as it was, and restores the class if it is missing', () => {
    expect(applyHomepageGuidance(page, true)).toBe(page);
    expect(applyHomepageGuidance('<body class="ef-home-flow">', true)).toBe(
      '<body class="ef-home-flow ef-home-guidance">'
    );
    expect(applyHomepageGuidance(page, undefined)).toBe(page);
  });

  test('does not touch similarly named classes or pages without a body class', () => {
    expect(removeBodyClass('<body class="ef-home-guidance-x a">', 'ef-home-guidance')).toBe(
      '<body class="ef-home-guidance-x a">'
    );
    expect(removeBodyClass('<body>', 'ef-home-guidance')).toBe('<body>');
  });
});

describe('admin homepage guidance card', () => {
  const html = read('public/admin-homepage.html');
  const script = read('public/assets/js/pages/admin-homepage-guidance.js');

  test('the page has a labelled switch and loads its script', () => {
    expect(html).toMatch(/<input[^>]*id="homepageGuidanceToggle"[^>]*role="switch"/);
    expect(html).toContain('id="homepageGuidanceLabel"');
    expect(html).toMatch(/id="homepageGuidanceMeta"[^>]*aria-live="polite"/);
    expect(html).toMatch(/admin-homepage-guidance\.js\?v=/);
  });

  test('the script uses the admin API with a CSRF token and undoes a failed save', () => {
    expect(script).toContain('/api/v1/admin/homepage/manager/guidance');
    expect(script).toContain('__CSRF_TOKEN__');
    expect(script).toContain("'PUT'");
    expect(script).toContain('toggle.checked = !wanted');
  });
});
