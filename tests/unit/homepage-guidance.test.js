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

const mockLimiter = jest.fn((req, res, next) => next());
jest.mock('../../middleware/rateLimits', () => ({
  adminHomepageLimiter: (req, res, next) => mockLimiter(req, res, next),
}));

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
  getHomepageToggles,
  normaliseHomepageGuidance,
  updateHomepageGuidance,
  validateHomepageGuidancePayload,
} = require('../../utils/homepage-manager');
const {
  applyHomepageGuidance,
  applyHomepageToggles,
  removeBodyClass,
  templateMiddleware,
  clearCache,
} = require('../../utils/template-renderer');
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

  test('each switch is read and kept on its own, from a single read', async () => {
    dbUnified.read.mockClear();
    dbUnified.read.mockResolvedValueOnce({
      homepageQuickLinks: { enabled: false },
      homepageGuidance: { enabled: true },
    });
    await expect(getHomepageToggles()).resolves.toEqual({ guidance: true, quickLinks: false });
    expect(dbUnified.read).toHaveBeenCalledTimes(1);

    dbUnified.read.mockResolvedValueOnce({});
    await expect(getHomepageToggles()).resolves.toEqual({ guidance: true, quickLinks: true });
  });
});

describe.each([
  ['guidance', 'guidance', 'HOMEPAGE_GUIDANCE_UPDATED', 'homepageGuidance'],
  ['quick-links', 'quickLinks', 'HOMEPAGE_QUICK_LINKS_UPDATED', 'homepageQuickLinks'],
])('admin homepage switch API: %s', (path, key, action, setting) => {
  const url = `/api/v1/admin/homepage/manager/${path}`;
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

  test('is rate limited before anything else runs', async () => {
    mockLimiter.mockClear();
    await request(app()).get(url).expect(401);
    expect(mockLimiter).toHaveBeenCalledTimes(1);

    mockLimiter.mockImplementationOnce((req, res) => res.status(429).json({ error: 'slow down' }));
    await request(app()).get(url).set('x-test-role', 'admin').expect(429);
    expect(dbUnified.read).not.toHaveBeenCalled();
  });

  test('requires an admin', async () => {
    await request(app()).get(url).expect(401);
    await request(app()).get(url).set('x-test-role', 'customer').expect(403);
    await request(app())
      .put(url)
      .set('x-test-role', 'customer')
      .send({ enabled: false })
      .expect(403);
  });

  test('reports on when nothing is stored', async () => {
    const res = await request(app()).get(url).set('x-test-role', 'admin').expect(200);
    expect(res.body.toggle.enabled).toBe(true);
  });

  test('saving needs the CSRF token and a boolean', async () => {
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
      .put(url)
      .set({ 'x-test-role': 'admin', 'x-csrf-token': 'good' })
      .send({ enabled: false })
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      toggle: { enabled: false, updatedBy: 'admin@example.com' },
    });
    const [collection, saved] = dbUnified.writeAndVerify.mock.calls[0];
    expect(collection).toBe('settings');
    expect(saved.siteName).toBe('EventFlow');
    expect(saved[setting].enabled).toBe(false);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action, targetId: key, details: { enabled: false } })
    );
  });

  test('changing one switch leaves the other as it was', async () => {
    dbUnified.read.mockResolvedValue({
      homepageGuidance: { enabled: false },
      homepageQuickLinks: { enabled: false },
    });
    await request(app())
      .put(url)
      .set({ 'x-test-role': 'admin', 'x-csrf-token': 'good' })
      .send({ enabled: true })
      .expect(200);
    const saved = dbUnified.writeAndVerify.mock.calls[0][1];
    const other = setting === 'homepageGuidance' ? 'homepageQuickLinks' : 'homepageGuidance';
    expect(saved[setting].enabled).toBe(true);
    expect(saved[other].enabled).toBe(false);
  });

  test('a failed write is reported rather than pretending it worked', async () => {
    dbUnified.writeAndVerify.mockRejectedValueOnce(new Error('db down'));
    await request(app())
      .put(url)
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

  test('each switch removes only its own class', () => {
    const both =
      '<html><body class="ef-home-flow ef-home-guidance ef-home-quicklinks"></body></html>';
    expect(applyHomepageToggles(both, { guidance: true, quickLinks: false })).toContain(
      '<body class="ef-home-flow ef-home-guidance">'
    );
    expect(applyHomepageToggles(both, { guidance: false, quickLinks: true })).toContain(
      '<body class="ef-home-flow ef-home-quicklinks">'
    );
    expect(applyHomepageToggles(both, { guidance: false, quickLinks: false })).toContain(
      '<body class="ef-home-flow">'
    );
    // nothing known means everything stays on, and a missing class is put back
    expect(applyHomepageToggles(both, {})).toBe(both);
    expect(applyHomepageToggles('<body class="ef-home-flow">', {})).toContain(
      'ef-home-guidance ef-home-quicklinks'
    );
  });

  test('does not touch similarly named classes or pages without a body class', () => {
    expect(removeBodyClass('<body class="ef-home-guidance-x a">', 'ef-home-guidance')).toBe(
      '<body class="ef-home-guidance-x a">'
    );
    expect(removeBodyClass('<body>', 'ef-home-guidance')).toBe('<body>');
  });
});

describe('homepage served through the template middleware', () => {
  const app = () => {
    const instance = express();
    instance.use(templateMiddleware());
    return instance;
  };
  const bodyTag = res => res.text.match(/<body\b[^>]*>/i)[0];

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  test('guidance is on when nothing is stored', async () => {
    dbUnified.read.mockResolvedValue({});
    const res = await request(app()).get('/').expect(200);
    expect(bodyTag(res)).toContain('ef-home-guidance');
    expect(res.text).toContain('class="ef-flow-seam"');
  });

  test('switching it off drops the class on every route that serves the homepage template', async () => {
    dbUnified.read.mockResolvedValue({ homepageGuidance: { enabled: false } });
    for (const route of ['/', '/index.html', '/home-v3-preview']) {
      const res = await request(app()).get(route).expect(200);
      expect(bodyTag(res)).toContain('ef-home-flow');
      expect(bodyTag(res)).not.toContain('ef-home-guidance');
    }
  });

  test('the quick-links switch is applied on its own', async () => {
    dbUnified.read.mockResolvedValue({ homepageQuickLinks: { enabled: false } });
    const res = await request(app()).get('/').expect(200);
    expect(bodyTag(res)).toContain('ef-home-guidance');
    expect(bodyTag(res)).not.toContain('ef-home-quicklinks');
  });

  test('the Homepage 2 file is left alone', async () => {
    dbUnified.read.mockResolvedValue({ homepageGuidance: { enabled: false } });
    const res = await request(app()).get('/home-v2-preview').expect(200);
    expect(res.text).not.toContain('ef-flow-seam');
  });

  test('a setting that cannot be read leaves guidance on, and the answer is never cached', async () => {
    dbUnified.read.mockRejectedValue(new Error('db down'));
    const on = await request(app()).get('/index.html').expect(200);
    expect(bodyTag(on)).toContain('ef-home-guidance');

    dbUnified.read.mockResolvedValue({ homepageGuidance: { enabled: false } });
    const off = await request(app()).get('/index.html').expect(200);
    expect(bodyTag(off)).not.toContain('ef-home-guidance');

    dbUnified.read.mockResolvedValue({ homepageGuidance: { enabled: true } });
    const again = await request(app()).get('/index.html').expect(200);
    expect(bodyTag(again)).toContain('ef-home-guidance');
  });
});

describe('admin homepage switches', () => {
  const html = read('public/admin-homepage.html');
  const script = read('public/assets/js/pages/admin-homepage-guidance.js');

  test.each([
    ['guidance', 'homepageGuidanceToggle', 'homepageGuidanceMeta'],
    ['quick-links', 'homepageQuickLinksToggle', 'homepageQuickLinksMeta'],
  ])('the %s switch is labelled, announced and wired up', (path, toggleId, metaId) => {
    expect(html).toContain(`data-homepage-toggle="${path}"`);
    expect(html).toMatch(new RegExp(`<input[^>]*id="${toggleId}"[^>]*role="switch"`));
    expect(html).toMatch(new RegExp(`id="${metaId}"[^>]*aria-live="polite"`));
  });

  test('the page loads the script with a cache-busting version', () => {
    expect(html).toMatch(/admin-homepage-guidance\.js\?v=/);
  });

  test('the quick-links card points to the sign-up popup controls instead of duplicating them', () => {
    expect(html).toContain('Admin &rarr; Settings');
  });

  test('the switch keeps a visible boundary when off, and survives forced colours', () => {
    const adminCss = read('public/assets/css/admin-homepage-rebuild.css');
    const off = adminCss.match(
      /\.homepage-guidance-track\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i
    )[1];
    const lum = hex =>
      [1, 3, 5]
        .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    expect((1 + 0.05) / (lum(off) + 0.05)).toBeGreaterThanOrEqual(3);
    expect(adminCss).toMatch(/@media \(forced-colors: active\)[\s\S]*homepage-guidance-track/);
  });

  test('the script drives every switch from the API, sends a CSRF token and undoes a failed save', () => {
    expect(script).toContain('/api/v1/admin/homepage/manager/');
    expect(script).toContain('[data-homepage-toggle]');
    expect(script).toContain('__CSRF_TOKEN__');
    expect(script).toContain("'PUT'");
    expect(script).toContain('toggle.checked = !wanted');
  });
});
