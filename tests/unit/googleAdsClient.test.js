/**
 * Unit tests for the Google Ads API client (keyword-idea generation only).
 * global.fetch is mocked — no real network calls, no real credentials.
 */

'use strict';

const REQUIRED_ENV = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_API_VERSION',
];

function clearEnv() {
  REQUIRED_ENV.forEach(key => delete process.env[key]);
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
}

function setEnv() {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
  process.env.GOOGLE_ADS_CLIENT_ID = 'client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_ADS_REFRESH_TOKEN = 'refresh-token';
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
  process.env.GOOGLE_ADS_API_VERSION = 'v99';
}

describe('googleAdsClient', () => {
  let googleAdsClient;

  beforeEach(() => {
    jest.resetModules();
    clearEnv();
    googleAdsClient = require('../../services/googleAdsClient');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearEnv();
    jest.restoreAllMocks();
  });

  describe('isConfigured / missingConfigMessage', () => {
    it('is false when nothing is set, and lists every missing var', () => {
      expect(googleAdsClient.isConfigured()).toBe(false);
      const message = googleAdsClient.missingConfigMessage();
      REQUIRED_ENV.forEach(key => expect(message).toContain(key));
    });

    it('is true once every required var is set', () => {
      setEnv();
      expect(googleAdsClient.isConfigured()).toBe(true);
    });
  });

  describe('generateKeywordIdeas', () => {
    it('throws without calling fetch when not configured', async () => {
      await expect(googleAdsClient.generateKeywordIdeas(['venues'])).rejects.toThrow(
        /not configured/i
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns [] for an empty seed list without calling fetch', async () => {
      setEnv();
      expect(await googleAdsClient.generateKeywordIdeas([])).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('exchanges the refresh token then requests keyword ideas, mapping the response', async () => {
      setEnv();
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'access-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                text: 'wedding venue london',
                keywordIdeaMetrics: { avgMonthlySearches: '1000', competition: 'HIGH' },
              },
              { text: 'no metrics keyword' },
            ],
          }),
        });

      const ideas = await googleAdsClient.generateKeywordIdeas(['venues']);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [tokenCall, keywordCall] = global.fetch.mock.calls;
      expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token');
      expect(keywordCall[0]).toContain('customers/1234567890:generateKeywordIdeas');
      expect(keywordCall[1].headers['developer-token']).toBe('dev-token');
      expect(keywordCall[1].headers.Authorization).toBe('Bearer access-123');
      expect(keywordCall[1].headers['login-customer-id']).toBeUndefined();

      expect(ideas).toEqual([
        { keyword: 'wedding venue london', avgMonthlySearches: 1000, competition: 'HIGH' },
        { keyword: 'no metrics keyword', avgMonthlySearches: null, competition: null },
      ]);
    });

    it('sends login-customer-id when a manager account is configured', async () => {
      setEnv();
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '999-888-7777';
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

      await googleAdsClient.generateKeywordIdeas(['venues']);
      const [, keywordCall] = global.fetch.mock.calls;
      expect(keywordCall[1].headers['login-customer-id']).toBe('9998887777');
    });

    it('throws with the token error when the OAuth exchange fails', async () => {
      setEnv();
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Token has expired' }),
      });

      await expect(googleAdsClient.generateKeywordIdeas(['venues'])).rejects.toThrow(
        /Token has expired/
      );
    });

    it('throws with the API error when generateKeywordIdeas itself fails', async () => {
      setEnv();
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => [{ error: { message: 'PERMISSION_DENIED' } }],
        });

      await expect(googleAdsClient.generateKeywordIdeas(['venues'])).rejects.toThrow(
        /PERMISSION_DENIED/
      );
    });
  });
});
