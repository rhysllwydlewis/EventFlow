/**
 * Links that outgoing emails point at must resolve. These each 404'd or went
 * nowhere while the templates looked fine, so they are checked against the real
 * app rather than a list of strings.
 */

'use strict';

const request = require('supertest');
const app = require('../../server');

describe('email link targets resolve on the real app', () => {
  test('/newsletter/confirm (newsletter-confirm email) forwards the token to the API handler', async () => {
    const res = await request(app).get('/newsletter/confirm?token=abc123').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/api/newsletter/confirm?token=abc123');
  });

  test('/newsletter/confirm without a query still forwards cleanly', async () => {
    const res = await request(app).get('/newsletter/confirm').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/api/newsletter/confirm');
  });

  test('/support (support-ticket-reply email) sends signed-out visitors to log in, not a 404', async () => {
    const res = await request(app).get('/support').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\?redirect=%2Fsupport/);
  });

  test.each(['/settings', '/supplier/subscription', '/dashboard/supplier', '/dashboard/customer'])(
    '%s does not 404',
    async route => {
      const res = await request(app).get(route).redirects(0);
      expect(res.status).not.toBe(404);
    }
  );
});

describe('ticket emails link to a page that exists', () => {
  const fs = require('fs');
  const path = require('path');

  test.each(['routes/tickets.js', 'routes/admin.js'])(
    '%s never emails a /tickets/<id> URL',
    file => {
      const src = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
      expect(src).not.toMatch(/\/tickets\/\$\{encodeURIComponent\(/);
    }
  );
});
