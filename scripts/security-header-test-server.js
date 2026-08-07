'use strict';

const express = require('express');
const { configureHelmet, configurePermissionsPolicy } = require('../middleware/security');

const app = express();
const port = Number(process.env.PORT || 3500);
const isProduction = process.env.SECURITY_HEADERS_MODE === 'production';

app.disable('x-powered-by');
app.use(configureHelmet(isProduction));
app.use(configurePermissionsPolicy());
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/api/config', (_req, res) => res.status(200).json({ mode: 'security-header-test' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(port, '127.0.0.1', () => {
  console.log(`Security header test server listening on ${port}`);
});
