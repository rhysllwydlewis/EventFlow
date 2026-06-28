'use strict';

const express = require('express');
const router = express.Router();

const HTML = '<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>EventFlow Homepage V2 Preview</title></head><body><h1>Plan Better. Celebrate More.</h1></body></html>';

router.get('/home-v2-preview', (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.type('html').send(HTML);
});

module.exports = router;
