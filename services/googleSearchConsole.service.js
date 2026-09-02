/**
 * Google Search Console client — service-account JWT flow, no extra
 * dependency (uses the jsonwebtoken package already used for app auth,
 * and Node 22's built-in fetch).
 *
 * Setup (see .env.example for the full walkthrough):
 *  1. Google Cloud Console → create/select a project → enable the
 *     "Google Search Console API".
 *  2. Create a service account, generate a JSON key.
 *  3. In Search Console (search.google.com/search-console) → Settings →
 *     Users and permissions → add the service account's email as a
 *     Full user on the event-flow.co.uk property.
 *  4. Set GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL and
 *     GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY from the JSON key file.
 */

'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL &&
    process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY &&
    process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY
  );
}

function getPrivateKey() {
  // Railway/most env-var UIs store multi-line values with literal "\n" — restore real newlines.
  return String(process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    getPrivateKey(),
    { algorithm: 'RS256' }
  );

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Google Search Console auth failed: ${data.error_description || data.error || response.status}`
    );
  }
  return data.access_token;
}

/**
 * Fetches query-level performance for the configured property.
 * @returns {Promise<Array<{query:string, clicks:number, impressions:number, ctr:number, position:number}>>}
 */
async function fetchQueryPerformance({ startDate, endDate, rowLimit = 25000 }) {
  if (!isConfigured()) {
    throw new Error(
      'Google Search Console is not configured (missing GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL / _PRIVATE_KEY / _PROPERTY).'
    );
  }

  const property = process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY;
  const accessToken = await getAccessToken();

  const rows = [];
  let startRow = 0;
  const pageSize = Math.min(rowLimit, 25000);

  for (;;) {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: pageSize,
          startRow,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        `Google Search Console query failed: ${data.error?.message || response.status}`
      );
    }

    const batch = data.rows || [];
    for (const row of batch) {
      rows.push({
        query: row.keys[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
    }

    if (batch.length < pageSize || rows.length >= rowLimit) {
      break;
    }
    startRow += pageSize;
  }

  logger.info(
    `Google Search Console: fetched ${rows.length} query rows for ${property} (${startDate} to ${endDate})`
  );
  return rows;
}

module.exports = { isConfigured, fetchQueryPerformance };
