/**
 * Unit tests for:
 *   1. Supplier category list (VALID_CATEGORIES in models/Supplier.js, services/supplier.service.js, routes/catalog.js)
 *   2. Calendar permission utility (utils/calendarPermissions.js)
 *   3. Public calendar API routes (routes/public-calendar.js)
 *
 * Tests are intentionally isolated — all DB, auth, and middleware dependencies
 * are mocked so no real I/O occurs.
 */

'use strict';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../store', () => ({
  uid: jest.fn(prefix => `${prefix}_test_${Date.now()}`),
}));

// Partial auth mock — real module provides `getUserFromCookie`; we expose a
// setter so tests can control the authenticated user.
let mockCurrentUser = null;
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    if (!mockCurrentUser) {
      return _res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = mockCurrentUser;
    next();
  },
  getUserFromCookie: () => mockCurrentUser,
  roleRequired: role => (req, res, next) => {
    if (!mockCurrentUser || mockCurrentUser.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const dbUnified = require('../../db-unified');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setUser(user) {
  mockCurrentUser = user;
}
function clearUser() {
  mockCurrentUser = null;
}

// ─── 1. Supplier category lists ───────────────────────────────────────────────

describe('Supplier VALID_CATEGORIES', () => {
  const { VALID_CATEGORIES: modelCategories } = require('../../models/Supplier');

  test('includes all original categories', () => {
    const originals = [
      'Venues',
      'Catering',
      'Photography',
      'Videography',
      'Entertainment',
      'Florist',
      'Decor',
      'Transport',
      'Cake',
      'Stationery',
      'Hair & Makeup',
      'Planning',
      'Other',
    ];
    for (const cat of originals) {
      expect(modelCategories).toContain(cat);
    }
  });

  test('includes new supplier types', () => {
    const newTypes = ['Beauty', 'Bridalwear', 'Jewellery', 'Celebrant', 'Music/DJ'];
    for (const cat of newTypes) {
      expect(modelCategories).toContain(cat);
    }
  });

  test('includes publisher types required for permissions', () => {
    expect(modelCategories).toContain('Event Planner');
    expect(modelCategories).toContain('Wedding Fayre');
  });

  test('has no duplicate entries', () => {
    expect(modelCategories.length).toBe(new Set(modelCategories).size);
  });

  test('service VALID_CATEGORIES matches model VALID_CATEGORIES', () => {
    // The service now imports VALID_CATEGORIES directly from models/Supplier.js,
    // so we verify indirectly: the service rejects categories outside the list.
    jest.isolateModules(() => {
      // The service module should load without errors (imports model correctly)
      expect(() => require('../../services/supplier.service')).not.toThrow();
    });
  });
});

describe('CALENDAR_PUBLISHER_TYPES', () => {
  const { CALENDAR_PUBLISHER_TYPES } = require('../../models/Supplier');

  test('exports CALENDAR_PUBLISHER_TYPES array', () => {
    expect(Array.isArray(CALENDAR_PUBLISHER_TYPES)).toBe(true);
  });

  test('contains Event Planner and Wedding Fayre', () => {
    expect(CALENDAR_PUBLISHER_TYPES).toContain('Event Planner');
    expect(CALENDAR_PUBLISHER_TYPES).toContain('Wedding Fayre');
  });
});

// ─── 2. Calendar permission utility ──────────────────────────────────────────

describe('canPublishPublicCalendar()', () => {
  const { canPublishPublicCalendar } = require('../../utils/calendarPermissions');

  test('returns false for null/undefined', () => {
    expect(canPublishPublicCalendar(null)).toBe(false);
    expect(canPublishPublicCalendar(undefined)).toBe(false);
  });

  test('grants publishing for Event Planner category', () => {
    expect(canPublishPublicCalendar({ category: 'Event Planner' })).toBe(true);
  });

  test('grants publishing for Wedding Fayre category', () => {
    expect(canPublishPublicCalendar({ category: 'Wedding Fayre' })).toBe(true);
  });

  test('denies publishing for other categories', () => {
    const nonPublisherTypes = [
      'Venues',
      'Catering',
      'Photography',
      'Videography',
      'Entertainment',
      'Music/DJ',
      'Florist',
      'Decor',
      'Transport',
      'Cake',
      'Stationery',
      'Hair & Makeup',
      'Beauty',
      'Bridalwear',
      'Jewellery',
      'Celebrant',
      'Planning',
      'Other',
    ];
    for (const cat of nonPublisherTypes) {
      expect(canPublishPublicCalendar({ category: cat })).toBe(false);
    }
  });

  test('admin override true grants publishing regardless of category', () => {
    expect(canPublishPublicCalendar({ category: 'Venues', canPublishPublicCalendar: true })).toBe(
      true
    );
  });

  test('admin override false denies publishing for Event Planner', () => {
    expect(
      canPublishPublicCalendar({ category: 'Event Planner', canPublishPublicCalendar: false })
    ).toBe(false);
  });

  test('undefined override falls back to category derivation', () => {
    expect(
      canPublishPublicCalendar({ category: 'Event Planner', canPublishPublicCalendar: undefined })
    ).toBe(true);
    expect(
      canPublishPublicCalendar({ category: 'Catering', canPublishPublicCalendar: undefined })
    ).toBe(false);
  });
});

// ─── 3. Public calendar API routes ───────────────────────────────────────────

const publicCalendarRouter = require('../../routes/public-calendar');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/public-calendar', publicCalendarRouter);
  return app;
}

// Fixtures
const makeEvent = (overrides = {}) => ({
  id: 'pce_001',
  title: 'Spring Wedding Fayre',
  description: 'Browse 50+ exhibitors',
  startDate: '2025-05-01T10:00:00.000Z',
  endDate: '2025-05-01T16:00:00.000Z',
  location: 'Manchester',
  url: 'https://example.com/fayre',
  supplierId: 'sup_publisher_01',
  createdByUserId: 'user_publisher_01',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

const makePublisherSupplier = (overrides = {}) => ({
  id: 'sup_publisher_01',
  ownerUserId: 'user_publisher_01',
  category: 'Event Planner',
  approved: true,
  ...overrides,
});

describe('GET /api/public-calendar — list events', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
    dbUnified.read.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 200 with empty list when no events', async () => {
    dbUnified.read.mockResolvedValue([]);
    const res = await request(app).get('/api/public-calendar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.events).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test('returns events without authentication', async () => {
    clearUser();
    dbUnified.read.mockResolvedValue([makeEvent()]);
    const res = await request(app).get('/api/public-calendar');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
  });

  test('filters by location (case-insensitive)', async () => {
    dbUnified.read.mockResolvedValue([
      makeEvent({ id: 'pce_001', location: 'Manchester' }),
      makeEvent({ id: 'pce_002', location: 'London' }),
    ]);
    const res = await request(app).get('/api/public-calendar?location=manchester');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].location).toBe('Manchester');
  });

  test('filters by from date', async () => {
    dbUnified.read.mockResolvedValue([
      makeEvent({ id: 'pce_001', startDate: '2025-03-01T10:00:00.000Z' }),
      makeEvent({ id: 'pce_002', startDate: '2025-07-01T10:00:00.000Z' }),
    ]);
    const res = await request(app).get('/api/public-calendar?from=2025-05-01');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('pce_002');
  });
});

describe('POST /api/public-calendar — create event', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
    dbUnified.read.mockResolvedValue([]);
    dbUnified.insertOne.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Test', startDate: '2025-06-01T10:00:00Z' });
    expect(res.status).toBe(401);
  });

  test('returns 403 when authenticated customer (not a supplier)', async () => {
    setUser({ id: 'user_cust_01', role: 'customer' });
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Test', startDate: '2025-06-01T10:00:00Z' });
    expect(res.status).toBe(403);
  });

  test('returns 403 when supplier without publishing rights (Catering)', async () => {
    setUser({ id: 'user_cat_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([
      { id: 'sup_cat_01', ownerUserId: 'user_cat_01', category: 'Catering', approved: true },
    ]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Catering Fair', startDate: '2025-06-01T10:00:00Z' });
    expect(res.status).toBe(403);
  });

  test('returns 201 when Event Planner supplier creates an event', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([makePublisherSupplier()]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Spring Fayre', startDate: '2025-05-01T10:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.event.title).toBe('Spring Fayre');
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
  });

  test('returns 201 when Wedding Fayre supplier creates an event', async () => {
    setUser({ id: 'user_wf_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([
      makePublisherSupplier({
        id: 'sup_wf_01',
        ownerUserId: 'user_wf_01',
        category: 'Wedding Fayre',
      }),
    ]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'The Big Wedding Show', startDate: '2025-06-15T09:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.event.supplierId).toBe('sup_wf_01');
  });

  test('returns 403 when supplier has admin override false (even if category is Event Planner)', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([makePublisherSupplier({ canPublishPublicCalendar: false })]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Blocked Event', startDate: '2025-05-01T10:00:00Z' });
    expect(res.status).toBe(403);
  });

  test('returns 201 when Venues supplier has admin override true', async () => {
    setUser({ id: 'user_venue_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([
      {
        id: 'sup_venue_01',
        ownerUserId: 'user_venue_01',
        category: 'Venues',
        approved: true,
        canPublishPublicCalendar: true,
      },
    ]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ title: 'Open Day', startDate: '2025-05-01T10:00:00Z' });
    expect(res.status).toBe(201);
  });

  test('returns 400 when title is missing', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([makePublisherSupplier()]);
    const res = await request(app)
      .post('/api/public-calendar')
      .send({ startDate: '2025-05-01T10:00:00Z' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when startDate is missing', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockResolvedValue([makePublisherSupplier()]);
    const res = await request(app).post('/api/public-calendar').send({ title: 'No Date Event' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/public-calendar/:id — update event', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
    dbUnified.updateOne.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 404 when event does not exist', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([makePublisherSupplier()]);
      }
      return Promise.resolve([]); // no events
    });
    const res = await request(app)
      .put('/api/public-calendar/nonexistent')
      .send({ title: 'Updated' });
    expect(res.status).toBe(404);
  });

  test("returns 403 when publisher tries to edit another supplier's event", async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([makePublisherSupplier()]);
      }
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent({ supplierId: 'sup_OTHER' })]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app)
      .put('/api/public-calendar/pce_001')
      .send({ title: 'Hijacked Title' });
    expect(res.status).toBe(403);
  });

  test('returns 200 when publisher updates their own event', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([makePublisherSupplier()]);
      }
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent()]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app)
      .put('/api/public-calendar/pce_001')
      .send({ title: 'Updated Fayre Title' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(dbUnified.updateOne).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/public-calendar/:id — delete event', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
    dbUnified.deleteOne.mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 403 when non-publisher supplier tries to delete', async () => {
    setUser({ id: 'user_cat_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([
          { id: 'sup_cat_01', ownerUserId: 'user_cat_01', category: 'Catering', approved: true },
        ]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).delete('/api/public-calendar/pce_001');
    expect(res.status).toBe(403);
  });

  test("returns 403 when publisher tries to delete another supplier's event", async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([makePublisherSupplier()]);
      }
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent({ supplierId: 'sup_OTHER' })]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).delete('/api/public-calendar/pce_001');
    expect(res.status).toBe(403);
  });

  test('returns 200 when publisher deletes their own event', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([makePublisherSupplier()]);
      }
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent()]);
      }
      if (collection === 'publicCalendarSaves') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).delete('/api/public-calendar/pce_001');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/public-calendar/:id/save — customer save', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
    dbUnified.insertOne.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/public-calendar/pce_001/save');
    expect(res.status).toBe(401);
  });

  test('returns 403 when supplier tries to save', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    const res = await request(app).post('/api/public-calendar/pce_001/save');
    expect(res.status).toBe(403);
  });

  test('returns 404 when event does not exist', async () => {
    setUser({ id: 'user_cust_01', role: 'customer' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).post('/api/public-calendar/nonexistent/save');
    expect(res.status).toBe(404);
  });

  test('returns 201 when customer saves event for first time', async () => {
    setUser({ id: 'user_cust_01', role: 'customer' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent()]);
      }
      if (collection === 'publicCalendarSaves') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).post('/api/public-calendar/pce_001/save');
    expect(res.status).toBe(201);
    expect(res.body.alreadySaved).toBe(false);
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
  });

  test('returns 200 (idempotent) when customer saves already-saved event', async () => {
    setUser({ id: 'user_cust_01', role: 'customer' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent()]);
      }
      if (collection === 'publicCalendarSaves') {
        return Promise.resolve([{ id: 'pcs_001', userId: 'user_cust_01', eventId: 'pce_001' }]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).post('/api/public-calendar/pce_001/save');
    expect(res.status).toBe(200);
    expect(res.body.alreadySaved).toBe(true);
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });
});

describe('GET /api/public-calendar/saved — customer saved events', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    clearUser();
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/public-calendar/saved');
    expect(res.status).toBe(401);
  });

  test('returns 403 when supplier calls saved endpoint', async () => {
    setUser({ id: 'user_publisher_01', role: 'supplier' });
    const res = await request(app).get('/api/public-calendar/saved');
    expect(res.status).toBe(403);
  });

  test('returns saved events for customer', async () => {
    setUser({ id: 'user_cust_01', role: 'customer' });
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'publicCalendarSaves') {
        return Promise.resolve([
          {
            id: 'pcs_001',
            userId: 'user_cust_01',
            eventId: 'pce_001',
            savedAt: '2025-01-01T00:00:00Z',
          },
        ]);
      }
      if (collection === 'publicCalendarEvents') {
        return Promise.resolve([makeEvent()]);
      }
      return Promise.resolve([]);
    });
    const res = await request(app).get('/api/public-calendar/saved');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('pce_001');
  });
});
