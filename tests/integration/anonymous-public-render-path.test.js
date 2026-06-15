const request = require('supertest');
const app = require('../../server');

describe('anonymous public HTML render path', () => {
  test('GET / is template-rendered, sanitized, and not public-cacheable', async () => {
    const res = await request(app).get('/').expect(200);

    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers.expires).toBe('0');
    expect(res.headers.vary).toMatch(/Cookie/i);
    expect(res.text).toContain('eventflow-anonymous-sanitizer: active');
    expect(res.text).toMatch(/Find UK Event Suppliers|Plan Your Event/i);
    expect(res.text).toMatch(/Suppliers opening in stages|Browse UK event suppliers/i);
    expect(res.text).toContain('id="ef-dashboard-link"');
    expect(res.text).toContain('id="ef-bottom-dashboard"');
    expect(res.text).not.toMatch(
      /What Our Customers Say|Sarah\s*&(?:amp;)?\s*Tom|James Wilson|Emma Davies/i
    );
    expect(res.text).not.toMatch(/All suppliers are verified and vetted|Version:\s*loading/i);
    expect(res.text).not.toMatch(
      /Mark all as read|View all|>\s*Dashboard\s*<|Log out|Notifications/
    );
    expect(res.text).not.toMatch(/Verified Suppliers|Packages Available|Customer Reviews/i);
    expect(res.text).not.toMatch(/View All Marketplace Items/i);
  });

  test('GET /start is template-rendered and keeps planner preload without stale auth/version text', async () => {
    const res = await request(app).get('/start').expect(200);

    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(res.headers.vary).toMatch(/Cookie/i);
    expect(res.text).toContain('eventflow-anonymous-sanitizer: active');
    expect(res.text).toContain('id="wizard-preload"');
    expect(res.text).not.toMatch(
      /Version:\s*loading|Mark all as read|View all|>\s*Dashboard\s*<|Log out|Notifications/
    );
  });

  test('GET /public-calendar removes anonymous admin and publisher controls', async () => {
    const res = await request(app).get('/public-calendar').expect(200);

    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.text).not.toMatch(/Calendar publishing requests|Approve suitable suppliers/i);
    expect(res.text).not.toMatch(/>\s*Add Event\s*</i);
    expect(res.text).not.toMatch(/>\s*Publish Event\s*</i);
    expect(res.text).not.toMatch(/draft|pending_review|rejected management/i);
  });

  test('GET /guides hides contradictory dynamic loading and empty states but keeps no-JS guide list', async () => {
    const res = await request(app).get('/guides').expect(200);

    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.text).not.toMatch(/Loading guides|No guides found/i);
    expect(res.text).toContain('guides-nojs-list');
    expect(res.text).toContain('/articles/event-planning-checklist-guide');
  });

  test('production public routes are rendered by the actual server.js app before raw static HTML', async () => {
    const routes = [
      '/',
      '/start',
      '/public-calendar',
      '/guides',
      '/suppliers',
      '/pricing',
      '/marketplace',
      '/for-suppliers',
      '/legal',
      '/contact',
      '/auth',
      '/verify',
    ];
    const banned = [
      /Dashboard\s+Log out/i,
      /Mark all as read/i,
      /Version:\s*loading/i,
      /What Our Customers Say/i,
      /Sarah\s*&(?:amp;)?\s*Tom/i,
      /James Wilson/i,
      /Emma Davies/i,
      /All suppliers are verified and vetted/i,
      /Explore our full range of verified UK suppliers/i,
    ];

    for (const route of routes) {
      const res = await request(app).get(route).set('Accept', 'text/html').expect(200);

      expect(res.headers['x-eventflow-template-renderer']).toBe('active');
      expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
      expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
      expect(res.headers.vary).toMatch(/Cookie/i);

      for (const pattern of banned) {
        expect(res.text).not.toMatch(pattern);
      }
    }
  });

  test('production /public-calendar anonymous render strips status, publisher, and admin controls', async () => {
    const res = await request(app).get('/public-calendar').set('Accept', 'text/html').expect(200);
    const banned = [
      /pending_review/i,
      /rejected/i,
      /Calendar publishing requests/i,
      /Approve suitable suppliers/i,
      /admin override/i,
      /Shared Events Calendar publishing enabled/i,
      /\bAdd Event\b/i,
      /\bPublish Event\b/i,
    ];

    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    for (const pattern of banned) {
      expect(res.text).not.toMatch(pattern);
    }
  });

  test('GET /index.html remains canonical redirect to sanitized homepage route', async () => {
    const redirect = await request(app).get('/index.html').expect(301);
    expect(redirect.headers.location).toBe('/');

    const res = await request(app).get(redirect.headers.location).expect(200);
    expect(res.headers['x-eventflow-template-renderer']).toBe('active');
    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.text).not.toMatch(/What Our Customers Say|Version:\s*loading|Mark all as read/i);
  });
});
