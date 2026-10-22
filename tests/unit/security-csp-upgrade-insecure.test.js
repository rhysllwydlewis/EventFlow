'use strict';

/**
 * The site tells browsers to upgrade insecure subresources (a production CSP directive). The isolated
 * backend browser suite serves plain http on loopback, where WebKit would upgrade everything to
 * https and fail to load the page, so only that suite (NODE_ENV=test with E2E_MODE=full) leaves the
 * directive out. Everywhere else it stays.
 */

const express = require('express');
const request = require('supertest');

describe('Content-Security-Policy upgrade-insecure-requests', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, E2E_MODE: process.env.E2E_MODE };

  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.E2E_MODE === undefined) {
      delete process.env.E2E_MODE;
    } else {
      process.env.E2E_MODE = saved.E2E_MODE;
    }
    jest.resetModules();
  });

  async function policyFor(env) {
    Object.assign(process.env, env);
    jest.resetModules();
    const { configureHelmet } = require('../../middleware/security');
    const app = express();
    app.use(configureHelmet(env.NODE_ENV === 'production'));
    app.get('/', (_req, res) => res.send('ok'));
    const res = await request(app).get('/');
    return String(res.headers['content-security-policy'] || '');
  }

  it('is sent in production', async () => {
    expect(await policyFor({ NODE_ENV: 'production', E2E_MODE: 'static' })).toContain(
      'upgrade-insecure-requests'
    );
  });

  it('is sent in ordinary tests and development', async () => {
    expect(await policyFor({ NODE_ENV: 'test', E2E_MODE: 'static' })).toContain(
      'upgrade-insecure-requests'
    );
    expect(await policyFor({ NODE_ENV: 'development', E2E_MODE: 'full' })).toContain(
      'upgrade-insecure-requests'
    );
  });

  it('is left out only in the isolated backend browser suite', async () => {
    expect(await policyFor({ NODE_ENV: 'test', E2E_MODE: 'full' })).not.toContain(
      'upgrade-insecure-requests'
    );
  });
});
