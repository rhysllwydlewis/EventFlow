/**
 * /location, /category-directory and /event-detail are the raw template shells
 * behind /locations/*, /categories/* and /events/:slug. Requested bare they have
 * no real content (and /event-detail canonicalises to a URL that 404s), so a
 * crawler reports them as soft 404s or uncanonicalised duplicates. They must
 * 301 to the pages a visitor actually wants instead. Checked against the real
 * app.
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
    ['/event-detail', '/public-calendar'],
    ['/event-detail.html', '/public-calendar'],
  ])('%s -> %s (301)', async (from, to) => {
    const res = await request(app).get(from).redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });
});
