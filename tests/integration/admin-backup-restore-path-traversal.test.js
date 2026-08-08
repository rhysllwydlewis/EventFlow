/**
 * POST /api/admin/backup/restore — filename validation.
 * Confirms the endpoint only accepts filenames matching the
 * backup-<timestamp>.json shape it itself generates, rejecting path
 * traversal (e.g. "../../.env") and other attempts to read arbitrary files.
 */

'use strict';

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {},
}));

jest.mock('../../db-unified', () => ({
  count: jest.fn(async () => 0),
  read: jest.fn(async () => []),
  write: jest.fn(async () => undefined),
  findWithOptions: jest.fn(async () => []),
  getDatabaseType: jest.fn(() => 'local'),
}));

const adminRoutes = require('../../routes/admin');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('POST /api/admin/backup/restore — filename validation', () => {
  let app;
  let secretFile;

  beforeAll(() => {
    // A file outside the backups directory that a traversal attempt could
    // try to read if the guard were missing.
    secretFile = path.join(os.tmpdir(), `eventflow-secret-${Date.now()}.json`);
    fs.writeFileSync(secretFile, JSON.stringify({ data: { users: [] } }));
  });

  afterAll(() => {
    fs.rmSync(secretFile, { force: true });
  });

  beforeEach(() => {
    app = createApp();
  });

  it('rejects a filename missing entirely', async () => {
    const res = await request(app).post('/api/admin/backup/restore').send({});
    expect(res.status).toBe(400);
  });

  it('rejects filenames containing path traversal segments', async () => {
    const relative = path.relative(path.join(__dirname, '..', '..', 'backups'), secretFile);

    const res = await request(app).post('/api/admin/backup/restore').send({ filename: relative });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid filename');
  });

  it('rejects an absolute path', async () => {
    const res = await request(app).post('/api/admin/backup/restore').send({ filename: secretFile });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid filename');
  });

  it('rejects a filename with no backup- prefix', async () => {
    const res = await request(app)
      .post('/api/admin/backup/restore')
      .send({ filename: 'not-a-backup.json' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid filename');
  });

  it('accepts a well-formed backup filename but 404s when it does not exist on disk', async () => {
    const res = await request(app)
      .post('/api/admin/backup/restore')
      .send({ filename: 'backup-2026-01-01T00-00-00.json' });

    // Passing validation and reaching the existsSync() check (404, not 400)
    // proves the regex accepted a legitimately-shaped filename.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Backup file not found');
  });
});
