'use strict';

const express = require('express');
const request = require('supertest');
const createPublicListingSeoRouter = require('../../routes/public-listing-seo');
const {
  buildPublicEventSlug,
  buildPublicPackageSlug,
} = require('../../services/publicListingSeo.service');

const supplier = {
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Events',
  category: 'Photography',
  location: 'Cardiff',
  description_short: 'Natural, documentary-style wedding photography across South Wales.',
};
const pkg = {
  id: 'pkg-1',
  supplierId: supplier.id,
  approved: true,
  title: 'Full Day Wedding Photography',
  slug: 'full-day-wedding-photography-pkg001',
  description: 'Natural wedding photography across South Wales.',
  price: '£1,250',
  image: '/uploads/package.jpg',
  updatedAt: '2026-07-19T12:00:00.000Z',
};
const futureEvent = {
  id: 'pce_12345678',
  slug: 'cardiff-wedding-fair-12345678',
  title: 'Cardiff Wedding Fair',
  description: 'Meet local wedding suppliers in Cardiff.',
  status: 'published',
  startDate: '2030-06-15T10:00:00.000Z',
  endDate: '2030-06-15T16:00:00.000Z',
  venueName: 'Cardiff City Hall',
  townCity: 'Cardiff',
  postcode: 'CF10 3ND',
  organiserName: supplier.name,
  priceType: 'free',
  featuredImageUrl: '/uploads/wedding-fair.jpg',
};

function createApp(overrides = {}, options = {}) {
  const data = {
    packages: [pkg],
    suppliers: [supplier],
    users: [{ id: 'user-1' }],
    public_calendar_events: [futureEvent],
    ...overrides,
  };
  const dbUnified = {
    read: jest.fn(async collection => data[collection] || []),
  };
  const logger = { error: jest.fn() };
  const app = express();
  app.use(
    createPublicListingSeoRouter({
      dbUnified,
      logger,
      baseUrl: 'https://event-flow.co.uk',
      ...options,
    })
  );
  app.use((_req, res) => res.status(404).send('Not found'));
  return { app, dbUnified, logger };
}

describe('public package and event SEO routes', () => {
  test('redirects legacy package query URLs to the clean canonical path', async () => {
    const { app } = createApp();
    const response = await request(app)
      .get('/package.html?id=pkg-1&utm_source=google&preview=false&junk=value')
      .expect(301);

    expect(response.headers.location).toBe(
      `/package/${buildPublicPackageSlug(pkg)}?utm_source=google`
    );
  });

  test('serves package metadata and Service JSON-LD without changing the page body', async () => {
    const { app } = createApp();
    const slug = buildPublicPackageSlug(pkg);
    const response = await request(app).get(`/package/${slug}`).expect(200);

    expect(response.headers['x-robots-tag']).toBe('index, follow, max-image-preview:large');
    expect(response.headers['cache-control']).toContain('s-maxage=300');
    expect(response.text).toContain(
      `<link rel="canonical" href="https://event-flow.co.uk/package/${slug}">`
    );
    expect(response.text).toContain('<meta name="ef-public-package-id" content="pkg-1">');
    expect(response.text).toContain('id="package-structured-data"');
    expect(response.text).toContain('id="package-content"');

    const jsonLd = JSON.parse(
      response.text.match(
        /<script type="application\/ld\+json" id="package-structured-data">([\s\S]*?)<\/script>/
      )[1]
    );
    expect(jsonLd['@type']).toBe('Service');
    expect(jsonLd.offers.price).toBe(1250);
  });

  test('canonicalizes package aliases and strips non-campaign query values', async () => {
    const { app } = createApp();
    const response = await request(app)
      .get('/package/pkg-1?utm_campaign=summer&debugImages=1')
      .expect(301);
    expect(response.headers.location).toBe(
      `/package/${buildPublicPackageSlug(pkg)}?utm_campaign=summer`
    );
  });

  test('does not index unapproved or orphaned package pages', async () => {
    const { app } = createApp({ packages: [{ ...pkg, approved: false }] });
    const response = await request(app).get(`/package/${pkg.slug}`).expect(404);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('serves qualifying public events with server-rendered Event JSON-LD', async () => {
    const { app } = createApp();
    const slug = buildPublicEventSlug(futureEvent);
    const response = await request(app).get(`/events/${slug}`).expect(200);

    expect(response.headers['x-robots-tag']).toContain('index');
    expect(response.text).toContain(
      `<link rel="canonical" href="https://event-flow.co.uk/events/${slug}">`
    );
    expect(response.text).toContain('<meta name="ef-public-event-id" content="pce_12345678">');
    expect(response.text).toContain('id="event-structured-data"');
    expect(response.text).toContain('id="event-panel"');

    const jsonLd = JSON.parse(
      response.text.match(
        /<script type="application\/ld\+json" id="event-structured-data">([\s\S]*?)<\/script>/
      )[1]
    );
    expect(jsonLd['@type']).toBe('Event');
    expect(jsonLd.startDate).toBe(futureEvent.startDate);
  });

  test('keeps old public events available but removes them from indexing', async () => {
    const pastEvent = {
      ...futureEvent,
      id: 'pce_past1234',
      slug: 'past-event-past1234',
      startDate: '2020-06-15T10:00:00.000Z',
      endDate: '2020-06-15T16:00:00.000Z',
    };
    const { app } = createApp({ public_calendar_events: [pastEvent] });
    const response = await request(app).get(`/events/${pastEvent.slug}`).expect(200);

    expect(response.headers['x-robots-tag']).toBe('noindex, follow');
    expect(response.text).toContain('<meta name="robots" content="noindex,follow">');
    expect(response.text).not.toContain('id="event-structured-data"');
  });

  test('does not expose draft or private events', async () => {
    const { app } = createApp({
      public_calendar_events: [{ ...futureEvent, status: 'draft', isPrivate: true }],
    });
    const response = await request(app).get(`/events/${futureEvent.slug}`).expect(404);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('does not apply the shared API request bucket to indexable HTML pages', async () => {
    const { app, dbUnified } = createApp();
    const packageSlug = buildPublicPackageSlug(pkg);
    const eventSlug = buildPublicEventSlug(futureEvent);

    for (let index = 0; index < 105; index += 1) {
      await request(app).get(`/package/${packageSlug}`).expect(200);
      await request(app).get(`/events/${eventSlug}`).expect(200);
    }

    expect(dbUnified.read).toHaveBeenCalledTimes(4);
  });
});
