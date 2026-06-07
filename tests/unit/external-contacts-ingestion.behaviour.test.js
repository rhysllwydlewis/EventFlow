'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../services/notifyAdmins.service', () => ({
  notifyAdmins: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../db-unified', () => ({
  find: jest.fn().mockResolvedValue([]),
  insertOne: jest.fn(async (_collection, doc) => doc),
}));

const dbUnified = require('../../db-unified');
const logger = require('../../utils/logger');
const { notifyAdmins } = require('../../services/notifyAdmins.service');
const route = require('../../routes/integrations-external-contacts');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/integrations/external-contacts', route);
  return app;
}

const validPayload = {
  name: 'Pat Person',
  email: 'pat@example.com',
  subject: 'Question',
  message: 'Can you help?',
  source: 'attacker-controlled',
  pageUrl: 'https://vexi.co.uk/contact',
};

describe('External contacts ingestion behaviour', () => {
  let originalSecret;
  let originalSources;
  let app;

  beforeAll(() => {
    originalSecret = process.env.EXTERNAL_CONTACTS_INGEST_SECRET;
    originalSources = process.env.EXTERNAL_CONTACTS_ALLOWED_SOURCES;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXTERNAL_CONTACTS_INGEST_SECRET = 'test-secret';
    process.env.EXTERNAL_CONTACTS_ALLOWED_SOURCES = 'vexi,chlo';
    dbUnified.find.mockResolvedValue([]);
    dbUnified.insertOne.mockImplementation(async (_collection, doc) => doc);
    notifyAdmins.mockResolvedValue(undefined);
    app = buildApp();
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.EXTERNAL_CONTACTS_INGEST_SECRET;
    } else {
      process.env.EXTERNAL_CONTACTS_INGEST_SECRET = originalSecret;
    }
    if (originalSources === undefined) {
      delete process.env.EXTERNAL_CONTACTS_ALLOWED_SOURCES;
    } else {
      process.env.EXTERNAL_CONTACTS_ALLOWED_SOURCES = originalSources;
    }
  });

  test('stores the verified source header and ignores any source in the body', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'test-secret')
      .set('X-EventFlow-Source', 'ChLo')
      .set('X-Forwarded-For', '203.0.113.42')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
    const [, record] = dbUnified.insertOne.mock.calls[0];
    expect(record).toEqual(
      expect.objectContaining({
        source: 'chlo',
        sourceLabel: 'Chlo',
        name: 'Pat Person',
        email: 'pat@example.com',
        pageUrl: 'https://vexi.co.uk/contact',
      })
    );
    expect(record).not.toHaveProperty('rawIp');
    expect(record.ipHash).toMatch(/^[a-f0-9]{16}$/);
  });

  test('fails closed when the shared secret is missing or invalid', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Source', 'vexi')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: false, error: 'Unauthorised' });
  });

  test('treats same-character-length but different-byte-length secrets as invalid without throwing', async () => {
    process.env.EXTERNAL_CONTACTS_INGEST_SECRET = 'a';

    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'é')
      .set('X-EventFlow-Source', 'vexi')
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'Unauthorised' });
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  test('rejects invalid sources before storing the contact', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'test-secret')
      .set('X-EventFlow-Source', 'unknown@example.com')
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[ext-contacts] unknown source', {
      source: 'unknownexamplecom',
    });
  });

  test('rejects missing or malformed required fields cleanly', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'test-secret')
      .set('X-EventFlow-Source', 'vexi')
      .send({ name: '', email: 'not-an-email', message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name is required');
    expect(res.body.error).toContain('email is invalid');
    expect(res.body.error).toContain('message is required');
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  test('suppresses duplicates within the dedupe window', async () => {
    dbUnified.find.mockResolvedValue([{ id: 'existing-contact-id' }]);

    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'test-secret')
      .set('X-EventFlow-Source', 'vexi')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 'existing-contact-id', duplicate: true });
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  test('does not store unsafe pageUrl values as clickable admin links', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/external-contacts')
      .set('X-EventFlow-Integration-Secret', 'test-secret')
      .set('X-EventFlow-Source', 'vexi')
      .send({ ...validPayload, pageUrl: 'javascript:alert(1)' });

    expect(res.status).toBe(201);
    const [, record] = dbUnified.insertOne.mock.calls[0];
    expect(record.pageUrl).toBeNull();
  });
});
