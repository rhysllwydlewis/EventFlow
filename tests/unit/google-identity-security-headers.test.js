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
});
