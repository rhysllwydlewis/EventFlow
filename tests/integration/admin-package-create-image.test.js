/**
 * POST /api/admin/packages refuses an image that is not a real image address and never stores it.
 * These run the real route in routes/admin.js.
 *
 * @jest-environment node
 */
'use strict';

const request = require('supertest');
const express = require('express');

const mockInsertOne = jest.fn(async (_collection, doc) => doc);

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'suppliers' ? [{ id: 'sup-1' }] : [])),
  insertOne: (...args) => mockInsertOne(...args),
}));

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return app;
}

const body = { supplierId: 'sup-1', title: 'Garden party', price: '100' };

describe('POST /api/admin/packages image validation', () => {
  beforeEach(() => mockInsertOne.mockClear());

  test.each([
    'https://example.com/a.jpg" onerror="alert(1)',
    'javascript:alert(1)',
    '//evil.example/a.jpg',
    { url: 'x' },
  ])('rejects %p with 400 and stores nothing', async image => {
    const res = await request(buildApp())
      .post('/api/admin/packages')
      .send({ ...body, image })
      .expect(400);
    expect(res.body.error).toBe('Invalid image');
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  test.each(['/api/photos/abc123?w=640', 'https://example.com/a.jpg'])(
    'stores the valid image %s',
    async image => {
      const res = await request(buildApp())
        .post('/api/admin/packages')
        .send({ ...body, image })
        .expect(201);
      expect(res.body.package.image).toBe(image);
      expect(mockInsertOne.mock.calls[0][1].image).toBe(image);
    }
  );

  test('a missing image still falls back to the placeholder', async () => {
    const res = await request(buildApp()).post('/api/admin/packages').send(body).expect(201);
    expect(res.body.package.image).toMatch(/placeholder|package-event/);
  });
});
