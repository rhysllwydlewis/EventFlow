/**
 * Empty/invalid-inventory SEO index gating (SEO-005) for /suppliers filter
 * combinations and the /public-calendar hub, served as static HTML shells.
 */

'use strict';

jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return { publicReadLimiter: passthrough, apiLimiter: passthrough };
});

const mockSearchSuppliers = jest.fn();
jest.mock('../../services/rankedSupplierSearch.service', () => ({
  searchSuppliers: (...args) => mockSearchSuppliers(...args),
}));

let mockEvents = [];
jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'public_calendar_events' ? mockEvents : [])),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/public-index-gate');

function buildApp() {
  const app = express();
  app.use(router);
  app.use((req, res) => res.status(200).send('shell'));
  return app;
}

beforeEach(() => {
  mockSearchSuppliers.mockReset();
  mockEvents = [];
});

describe('/suppliers filter-combination gating', () => {
  it('leaves the bare /suppliers page alone (no filters, no search call)', async () => {
    const res = await request(buildApp()).get('/suppliers');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(mockSearchSuppliers).not.toHaveBeenCalled();
  });

  it('marks a zero-result filter combination noindex,follow', async () => {
    mockSearchSuppliers.mockResolvedValue({ pagination: { total: 0 } });
    const res = await request(buildApp()).get('/suppliers?category=nonexistent-category');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('leaves a filter combination with real results indexable', async () => {
    mockSearchSuppliers.mockResolvedValue({ pagination: { total: 12 } });
    const res = await request(buildApp()).get('/suppliers?category=photography');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('does not hard-block an empty/invalid combination — the shell still renders 200', async () => {
    mockSearchSuppliers.mockResolvedValue({ pagination: { total: 0 } });
    const res = await request(buildApp()).get('/suppliers?location=nowhere-real');
    expect(res.status).toBe(200);
    expect(res.text).toBe('shell');
  });

  it('treats a blank query value as no filter at all', async () => {
    const res = await request(buildApp()).get('/suppliers?category=');
    expect(mockSearchSuppliers).not.toHaveBeenCalled();
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('fails open (stays indexable) when the search lookup itself errors', async () => {
    mockSearchSuppliers.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).get('/suppliers?category=photography');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});

describe('/public-calendar empty-state gating', () => {
  const futureEvent = {
    id: 'pce_1',
    title: 'Future Fair',
    status: 'published',
    startDate: '2035-01-01T10:00:00.000Z',
    endDate: '2035-01-01T16:00:00.000Z',
  };

  it('marks the calendar noindex,follow when it holds no indexable events', async () => {
    mockEvents = [];
    const res = await request(buildApp()).get('/public-calendar');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('leaves the calendar indexable once a real future public event exists', async () => {
    mockEvents = [futureEvent];
    const res = await request(buildApp()).get('/public-calendar');
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });

  it('does not count a private/draft event towards the threshold', async () => {
    mockEvents = [
      { ...futureEvent, id: 'pce_2', status: 'draft' },
      { ...futureEvent, id: 'pce_3', isPrivate: true },
    ];
    const res = await request(buildApp()).get('/public-calendar');
    expect(res.headers['x-robots-tag']).toBe('noindex, follow');
  });

  it('does not hard-block the empty calendar — the shell still renders 200', async () => {
    mockEvents = [];
    const res = await request(buildApp()).get('/public-calendar');
    expect(res.status).toBe(200);
    expect(res.text).toBe('shell');
  });
});
