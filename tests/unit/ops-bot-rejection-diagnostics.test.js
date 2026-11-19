/**
 * "Invalid Ops Assistant signature" alone cannot tell an operator whether the
 * secret differs between environments (#1757), the signed path differs, or the
 * body differs (#1679). The response must stay generic, but the server log has to
 * say enough to tell those apart, and must never contain anything that helps
 * forge a signature.
 */

'use strict';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => mockLogger);

const { spawnSync } = require('child_process');
const path = require('path');
const { signatureFor, verifyOpsBotHmac } = require('../../middleware/opsBotHmac');
const { secretFingerprint } = require('../../utils/opsBotSecretFingerprint');

const SECRET = 's'.repeat(48);
const PATH_ONLY = '/internal/ops-bot/content-review-tasks';

function mockResponse() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function request({ headers, body = {}, method = 'GET', originalUrl = PATH_ONLY }) {
  return {
    body,
    method,
    originalUrl,
    get: name => headers[name.toLowerCase()] || '',
  };
}

function sign(secret, { method = 'GET', path: signedPath = PATH_ONLY, body = '{}', ts } = {}) {
  const timestamp = ts === undefined ? String(Date.now()) : ts;
  return {
    'x-eventflow-bot-timestamp': timestamp,
    'x-eventflow-bot-signature': `sha256=${signatureFor(secret, timestamp, method, signedPath, body)}`,
  };
}

function lastWarning() {
  const calls = mockLogger.warn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

describe('Ops Assistant rejection diagnostics', () => {
  const originalEnabled = process.env.OPS_ASSISTANT_ENABLED;
  const originalSecret = process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;

  beforeEach(() => {
    mockLogger.warn.mockClear();
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.OPS_ASSISTANT_ENABLED = originalEnabled;
    if (originalEnabled === undefined) {
      delete process.env.OPS_ASSISTANT_ENABLED;
    }
    if (originalSecret === undefined) {
      delete process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    } else {
      process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = originalSecret;
    }
  });

  it('does not log anything for a valid request', () => {
    const next = jest.fn();
    verifyOpsBotHmac(request({ headers: sign(SECRET) }), mockResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('keeps the response generic while logging a signature mismatch with the server secret fingerprint', () => {
    const res = mockResponse();
    verifyOpsBotHmac(
      request({ headers: sign('x'.repeat(48)) }), // signed with a different secret
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Ops Assistant signature' });

    const [message, details] = lastWarning();
    expect(message).toBe('[OPS-BOT] Rejected request');
    expect(details).toMatchObject({
      reason: 'signature_mismatch',
      method: 'GET',
      path: PATH_ONLY,
      hasQuery: false,
      signatureHeader: 'sha256-prefixed',
      signatureWellFormed: true,
      bodyBytes: 2,
      secretFingerprint: secretFingerprint(SECRET),
    });
  });

  it('shows that a query string is the difference when the client signed the path only', () => {
    const res = mockResponse();
    verifyOpsBotHmac(
      request({
        headers: sign(SECRET, { path: PATH_ONLY }), // client signed the bare path…
        originalUrl: `${PATH_ONLY}?limit=20`, // …but the server signs originalUrl
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(401);
    const [, details] = lastWarning();
    expect(details.reason).toBe('signature_mismatch');
    expect(details.hasQuery).toBe(true);
    // The query string itself is not logged, only that there was one.
    expect(JSON.stringify(details)).not.toContain('limit=20');
    expect(details.path).toBe(PATH_ONLY);
  });

  it('distinguishes a bare signature, a malformed signature and a missing signature', () => {
    const bare = sign(SECRET, { path: '/elsewhere' });
    bare['x-eventflow-bot-signature'] = bare['x-eventflow-bot-signature'].slice(7);
    verifyOpsBotHmac(request({ headers: bare }), mockResponse(), jest.fn());
    expect(lastWarning()[1]).toMatchObject({ signatureHeader: 'bare', signatureWellFormed: true });

    const malformed = { ...sign(SECRET), 'x-eventflow-bot-signature': 'sha256=deadbeef' };
    verifyOpsBotHmac(request({ headers: malformed }), mockResponse(), jest.fn());
    expect(lastWarning()[1]).toMatchObject({
      signatureHeader: 'sha256-prefixed',
      signatureWellFormed: false,
    });

    const missing = { 'x-eventflow-bot-timestamp': String(Date.now()) };
    verifyOpsBotHmac(request({ headers: missing }), mockResponse(), jest.fn());
    expect(lastWarning()[1]).toMatchObject({ signatureHeader: 'missing' });
  });

  it('logs an expired timestamp with the skew, and never the secret or any signature', () => {
    const res = mockResponse();
    const stale = String(Date.now() - 60 * 60 * 1000);
    const headers = sign(SECRET, { ts: stale });
    verifyOpsBotHmac(request({ headers }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    const [, details] = lastWarning();
    expect(details.reason).toBe('timestamp_invalid_or_expired');
    expect(details.skewMs).toBeGreaterThan(30 * 60 * 1000);

    const logged = JSON.stringify(mockLogger.warn.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(headers['x-eventflow-bot-signature'].slice(7));
  });

  it('never logs the expected signature on a mismatch', () => {
    const headers = sign('x'.repeat(48));
    const expected = signatureFor(
      SECRET,
      headers['x-eventflow-bot-timestamp'],
      'GET',
      PATH_ONLY,
      '{}'
    );
    verifyOpsBotHmac(request({ headers }), mockResponse(), jest.fn());
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(expected);
  });
});

describe('secretFingerprint', () => {
  it('is 8 lowercase hex characters and stable for the same secret', () => {
    expect(secretFingerprint(SECRET)).toMatch(/^[a-f0-9]{8}$/);
    expect(secretFingerprint(SECRET)).toBe(secretFingerprint(SECRET));
  });

  it('differs between different secrets', () => {
    expect(secretFingerprint('a'.repeat(48))).not.toBe(secretFingerprint('b'.repeat(48)));
  });

  it('is not the secret, a prefix of it, or derived trivially from it', () => {
    const fingerprint = secretFingerprint(SECRET);
    expect(SECRET).not.toContain(fingerprint);
    expect(fingerprint).toHaveLength(8);
  });
});

describe('scripts/ops-bot-secret-fingerprint.js', () => {
  const script = path.join(__dirname, '../../scripts/ops-bot-secret-fingerprint.js');
  const run = secret => {
    const env = { ...process.env };
    delete env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    if (secret !== undefined) {
      env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
    }
    return spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  };

  it('prints the same fingerprint the server logs, and never the secret', () => {
    const result = run(SECRET);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(secretFingerprint(SECRET));
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stderr).not.toContain(SECRET);
  });

  it('exits non-zero when the secret is missing or too short', () => {
    expect(run(undefined).status).toBe(1);
    expect(run('too-short').status).toBe(1);
  });
});
