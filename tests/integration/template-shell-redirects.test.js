/**
 * /location and /category-directory are the raw template shells that
 * routes/locations.js and routes/category-directory.js fill with real data for
 * /locations/* and /categories/*. Requested bare they have no title, no
 * canonical and almost no content, so a crawler reports them as soft 404s or
 * uncanonicalised duplicates. They must 301 to the hub pages instead.
 * Checked against the real app.
 */

'use strict';

const request = require('supertest');
const app = require('../../server');

describe('bare template shells redirect to their hub pages', () => {
  test.each([
    ['/location', '/locations'],
    ['/location.html', '/locations'],
    ['/category-directory', '/categories'],
    ['/category-directory.html', '/categories'],
  ])('%s -> %s (301)', async (from, to) => {
    const res = await request(app).get(from).redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });
});
