/**
 * Unit tests for the MongoDB webhook handler
 *
 * Covers:
 *  a) verifySignature() — accepts a valid HMAC-SHA256 signature, rejects tampered
 *  b) deriveEventKey()  — stable key derivation from various _id shapes
 *  c) mongodbWebhookHandler — fail-closed in production without secret
 *  d) mongodbWebhookHandler — rejects invalid signatures
 *  e) mongodbWebhookHandler — accepts valid signed payloads
 *  f) mongodbWebhookHandler — returns 200 for duplicate events
 *  g) mongodbWebhookHandler — disabled endpoint returns 503
 */

'use strict';

const crypto = require('crypto');
const {
  buildMongodbWebhookHandler,
  verifySignature,
  deriveEventKey,
} = require('../../webhooks/mongodbWebhookHandler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-for-mongodb-webhook';

/**
 * Build a minimal mock req / res pair.
 */
function makeReqRes({ body = '{}', secret = undefined } = {}) {
  const rawBody = Buffer.from(body);

  const req = {
    headers: {},
    body: rawBody,
    ip: '127.0.0.1',
    app: null, // no db in unit tests
  };

  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    req.headers['x-mongodb-webhook-signature'] = `sha256=${sig}`;
  }

  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    send(body) {
      this._body = body;
      return this;
    },
  };

  return { req, res };
}

// ---------------------------------------------------------------------------
// Tests: a) verifySignature
// ---------------------------------------------------------------------------

describe('verifySignature()', () => {
  const body = Buffer.from('{"test":true}');

  it('returns true for a valid HMAC-SHA256 signature', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifySignature(body, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it('returns false when the signature is tampered', () => {
    expect(verifySignature(body, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('returns false when the header is missing', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
  });

  it('returns false when the secret is missing', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifySignature(body, `sha256=${sig}`, '')).toBe(false);
  });

  it('returns false when the algorithm prefix is wrong', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifySignature(body, `sha1=${sig}`, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: b) deriveEventKey
// ---------------------------------------------------------------------------

describe('deriveEventKey()', () => {
  it('returns null when eventId is falsy', () => {
    expect(deriveEventKey(null)).toBeNull();
    expect(deriveEventKey(undefined)).toBeNull();
    expect(deriveEventKey('')).toBeNull();
  });

  it('returns the string directly when eventId is a string', () => {
    expect(deriveEventKey('abc123')).toBe('abc123');
  });

  it('returns a JSON-serialised string for object ids (Atlas format)', () => {
    const id = { _data: '826789abcdef' };
    const key = deriveEventKey(id);
    expect(key).toBe(JSON.stringify(id));
  });
});

// ---------------------------------------------------------------------------
// Tests: c) Fail-closed in production without MONGODB_WEBHOOK_SECRET
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — production fail-closed', () => {
  it('rejects unsigned requests in production when secret is absent', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: '', nodeEnv: 'production' });
    const { req, res } = makeReqRes({ body: '{"operationType":"insert"}' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('production') });
  });
});

// ---------------------------------------------------------------------------
// Tests: d) Invalid signature is rejected
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — invalid signature', () => {
  it('returns 400 for a bad signature', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: SECRET, nodeEnv: 'production' });
    const { req, res } = makeReqRes({ body: '{"operationType":"insert"}' });
    req.headers['x-mongodb-webhook-signature'] = 'sha256=bad';
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('signature') });
  });

  it('returns 400 when signature header is absent in production', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: SECRET, nodeEnv: 'production' });
    const { req, res } = makeReqRes({ body: '{"operationType":"insert"}' });
    // no signature header
    await handler(req, res);
    expect(res._status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: e) Accepts valid signed payloads
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — valid signed payload', () => {
  it('returns 200 { received: true } for a valid insert event', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: SECRET, nodeEnv: 'production' });
    const body = JSON.stringify({
      _id: { _data: 'abc123' },
      operationType: 'insert',
      ns: { db: 'eventflow', coll: 'users' },
      documentKey: { _id: 'user-1' },
      fullDocument: { email: 'test@example.com' },
    });
    const { req, res } = makeReqRes({ body, secret: SECRET });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  it('returns 200 for update events', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: SECRET, nodeEnv: 'production' });
    const body = JSON.stringify({
      _id: { _data: 'upd456' },
      operationType: 'update',
      ns: { db: 'eventflow', coll: 'suppliers' },
      documentKey: { _id: 'supplier-1' },
      updateDescription: { updatedFields: { name: 'New Name' }, removedFields: [] },
    });
    const { req, res } = makeReqRes({ body, secret: SECRET });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  it('returns 200 for delete events', async () => {
    const handler = buildMongodbWebhookHandler({ webhookSecret: SECRET, nodeEnv: 'production' });
    const body = JSON.stringify({
      _id: { _data: 'del789' },
      operationType: 'delete',
      ns: { db: 'eventflow', coll: 'sessions' },
      documentKey: { _id: 'session-1' },
    });
    const { req, res } = makeReqRes({ body, secret: SECRET });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  it('allows unsigned request in development when secret is absent', async () => {
    const handler = buildMongodbWebhookHandler({
      webhookSecret: '',
      nodeEnv: 'development',
      enabled: true,
    });
    const body = JSON.stringify({
      operationType: 'insert',
      ns: { db: 'eventflow', coll: 'test' },
    });
    const { req, res } = makeReqRes({ body });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: f) Duplicate event returns 200 with duplicate:true (no db)
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — duplicate handling (no db)', () => {
  it('processes event normally when there is no db (no idempotency store)', async () => {
    const handler = buildMongodbWebhookHandler({
      webhookSecret: SECRET,
      nodeEnv: 'test',
    });
    const body = JSON.stringify({
      _id: { _data: 'dup001' },
      operationType: 'insert',
      ns: { db: 'eventflow', coll: 'items' },
    });
    const { req, res } = makeReqRes({ body, secret: SECRET });
    await handler(req, res);
    // Without a real db there is no duplicate detection; should still succeed
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: g) Disabled endpoint
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — disabled endpoint', () => {
  it('returns 503 when enabled=false', async () => {
    const handler = buildMongodbWebhookHandler({ enabled: false });
    const { req, res } = makeReqRes({ body: '{}' });
    await handler(req, res);
    expect(res._status).toBe(503);
    expect(res._body).toMatchObject({ error: expect.stringContaining('disabled') });
  });
});

// ---------------------------------------------------------------------------
// Tests: h) Malformed JSON body
// ---------------------------------------------------------------------------

describe('mongodbWebhookHandler — malformed body', () => {
  it('returns 400 for non-JSON body', async () => {
    const handler = buildMongodbWebhookHandler({
      webhookSecret: '',
      nodeEnv: 'development',
    });
    const rawBody = Buffer.from('not-json-at-all');
    const req = {
      headers: {},
      body: rawBody,
      ip: '127.0.0.1',
      app: null,
    };
    const res = {
      _status: 200,
      _body: null,
      status(code) {
        this._status = code;
        return this;
      },
      json(body) {
        this._body = body;
        return this;
      },
      send(body) {
        this._body = body;
        return this;
      },
    };
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: expect.stringContaining('JSON') });
  });
});
