'use strict';

/**
 * Admin homepage manager routes (everything except the on/off switches, which
 * homepage-guidance.test.js covers): each handler is exercised through the real
 * router with the database mocked, on its success path and on its error path.
 */

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

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');
const { auditLog } = require('../../middleware/audit');
const router = require('../../routes/admin-homepage-manager');

const BASE = '/api/v1/admin/homepage/manager';

const photo = {
  provider: 'pexels',
  providerId: 123,
  type: 'photo',
  url: 'https://images.pexels.com/photos/123/test.jpeg',
  thumbnailUrl: 'https://images.pexels.com/photos/123/thumb.jpeg',
  alt: 'Elegant venue',
};

const app = () => {
  const instance = express();
  instance.use(express.json());
  instance.use(BASE, router);
  return instance;
};

const admin = req => req.set('x-test-role', 'admin').set('x-csrf-token', 'good');

describe('admin homepage manager routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.read.mockResolvedValue({});
    dbUnified.writeAndVerify.mockImplementation(async (_name, data) => ({ success: true, data }));
  });

  describe('every route', () => {
    const routes = [
      ['get', '/'],
      ['get', '/media-library'],
      ['get', '/media-library/v1'],
      ['post', '/media-library/v1/pexels'],
      ['delete', '/media-library/v1/pexels/x'],
      ['patch', '/media-library/v1'],
      ['put', '/version/v1'],
      ['post', '/publish/v1'],
      ['post', '/duplicate'],
    ];

    test.each(routes)('%s %s needs a signed-in admin and passes the rate limiter', async (m, p) => {
      await request(app())[m](`${BASE}${p}`).expect(401);
      await request(app())
        [m](`${BASE}${p}`)
        .set('x-test-role', 'user')
        .set('x-csrf-token', 'good')
        .expect(403);

      mockLimiter.mockClear();
      await admin(request(app())[m](`${BASE}${p}`)).send({});
      expect(mockLimiter).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /', () => {
    test('returns the manager built from stored settings', async () => {
      const res = await admin(request(app()).get(`${BASE}/`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.manager.versions).toEqual(
        expect.objectContaining({ v1: expect.any(Object), v2: expect.any(Object) })
      );
    });

    test('treats a missing settings document as empty', async () => {
      dbUnified.read.mockResolvedValue(null);
      await admin(request(app()).get(`${BASE}/`)).expect(200);
    });

    test('answers 500 when settings cannot be read', async () => {
      dbUnified.read.mockRejectedValue(new Error('db down'));
      const res = await admin(request(app()).get(`${BASE}/`)).expect(500);
      expect(res.body.error).toEqual(expect.any(String));
    });
  });

  describe('media library reads', () => {
    test('lists the library of every version', async () => {
      const res = await admin(request(app()).get(`${BASE}/media-library`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(Object.keys(res.body.versions)).toEqual(expect.arrayContaining(['v1', 'v2', 'v3']));
      expect(res.body.activeVersion).toEqual(expect.any(String));
    });

    test('lists the library of one version', async () => {
      const res = await admin(request(app()).get(`${BASE}/media-library/v2`)).expect(200);
      expect(res.body).toMatchObject({ success: true, version: 'v2' });
      expect(res.body.mediaLibrary).toEqual(expect.any(Object));
    });

    test('rejects a version that does not exist', async () => {
      const res = await admin(request(app()).get(`${BASE}/media-library/v9`)).expect(400);
      expect(res.body.error).toMatch(/valid homepage version/i);
    });

    test.each(['/media-library', '/media-library/v1'])(
      '%s answers 500 on a read error',
      async p => {
        dbUnified.read.mockRejectedValue(new Error('db down'));
        const res = await admin(request(app()).get(`${BASE}${p}`)).expect(500);
        expect(res.body.error).toMatch(/media library/i);
      }
    );
  });

  describe('POST /media-library/:version/pexels', () => {
    const url = `${BASE}/media-library/v2/pexels`;

    test('assigns media, audits it and says what changed', async () => {
      const res = await admin(request(app()).post(url)).send({ target: 'collage', media: photo });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        version: 'v2',
        modeAfterAssign: 'unchanged',
        modeChanged: false,
      });
      expect(res.body.mediaLibrary.selectedPexels).toHaveLength(1);
      expect(res.body.message).toMatch(/Photo assigned to V2 collage\./);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'HOMEPAGE_MEDIA_ASSIGNED',
          targetId: 'v2',
          details: expect.objectContaining({ version: 'v2', target: 'collage' }),
        })
      );
    });

    test.each([
      ['selected_pexels', /selected Pexels media only/],
      ['selected_with_fallback', /selected media with automatic fallback/],
    ])('describes the %s media source', async (modeAfterAssign, message) => {
      const res = await admin(request(app()).post(url)).send({
        target: 'hero',
        media: { ...photo, type: 'video', url: 'https://videos.pexels.com/video-files/1/v.mp4' },
        modeAfterAssign,
      });
      expect(res.status).toBe(200);
      expect(res.body.modeChanged).toBe(true);
      expect(res.body.message).toMatch(/Video assigned to V2 hero\./);
      expect(res.body.message).toMatch(message);
    });

    test('says when the version is live and names a general placement', async () => {
      dbUnified.read.mockResolvedValue({ homepageManager: { activeVersion: 'v2' } });
      const res = await admin(request(app()).post(url)).send({
        target: 'general',
        media: photo,
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/general homepage media/);
      expect(res.body.message).toMatch(/V2 is currently live\./);
    });

    test('answers 400 for an invalid payload and writes nothing', async () => {
      const res = await admin(request(app()).post(url)).send({ target: 'nowhere', media: photo });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid homepage placement/);
      expect(dbUnified.writeAndVerify).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    test('answers 400 when the request has no body at all', async () => {
      const res = await admin(request(app()).post(url));
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /media-library/:version/pexels/:mediaId', () => {
    test('removes the media and returns the library', async () => {
      let stored = {};
      dbUnified.read.mockImplementation(async () => stored);
      dbUnified.writeAndVerify.mockImplementation(async (_n, data) => {
        stored = data;
        return { success: true, data };
      });
      const added = await admin(request(app()).post(`${BASE}/media-library/v1/pexels`)).send({
        target: 'collage',
        media: photo,
      });
      const [{ id }] = added.body.mediaLibrary.selectedPexels;

      const res = await admin(
        request(app()).delete(`${BASE}/media-library/v1/pexels/${id}`)
      ).expect(200);
      expect(res.body).toMatchObject({ success: true, version: 'v1' });
      expect(res.body.mediaLibrary.selectedPexels).toHaveLength(0);
    });

    test('answers 400 for a version that does not exist', async () => {
      const res = await admin(request(app()).delete(`${BASE}/media-library/v9/pexels/x`)).expect(
        400
      );
      expect(res.body.error).toMatch(/invalid homepage version/i);
    });
  });

  describe('PATCH /media-library/:version', () => {
    test('updates the library settings', async () => {
      const res = await admin(request(app()).patch(`${BASE}/media-library/v1`)).send({
        mode: 'uploads',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, version: 'v1' });
      expect(res.body.mediaLibrary.mode).toBe('uploads');
    });

    test('treats a missing body as an empty patch', async () => {
      await admin(request(app()).patch(`${BASE}/media-library/v1`)).expect(200);
    });

    test('answers 400 for an invalid mode', async () => {
      const res = await admin(request(app()).patch(`${BASE}/media-library/v1`)).send({
        mode: 'bogus',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    });
  });

  describe('PUT /version/:version', () => {
    const url = `${BASE}/version/v2`;

    test('saves the version and audits it', async () => {
      const res = await admin(request(app()).put(url)).send({ tabName: 'Spring', status: 'draft' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toEqual(expect.any(Object));
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'v2',
          details: expect.objectContaining({ version: 'v2', tabName: 'Spring', status: 'draft' }),
        })
      );
    });

    test('answers 400 for an invalid payload without reading or writing settings', async () => {
      const res = await admin(request(app()).put(url)).send({ status: 'bogus' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid homepage status/i);
      expect(dbUnified.read).not.toHaveBeenCalled();
      expect(dbUnified.writeAndVerify).not.toHaveBeenCalled();
    });

    test('answers 400 for a version that does not exist', async () => {
      const res = await admin(request(app()).put(`${BASE}/version/v9`)).send({ tabName: 'x' });
      expect(res.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  describe('POST /publish/:version', () => {
    test('makes the version live and audits it', async () => {
      const res = await admin(request(app()).post(`${BASE}/publish/v3`)).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.manager.activeVersion).toBe('v3');
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: 'v3', adminId: 'u1' })
      );
    });

    test('answers 400 for a version that does not exist', async () => {
      const res = await admin(request(app()).post(`${BASE}/publish/v9`));
      expect(res.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  describe('POST /duplicate', () => {
    test('copies one version into another and audits it', async () => {
      const res = await admin(request(app()).post(`${BASE}/duplicate`)).send({
        sourceVersion: 'v1',
        targetVersion: 'v3',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'HOMEPAGE_VERSION_DUPLICATED',
          targetId: 'v3',
          details: { sourceVersion: 'v1', targetVersion: 'v3' },
        })
      );
    });

    test('answers 400 for versions that do not exist, with or without a body', async () => {
      const bad = await admin(request(app()).post(`${BASE}/duplicate`)).send({
        sourceVersion: 'v1',
        targetVersion: 'v9',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toEqual(expect.any(String));

      const empty = await admin(request(app()).post(`${BASE}/duplicate`));
      expect(empty.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });
});
