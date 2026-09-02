/**
 * Google Ads API client — keyword-idea generation only (no campaign
 * management). Talks to the REST interface directly with native fetch;
 * there is no official Node.js client library (see Google's own
 * Libraries and samples page — Java/.NET/PHP/Python/Ruby/Perl only), and
 * adding the large unofficial `google-ads-api` package for one endpoint
 * isn't worth the dependency weight.
 *
 * Setup — see .env.example for the full walkthrough of where each value
 * comes from and where to paste it. In short:
 *  1. developer token: Google Ads UI → Tools & Settings → API Center
 *     (needs a manager/MCC account; starts as "Test" access, apply for
 *     "Basic" access to read real account data — Google reviews this).
 *  2. OAuth client id/secret: Google Cloud Console → APIs & Services →
 *     Credentials → OAuth client ID (Desktop app), with the Google Ads
 *     API enabled on that project.
 *  3. refresh token: generated once via an OAuth consent flow granting
 *     the https://www.googleapis.com/auth/adwords scope.
 *  4. customer id: the 10-digit Google Ads account id (top-right of the
 *     Google Ads UI), digits only, no dashes.
 *
 * The API version is required, not defaulted: Google sunsets Ads API
 * versions on a roughly-yearly cycle, and silently pinning a guessed
 * version here would break without warning when it's retired. Check
 * https://developers.google.com/google-ads/api/docs/release-notes for
 * the current version and set GOOGLE_ADS_API_VERSION to it (e.g. "v21").
 */

'use strict';

const logger = require('../utils/logger');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_ADS_API_VERSION
  );
}

function missingConfigMessage() {
  const required = [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_API_VERSION',
  ];
  const missing = required.filter(name => !process.env[name]);
  return `Google Ads API is not configured. Missing: ${missing.join(', ')}. Use the CSV import fallback until this is set up.`;
}

async function getAccessToken() {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Google Ads auth failed: ${data.error_description || data.error || response.status}`
    );
  }
  return data.access_token;
}

/**
 * Generates keyword ideas (with search volume estimates) for a list of
 * seed keywords, restricted to the UK, English.
 * @param {string[]} seedKeywords - up to ~20 phrases per call.
 * @returns {Promise<Array<{keyword:string, avgMonthlySearches:number|null, competition:string|null}>>}
 */
async function generateKeywordIdeas(seedKeywords) {
  if (!isConfigured()) {
    throw new Error(missingConfigMessage());
  }
  if (!Array.isArray(seedKeywords) || seedKeywords.length === 0) {
    return [];
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION;
  const accessToken = await getAccessToken();

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  // Set when the developer token belongs to a manager (MCC) account overseeing customerId.
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, '');
  }

  const response = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}:generateKeywordIdeas`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        keywordSeed: { keywords: seedKeywords },
        geoTargetConstants: ['geoTargetConstants/2826'], // United Kingdom
        language: 'languageConstants/1000', // English
        keywordPlanNetwork: 'GOOGLE_SEARCH',
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message = Array.isArray(data) ? data[0]?.error?.message : data.error?.message;
    throw new Error(`Google Ads generateKeywordIdeas failed: ${message || response.status}`);
  }

  const results = data.results || [];
  const ideas = results.map(result => ({
    keyword: result.text,
    avgMonthlySearches: result.keywordIdeaMetrics?.avgMonthlySearches
      ? Number(result.keywordIdeaMetrics.avgMonthlySearches)
      : null,
    competition: result.keywordIdeaMetrics?.competition || null,
  }));

  logger.info(
    `Google Ads: generated ${ideas.length} keyword ideas from ${seedKeywords.length} seeds`
  );
  return ideas;
}

module.exports = { isConfigured, missingConfigMessage, generateKeywordIdeas };
