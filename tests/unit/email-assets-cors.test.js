/**
 * Helmet sends `Cross-Origin-Resource-Policy: same-origin` on everything, which
 * stops browser-based webmail from loading the logos embedded in our emails.
 * `/assets/email` opts out; nothing else should.
 */

'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');

const { configureHelmet } = require('../../middleware/security');
const { emailAssetsCrossOrigin } = require('../../middleware/emailAssets');

function buildApp() {
  const app = express();
  app.use(configureHelmet(true));
  app.use('/assets/email', emailAssetsCrossOrigin());
  app.use(express.static(path.join(__dirname, '../../public')));
  return app;
}

describe('email asset Cross-Origin-Resource-Policy', () => {
  const app = buildApp();

  it('allows the email logos to be embedded cross-origin', async () => {
    const res = await request(app).get('/assets/email/eventflow-wordmark.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('leaves the rest of /assets on the same-origin default', async () => {
    const res = await request(app).get('/assets/brand/eventflow-wordmark.svg');
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('server.js mounts the email assets middleware before static files', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('registers it ahead of express.static', () => {
    const mount = src.indexOf("app.use('/assets/email', emailAssetsCrossOrigin())");
    const staticMount = src.indexOf("app.use(express.static(path.join(__dirname, 'public')))");
    expect(mount).toBeGreaterThan(-1);
    expect(staticMount).toBeGreaterThan(mount);
  });
});
