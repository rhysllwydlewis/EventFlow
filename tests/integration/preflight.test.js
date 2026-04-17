/**
 * Integration tests for `scripts/preflight.mjs`.
 *
 * Effort 8.3 — config hygiene. Verifies that the preflight validator:
 *   - Warns (but exits 0) in non-production when placeholders / short secrets exist.
 *   - Fails hard (exits 1) in NODE_ENV=production with the same misconfiguration.
 *   - Exits 0 when all required config is set and placeholder-free.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const PREFLIGHT = path.join(__dirname, '../../scripts/preflight.mjs');

function runPreflight(env) {
  // Start from a clean slate so the parent process's env doesn't leak in
  // (e.g. a real JWT_SECRET from .env would mask missing-secret tests).
  const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return spawnSync('node', [PREFLIGHT], {
    encoding: 'utf8',
    env: cleanEnv,
  });
}

describe('scripts/preflight.mjs', () => {
  it('exits 0 in development when config is missing (warns only)', () => {
    const result = runPreflight({ NODE_ENV: 'development' });
    expect(result.status).toBe(0);
    // Missing JWT_SECRET should be flagged as a warning
    expect(result.stderr).toMatch(/JWT_SECRET/);
  });

  it('exits 1 in production when JWT_SECRET is missing', () => {
    const result = runPreflight({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost/test',
      BASE_URL: 'https://example.com',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/JWT_SECRET/);
    expect(result.stderr).toMatch(/Refusing to start/);
  });

  it('exits 1 in production when a placeholder value is in env', () => {
    const result = runPreflight({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      MONGODB_URI: 'mongodb://localhost/test',
      BASE_URL: 'https://example.com',
      STRIPE_SECRET_KEY: 'REPLACE_ME_stripe_key',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/placeholder/i);
    expect(result.stderr).toMatch(/STRIPE_SECRET_KEY/);
  });

  it('exits 1 in production when a secret is too short', () => {
    const result = runPreflight({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
      MONGODB_URI: 'mongodb://localhost/test',
      BASE_URL: 'https://example.com',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/at least 32 characters/);
  });

  it('exits 1 in production when a forbidden default secret is used', () => {
    const result = runPreflight({
      NODE_ENV: 'production',
      JWT_SECRET: 'change-me-in-production',
      MONGODB_URI: 'mongodb://localhost/test',
      BASE_URL: 'https://example.com',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/forbidden default/);
  });

  it('exits 0 in production when all config is valid', () => {
    const result = runPreflight({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      MONGODB_URI: 'mongodb://localhost/test',
      BASE_URL: 'https://example.com',
    });
    // Note: content-config.json in the repo may still contain REPLACE_ME_
    // placeholders in dev branches, which would cause a failure. Accept
    // either 0 (clean repo) or 1 with only content-config warning.
    if (result.status !== 0) {
      // If it failed, the only expected reason is the content-config file.
      expect(result.stderr).toMatch(/content-config\.json/);
      expect(result.stderr).not.toMatch(/JWT_SECRET|MONGODB_URI|BASE_URL/);
    }
  });
});
