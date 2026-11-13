/**
 * Stylesheets under /assets are served minified by middleware/css-minify.js. Checked
 * against the real app, so the order of the surrounding middleware matters: cache
 * headers must still be the static ones, and the body must still be compressed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const request = require('supertest');
const app = require('../../server');

const SHEET = '/assets/css/styles.css';
const onDisk = fs.readFileSync(path.resolve(__dirname, '../../public', `.${SHEET}`), 'utf8');

describe('stylesheets from the real app', () => {
  test('are minified: smaller, no comments, same CSS', async () => {
    const res = await request(app).get(`${SHEET}?v=18.5.2`).set('Accept-Encoding', 'identity');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.text.length).toBeLessThan(onDisk.length * 0.85);
    expect(res.text).not.toMatch(/\/\*(?!!)/);
    // a rule near the top of the source is still there
    const firstRule = onDisk
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/([^{}]+)\{/)[1]
      .trim();
    expect(res.text.replace(/\s+/g, '')).toContain(firstRule.replace(/\s+/g, ''));
  });

  test('keep the one-week static cache header', async () => {
    const res = await request(app).get(SHEET).set('Accept-Encoding', 'identity');
    expect(res.headers['cache-control']).toBe('public, max-age=604800, must-revalidate');
  });

  test('are still Brotli-compressed on the way out', async () => {
    const res = await request(app)
      .get(SHEET)
      .set('Accept-Encoding', 'br')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.headers['content-encoding']).toBe('br');
    const css = zlib.brotliDecompressSync(res.body).toString('utf8');
    expect(css.length).toBeLessThan(onDisk.length * 0.85);
    expect(css).not.toMatch(/\/\*(?!!)/);
  });

  test('revalidate with a 304', async () => {
    const first = await request(app).get(SHEET).set('Accept-Encoding', 'identity');
    const again = await request(app)
      .get(SHEET)
      .set('Accept-Encoding', 'identity')
      .set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
  });

  test('a stylesheet that does not exist is still a 404, and scripts are untouched', async () => {
    expect((await request(app).get('/assets/css/no-such-file.css')).status).toBe(404);
    const js = await request(app).get('/assets/js/app.js').set('Accept-Encoding', 'identity');
    expect(js.status).toBe(200);
    expect(js.text).toBe(
      fs.readFileSync(path.resolve(__dirname, '../../public/assets/js/app.js'), 'utf8')
    );
  });
});
