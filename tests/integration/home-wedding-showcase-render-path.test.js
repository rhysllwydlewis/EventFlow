'use strict';

const request = require('supertest');
const app = require('../../server');

describe('homepage wedding showcase render path', () => {
  test('GET / serves the section after template rendering and anonymous sanitising', async () => {
    const res = await request(app).get('/').expect(200);

    expect(res.headers['x-eventflow-public-sanitizer']).toBe('anonymous-v2');
    expect(res.text).toContain('id="wedding-website-rsvp"');
    expect(res.text).toContain('Your wedding website, RSVPs and seating plan, all in one place');
    expect(res.text).toContain('Create your free wedding website');
    expect(res.text).toContain('/articles/wedding-website-on-eventflow-guide');
    expect(res.text).toContain('home-wedding-showcase.css');
    expect(res.text).toContain('/assets/js/pages/home-wedding-showcase.js');
    expect(res.text).toContain('"@type": "FAQPage"');
    // the sanitizer removes these strings; the section must not depend on them
    expect(res.text).not.toMatch(/Customer Reviews|Verified Suppliers/i);
  });
});
