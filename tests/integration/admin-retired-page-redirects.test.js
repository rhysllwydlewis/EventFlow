/**
 * Admin pages that were merged into tabs of another page must still open: each old address
 * redirects (302) to the tab that replaced it and keeps whatever was in the query, so a saved
 * bookmark or an old notification link lands on the right list. Checked against the real app.
 */

'use strict';

const request = require('supertest');
const app = require('../../server');

const MERGES = [
  ['/admin-campaigns', '/admin-emails', 'campaigns'],
  ['/admin-campaigns.html', '/admin-emails', 'campaigns'],
  ['/admin-email-previews', '/admin-emails', 'templates'],
  ['/admin-email-previews.html', '/admin-emails', 'templates'],
  ['/admin/email-previews', '/admin-emails', 'templates'],
  ['/admin-external-contacts', '/admin-tickets', 'external'],
  ['/admin-external-contacts.html', '/admin-tickets', 'external'],
  ['/admin-cashout-requests', '/admin-partners', 'cashouts'],
  ['/admin-cashout-requests.html', '/admin-partners', 'cashouts'],
  ['/admin-partner-campaign-report', '/admin-partners', 'report'],
  ['/admin-partner-campaign-report.html', '/admin-partners', 'report'],
];

describe('retired admin pages redirect to the tab that replaced them', () => {
  test.each(MERGES)('%s -> %s?tab=%s', async (from, to, tab) => {
    const res = await request(app).get(from).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${to}?tab=${tab}`);
  });

  test.each(MERGES)('%s keeps its query string', async (from, to, tab) => {
    const res = await request(app).get(`${from}?request=abc123&status=new`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${to}?request=abc123&status=new&tab=${tab}`);
  });
});

describe('older retired pages and .html addresses', () => {
  test.each([
    ['/admin-pexels', '/admin-media'],
    ['/admin-pexels.html', '/admin-media'],
  ])('%s -> %s, keeping the query', async (from, to) => {
    const plain = await request(app).get(from).redirects(0);
    expect(plain.status).toBe(302);
    expect(plain.headers.location).toBe(to);
    const withQuery = await request(app).get(`${from}?q=sky`).redirects(0);
    expect(withQuery.headers.location).toBe(`${to}?q=sky`);
  });

  test.each(['/admin-content-dates', '/admin-content-dates.html'])(
    '%s -> the Legal dates tab of Content',
    async from => {
      const plain = await request(app).get(from).redirects(0);
      expect(plain.status).toBe(302);
      expect(plain.headers.location).toBe('/admin-content?tab=legalDates');
      const withQuery = await request(app).get(`${from}?x=1`).redirects(0);
      expect(withQuery.headers.location).toBe('/admin-content?x=1&tab=legalDates');
    }
  );

  test('a current admin page asked for as .html goes to its clean address, keeping the query', async () => {
    const res = await request(app).get('/admin-users.html?page=2').redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/admin-users?page=2');
  });
});
