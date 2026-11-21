/**
 * scripts/serve-static.js compresses responses the way production does.
 *
 * It is the server Lighthouse, the visual tests and the browser tests run against. Without
 * compression it sent every page and script uncompressed (about 4.1 MB for the homepage against
 * about 1.8 MB from the real site), so the homepage's Lighthouse score measured a page visitors do
 * not get: about 57 here, and often under the 0.5 threshold on CI, against about 66 once it
 * compresses like production. These tests start the real server and look at what it sends.
 *
 * @jest-environment node
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 4300 + Math.floor(Math.random() * 400);
let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, '../../scripts/serve-static.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('static server did not start')), 20000);
    server.stdout.on('data', chunk => {
      if (String(chunk).includes('Static server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', code => reject(new Error(`static server exited early (${code})`)));
  });
}

/** One request, with the body left as the server sent it (no automatic decoding). */
function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: urlPath, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ headers: res.headers, size: Buffer.concat(chunks).length }));
      })
      .on('error', reject);
  });
}

beforeAll(startServer, 30000);
afterAll(() => {
  if (server) {
    server.removeAllListeners('exit');
    server.kill();
  }
});

describe('the static test server', () => {
  test('compresses the homepage with Brotli when the browser accepts it', async () => {
    const plain = await get('/', { 'Accept-Encoding': 'identity' });
    const packed = await get('/', { 'Accept-Encoding': 'br' });

    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(packed.headers['content-encoding']).toBe('br');
    expect(packed.headers.vary).toMatch(/Accept-Encoding/i);
    expect(packed.size).toBeLessThan(plain.size / 2);
  });

  test('falls back to gzip', async () => {
    const response = await get('/', { 'Accept-Encoding': 'gzip' });

    expect(response.headers['content-encoding']).toBe('gzip');
  });

  test('compresses scripts and stylesheets, which are most of the bytes', async () => {
    for (const asset of ['/assets/js/app.js', '/assets/css/styles.css']) {
      const response = await get(asset, { 'Accept-Encoding': 'br' });
      expect(response.headers['content-encoding']).toBe('br');
    }
  });

  test('does not compress images, which are already compressed', async () => {
    const response = await get('/assets/images/collage-venue-640.webp', {
      'Accept-Encoding': 'br',
    });

    expect(response.headers['content-encoding']).toBeUndefined();
  });

  test('sends the same thing production does when compression is declined', async () => {
    // The production middleware's own opt-out header (middleware/compression.js)
    const response = await get('/', { 'Accept-Encoding': 'br', 'x-no-compression': '1' });

    expect(response.headers['content-encoding']).toBeUndefined();
  });
});
