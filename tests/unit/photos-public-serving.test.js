'use strict';

const fs = require('fs');
const path = require('path');

const PHOTOS_ROUTE = path.join(__dirname, '../../routes/photos.js');

describe('public /api/photos serving contract', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(PHOTOS_ROUTE, 'utf8');
  });

  it('keeps GET /api/photos/:id publicly readable without auth middleware', () => {
    const marker = "router.get('/photos/:id', apiLimiter, async (req, res) =>";
    const start = content.indexOf(marker);
    const end = content.indexOf('module.exports = router', start);
    const block = content.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(block).not.toContain('applyAuthRequired');
    expect(block).toContain("res.setHeader('Content-Type', photo.mimeType || 'image/jpeg')");
    expect(block).toContain("res.setHeader('Cache-Control', 'public, max-age=31536000')");
  });
});
