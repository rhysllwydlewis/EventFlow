/**
 * Unit tests for the Google Search Console client (service-account JWT
 * flow). jsonwebtoken.sign and global.fetch are mocked — no real network
 * calls, no real credentials.
 */

'use strict';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed.jwt.assertion'),
}));

function clearEnv() {
  delete process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY;
  delete process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY;
}

function setEnv() {
  process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL = 'svc@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY =
    '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
  process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY = 'sc-domain:event-flow.co.uk';
}

describe('googleSearchConsole.service', () => {
  let gsc;
  let jwt;

  beforeEach(() => {
    jest.resetModules();
    clearEnv();
    gsc = require('../../services/googleSearchConsole.service');
    jwt = require('jsonwebtoken');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearEnv();
    jest.restoreAllMocks();
  });

  it('isConfigured is false until all three env vars are set', () => {
    expect(gsc.isConfigured()).toBe(false);
    setEnv();
    expect(gsc.isConfigured()).toBe(true);
  });

  it('throws without calling fetch when not configured', async () => {
    await expect(
      gsc.fetchQueryPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' })
    ).rejects.toThrow(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exchanges the service-account JWT for a token, then fetches and normalises rows', async () => {
    setEnv();
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-abc' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            { keys: ['wedding venue'], clicks: 5, impressions: 100, ctr: 0.05, position: 8.2 },
            { keys: ['event flow'], clicks: 20, impressions: 40, ctr: 0.5, position: 1.1 },
          ],
        }),
      });

    const rows = await gsc.fetchQueryPerformance({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ iss: 'svc@example.iam.gserviceaccount.com' }),
      expect.stringContaining('BEGIN PRIVATE KEY'),
      { algorithm: 'RS256' }
    );
    const [tokenCall, queryCall] = global.fetch.mock.calls;
    expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
    expect(queryCall[0]).toContain('sites/sc-domain%3Aevent-flow.co.uk/searchAnalytics/query');
    expect(rows).toEqual([
      { query: 'wedding venue', clicks: 5, impressions: 100, ctr: 0.05, position: 8.2 },
      { query: 'event flow', clicks: 20, impressions: 40, ctr: 0.5, position: 1.1 },
    ]);
  });

  it('pages through results until a short page ends the loop', async () => {
    setEnv();
    const fullPage = Array.from({ length: 3 }, (_, i) => ({
      keys: [`query ${i}`],
      clicks: 1,
      impressions: 1,
      ctr: 1,
      position: 1,
    }));
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: fullPage }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });

    const rows = await gsc.fetchQueryPerformance({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      rowLimit: 3,
    });

    expect(rows).toHaveLength(3);
    // rowLimit reached exactly on the first page, so it stops without a second query call.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws with the token error when the JWT exchange fails', async () => {
    setEnv();
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'invalid_grant', error_description: 'JWT expired' }),
    });

    await expect(
      gsc.fetchQueryPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' })
    ).rejects.toThrow(/JWT expired/);
  });

  it('throws with the API error when the search analytics query fails', async () => {
    setEnv();
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'PERMISSION_DENIED' } }),
      });

    await expect(
      gsc.fetchQueryPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' })
    ).rejects.toThrow(/PERMISSION_DENIED/);
  });
});
