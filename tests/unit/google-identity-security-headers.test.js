'use strict';

const express = require('express');
const request = require('supertest');
const { configureHelmet } = require('../../middleware/security');

describe('Google Identity Services security headers', () => {
  it('allows Google sign-in popups to keep their opener relationship', async () => {
    const app = express();
    app.use(configureHelmet(true));
    app.get('/auth', (_req, res) => res.status(200).send('ok'));

    const response = await request(app).get('/auth').expect(200);

    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });

  it('allows the resources used by the consent-gated Google Ads tag', async () => {
    const app = express();
    app.use(configureHelmet(true));
    app.get('/', (_req, res) => res.status(200).send('ok'));

    const response = await request(app).get('/').expect(200);
    const policy = response.headers['content-security-policy'];

    expect(policy).toContain('https://pagead2.googlesyndication.com');
    expect(policy).toContain('https://www.googleadservices.com');
    expect(policy).toContain('https://googleads.g.doubleclick.net');
    expect(policy).toContain('https://ad.doubleclick.net');
    expect(policy).toContain('https://www.google.com');
  });
});
