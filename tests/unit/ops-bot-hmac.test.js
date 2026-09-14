'use strict';

const hmac = require('../../middleware/opsBotHmac');

const { MAX_SKEW_MS, signatureFor, verifyOpsBotHmac } = hmac;

function payload(overrides = {}) {
  return {
    id: 'article-review-2026-09',
    status: 'completed',
    outcome: 'no_change',
    ...overrides,
  };
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const DEFAULT_METHOD = 'PATCH';
const DEFAULT_PATH = '/internal/ops-bot/content-review-tasks/article-review-2026-09';

function signedHeaders(
  body,
  secret,
  timestamp = String(Date.now()),
  prefix = true,
  method = DEFAULT_METHOD,
  path = DEFAULT_PATH
) {
  const signature = signatureFor(secret, timestamp, method, path, JSON.stringify(body));
  return {
    'x-eventflow-bot-timestamp': timestamp,
    'x-eventflow-bot-signature': prefix ? `sha256=${signature}` : signature,
  };
}

function headerRequest(body, headers, method = DEFAULT_METHOD, path = DEFAULT_PATH) {
  return { body, method, originalUrl: path, get: name => headers[name.toLowerCase()] || '' };
}

describe('Ops Assistant HMAC middleware', () => {
  const originalEnabled = process.env.OPS_ASSISTANT_ENABLED;
  const originalSecret = process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.OPS_ASSISTANT_ENABLED;
    } else {
      process.env.OPS_ASSISTANT_ENABLED = originalEnabled;
    }
    if (originalSecret === undefined) {
      delete process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    } else {
      process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = originalSecret;
    }
  });

  it('accepts a fresh correctly signed request with the sha256 prefix', () => {
    const secret = 'a'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    const req = headerRequest(body, headers);
    const res = mockResponse();
    const next = jest.fn();

    verifyOpsBotHmac(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a valid signature without the optional sha256 prefix', () => {
    const secret = 'b'.repeat(48);
    const body = payload();
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, String(Date.now()), false);
    const req = headerRequest(body, headers);
    const next = jest.fn();

    verifyOpsBotHmac(req, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails closed while the Ops Assistant is disabled', () => {
    process.env.OPS_ASSISTANT_ENABLED = 'false';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = 'a'.repeat(48);
    const req = { body: payload(), get: () => '' };
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Ops Assistant is disabled' });
  });

  it('fails closed when the shared secret is missing or too short', () => {
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = 'too-short';
    const req = { body: payload(), get: () => '' };
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ops Assistant secret is not configured',
    });
  });

  it('rejects a missing timestamp', () => {
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = 'c'.repeat(48);
    const headers = { 'x-eventflow-bot-signature': '0'.repeat(64) };
    const req = headerRequest(payload(), headers);
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an expired timestamp', () => {
    const secret = 'd'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now() - MAX_SKEW_MS - 1);
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    const req = headerRequest(body, headers);
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Ops Assistant request timestamp is invalid or expired',
    });
  });

  it('rejects malformed and incorrect signatures', () => {
    const secret = 'e'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;

    for (const signature of ['not-hex', '0'.repeat(64)]) {
      const headers = {
        'x-eventflow-bot-timestamp': timestamp,
        'x-eventflow-bot-signature': signature,
      };
      const req = headerRequest(body, headers);
      const res = mockResponse();

      verifyOpsBotHmac(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Ops Assistant signature' });
    }
  });

  it('rejects a validly signed request replayed against a different path', () => {
    const secret = 'f'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    // Same signed headers and body, but replayed against a different task id.
    const req = headerRequest(
      body,
      headers,
      DEFAULT_METHOD,
      '/internal/ops-bot/content-review-tasks/a-different-task'
    );
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Ops Assistant signature' });
  });

  it('rejects a validly signed request replayed with a different method', () => {
    const secret = 'g'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    // Same signed headers and body, but replayed with a different HTTP method.
    const req = headerRequest(body, headers, 'DELETE', DEFAULT_PATH);
    const res = mockResponse();

    verifyOpsBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Ops Assistant signature' });
  });
});
