'use strict';

const { _private } = require('../../middleware/rateLimits');

describe('crawler-safe public calendar read classification', () => {
  function request(method, url) {
    return { method, originalUrl: url, url };
  }

  test.each([
    '/api/v1/public-calendar/events',
    '/api/public-calendar/events?limit=50',
    '/api/v1/public-calendar/events/cardiff-wedding-fair',
    '/api/public-calendar/events/pce_123/ics',
  ])('classifies %s as a public read', url => {
    expect(_private.isPublicCalendarReadRequest(request('GET', url))).toBe(true);
  });

  test.each([
    ['POST', '/api/v1/public-calendar/events'],
    ['GET', '/api/v1/public-calendar/events/saved'],
    ['GET', '/api/v1/public-calendar/events/pce_123/save'],
    ['GET', '/api/v1/admin/events'],
  ])('keeps %s %s outside the crawler-safe bucket', (method, url) => {
    expect(_private.isPublicCalendarReadRequest(request(method, url))).toBe(false);
  });
});
