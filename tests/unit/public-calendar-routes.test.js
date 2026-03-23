/**
 * Unit tests for the Public Calendar routes (routes/public-calendar.js)
 *
 * Tests:
 *   - GET /events — open to all (anonymous and authenticated)
 *   - POST /events — rejects unauthenticated, non-supplier, non-publisher
 *   - POST /events — allows publisher supplier (Event Planner / Wedding Fayre)
 *   - POST /events — allows admin
 *   - PUT /events/:id — ownership check (publisher cannot edit others' events)
 *   - DELETE /events/:id — ownership check
 *   - POST /events/:id/save — idempotent save (no duplicates)
 *   - DELETE /events/:id/save — unsave
 *   - GET /events/saved — returns saved events for user
 */

'use strict';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret-for-jest-min-32-characters-long'; // pragma: allowlist secret
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  write: jest.fn().mockResolvedValue(undefined),
  findOne: jest.fn(),
  updateOne: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  searchLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

// Bypass CSRF in tests
jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const dbUnified = require('../../db-unified');

/** Creates a signed JWT cookie for the given user payload. */
function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET);
}

const PUBLISHER_SUPPLIER_USER = { id: 'user_pub1', email: 'planner@test.com', role: 'supplier' };
const OTHER_PUBLISHER_USER = { id: 'user_pub2', email: 'fayre@test.com', role: 'supplier' };
const NON_PUBLISHER_USER = { id: 'user_photo1', email: 'photo@test.com', role: 'supplier' };
const CUSTOMER_USER = { id: 'user_cust1', email: 'cust@test.com', role: 'customer' };
const ADMIN_USER = { id: 'user_admin1', email: 'admin@test.com', role: 'admin' };

const PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_pub1',
  ownerUserId: 'user_pub1',
  category: 'Event Planner',
  name: 'EventPro Ltd',
};
const OTHER_PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_pub2',
  ownerUserId: 'user_pub2',
  category: 'Wedding Fayre',
  name: 'Fayre Co',
};
const NON_PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_photo1',
  ownerUserId: 'user_photo1',
  category: 'Photography',
  name: 'Photo Studio',
};

/** Sample public calendar event owned by PUBLISHER_SUPPLIER_USER */
const SAMPLE_EVENT = {
  id: 'pce_event1',
  title: 'Spring Wedding Fayre',
  startDate: '2027-03-01T10:00:00.000Z',
  endDate: '2027-03-01T17:00:00.000Z',
  location: 'Manchester',
  category: 'Wedding Fayre',
  description: 'A big wedding fayre',
  createdByUserId: 'user_pub1',
  supplierId: 'sup_pub1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/public-calendar', require('../../routes/public-calendar'));
  return app;
}

// Helper: set token cookie on a supertest request chain
function withAuth(req, user) {
  return req.set('Cookie', `token=${makeToken(user)}`);
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function setupReadMock({ events = [], saves = [], suppliers = [], users = [] } = {}) {
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'public_calendar_events') {
      return [...events];
    }
    if (collection === 'public_calendar_saves') {
      return [...saves];
    }
    if (collection === 'suppliers') {
      return [...suppliers];
    }
    if (collection === 'users') {
      return [...users];
    }
    return [];
  });
  dbUnified.findOne.mockImplementation(async (collection, filter) => {
    if (collection === 'users') {
      const allUsers = [
        PUBLISHER_SUPPLIER_USER,
        OTHER_PUBLISHER_USER,
        NON_PUBLISHER_USER,
        CUSTOMER_USER,
        ADMIN_USER,
      ];
      return allUsers.find(u => u.id === filter.id) || null;
    }
    return null;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/public-calendar/events', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [SAMPLE_EVENT] });
  });

  it('returns 200 and events for anonymous users', async () => {
    const res = await request(app).get('/api/public-calendar/events');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events[0].id).toBe('pce_event1');
  });

  it('filters by category', async () => {
    setupReadMock({ events: [SAMPLE_EVENT] });
    const res = await request(app).get('/api/public-calendar/events?category=Wedding+Fayre');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(1);
  });

  it('returns empty list when category does not match', async () => {
    const res = await request(app).get('/api/public-calendar/events?category=Photography');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(0);
  });
});

describe('POST /api/public-calendar/events', () => {
  let app;
  const validBody = {
    title: 'Test Event',
    startDate: '2027-06-01T10:00:00Z',
    location: 'London',
    category: 'Wedding Fayre',
  };

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [], suppliers: [PUBLISHER_SUPPLIER_DOC, NON_PUBLISHER_SUPPLIER_DOC] });
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/public-calendar/events').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 for customer (non-supplier) role', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      CUSTOMER_USER
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for non-publisher supplier (Photography)', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      NON_PUBLISHER_USER
    );
    expect(res.status).toBe(403);
  });

  it('returns 201 for publisher supplier (Event Planner)', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.event.title).toBe('Test Event');
    expect(res.body.event.createdByUserId).toBe('user_pub1');
  });

  it('returns 201 for admin', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      ADMIN_USER
    );
    expect(res.status).toBe(201);
  });

  it('returns 400 when title is missing', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({ startDate: '2027-06-01' }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining(['title is required']));
  });

  it('returns 400 when startDate is missing', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({ title: 'No Date Event' }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining(['startDate is required']));
  });

  it('grants publish rights when publicCalendarPublisherOverride is true', async () => {
    const overriddenSupplier = {
      ...NON_PUBLISHER_SUPPLIER_DOC,
      publicCalendarPublisherOverride: true,
    };
    setupReadMock({ events: [], suppliers: [overriddenSupplier] });
    dbUnified.write.mockResolvedValue(undefined);

    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      NON_PUBLISHER_USER
    );
    expect(res.status).toBe(201);
  });

  it('denies publish rights when publicCalendarPublisherOverride is false for Event Planner', async () => {
    const blockedSupplier = { ...PUBLISHER_SUPPLIER_DOC, publicCalendarPublisherOverride: false };
    setupReadMock({ events: [], suppliers: [blockedSupplier] });

    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send(validBody),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/public-calendar/events/:id — ownership', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock({
      events: [SAMPLE_EVENT],
      suppliers: [PUBLISHER_SUPPLIER_DOC, OTHER_PUBLISHER_SUPPLIER_DOC],
    });
  });

  it('allows the owner to update their event', async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ title: 'Updated Title', startDate: SAMPLE_EVENT.startDate }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe('Updated Title');
  });

  it("returns 403 when a different publisher tries to update another publisher's event", async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ title: 'Hijacked Title', startDate: SAMPLE_EVENT.startDate }),
      OTHER_PUBLISHER_USER
    );
    expect(res.status).toBe(403);
  });

  it('allows admin to update any event', async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ title: 'Admin Edit', startDate: SAMPLE_EVENT.startDate }),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent event', async () => {
    const res = await withAuth(
      request(app)
        .put('/api/public-calendar/events/pce_missing')
        .send({ title: 'x', startDate: '2027-01-01' }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/public-calendar/events/:id — ownership', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock({
      events: [SAMPLE_EVENT],
      suppliers: [PUBLISHER_SUPPLIER_DOC, OTHER_PUBLISHER_SUPPLIER_DOC],
    });
  });

  it('allows the owner to delete their event', async () => {
    const res = await withAuth(
      request(app).delete(`/api/public-calendar/events/${SAMPLE_EVENT.id}`),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 403 when a different publisher tries to delete another publisher's event", async () => {
    const res = await withAuth(
      request(app).delete(`/api/public-calendar/events/${SAMPLE_EVENT.id}`),
      OTHER_PUBLISHER_USER
    );
    expect(res.status).toBe(403);
  });

  it('allows admin to delete any event', async () => {
    const res = await withAuth(
      request(app).delete(`/api/public-calendar/events/${SAMPLE_EVENT.id}`),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/public-calendar/events/:id/save — customer save', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [SAMPLE_EVENT], saves: [] });
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .post(`/api/public-calendar/events/${SAMPLE_EVENT.id}/save`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('customer can save a public event', async () => {
    const res = await withAuth(
      request(app).post(`/api/public-calendar/events/${SAMPLE_EVENT.id}/save`).send({}),
      CUSTOMER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.save.userId).toBe('user_cust1');
    expect(res.body.save.eventId).toBe(SAMPLE_EVENT.id);
  });

  it('does not create duplicate — returns 200 when already saved', async () => {
    const existingSave = {
      id: 'pcs_1',
      userId: 'user_cust1',
      eventId: SAMPLE_EVENT.id,
      savedAt: '2026-01-01',
    };
    setupReadMock({ events: [SAMPLE_EVENT], saves: [existingSave] });
    dbUnified.write.mockClear();

    const res = await withAuth(
      request(app).post(`/api/public-calendar/events/${SAMPLE_EVENT.id}/save`).send({}),
      CUSTOMER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already saved');
    // Ensure write was not called (no new record)
    expect(dbUnified.write).not.toHaveBeenCalled();
  });

  it('returns 404 when event does not exist', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events/pce_missing/save').send({}),
      CUSTOMER_USER
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/public-calendar/events/:id/save — unsave', () => {
  let app;
  const existingSave = {
    id: 'pcs_1',
    userId: 'user_cust1',
    eventId: SAMPLE_EVENT.id,
    savedAt: '2026-01-01',
  };

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [SAMPLE_EVENT], saves: [existingSave] });
    dbUnified.write.mockClear();
  });

  it('customer can unsave an event', async () => {
    const res = await withAuth(
      request(app).delete(`/api/public-calendar/events/${SAMPLE_EVENT.id}/save`),
      CUSTOMER_USER
    );
    expect(res.status).toBe(200);
    expect(dbUnified.write).toHaveBeenCalledWith('public_calendar_saves', []);
  });

  it('returns 404 when save does not exist', async () => {
    setupReadMock({ saves: [] });
    const res = await withAuth(
      request(app).delete(`/api/public-calendar/events/${SAMPLE_EVENT.id}/save`),
      CUSTOMER_USER
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public-calendar/events/saved', () => {
  let app;
  const save = {
    id: 'pcs_1',
    userId: 'user_cust1',
    eventId: SAMPLE_EVENT.id,
    savedAt: '2026-01-01',
  };

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [SAMPLE_EVENT], saves: [save] });
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/public-calendar/events/saved');
    expect(res.status).toBe(401);
  });

  it('returns saved events for the authenticated user', async () => {
    const res = await withAuth(
      request(app).get('/api/public-calendar/events/saved'),
      CUSTOMER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].id).toBe(SAMPLE_EVENT.id);
    expect(res.body.events[0].savedByMe).toBe(true);
  });

  it('returns empty list for user with no saves', async () => {
    const res = await withAuth(
      request(app).get('/api/public-calendar/events/saved'),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(0);
  });
});
