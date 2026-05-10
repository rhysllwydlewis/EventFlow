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
  insertOne: jest.fn().mockResolvedValue(undefined),
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

const PUBLISHER_SUPPLIER_USER = {
  id: 'user_pub1',
  email: 'planner@test.com',
  role: 'supplier',
  verified: true,
};
const OTHER_PUBLISHER_USER = {
  id: 'user_pub2',
  email: 'fayre@test.com',
  role: 'supplier',
  verified: true,
};
const NON_PUBLISHER_USER = {
  id: 'user_photo1',
  email: 'photo@test.com',
  role: 'supplier',
  verified: true,
};
const CUSTOMER_USER = {
  id: 'user_cust1',
  email: 'cust@test.com',
  role: 'customer',
  verified: true,
};
const ADMIN_USER = { id: 'user_admin1', email: 'admin@test.com', role: 'admin', verified: true };

const PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_pub1',
  ownerUserId: 'user_pub1',
  category: 'Event Planner',
  name: 'EventPro Ltd',
  approved: true,
};
const OTHER_PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_pub2',
  ownerUserId: 'user_pub2',
  category: 'Wedding Fayre',
  name: 'Fayre Co',
  approved: true,
};
const NON_PUBLISHER_SUPPLIER_DOC = {
  id: 'sup_photo1',
  ownerUserId: 'user_photo1',
  category: 'Photography',
  name: 'Photo Studio',
  approved: true,
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

function setupReadMock({
  events = [],
  saves = [],
  suppliers = [],
  users = [],
  public_calendar_publisher_requests = [],
  public_calendar_event_reports = [],
  settings = {},
} = {}) {
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
    if (collection === 'public_calendar_publisher_requests') {
      return [...public_calendar_publisher_requests];
    }
    if (collection === 'public_calendar_event_reports') {
      return [...public_calendar_event_reports];
    }
    if (collection === 'settings') {
      return settings;
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
    if (collection === 'suppliers') {
      const all = [
        PUBLISHER_SUPPLIER_DOC,
        OTHER_PUBLISHER_SUPPLIER_DOC,
        NON_PUBLISHER_SUPPLIER_DOC,
        ...suppliers,
      ];
      return (
        all.find(
          s =>
            (!filter.id || s.id === filter.id) &&
            (!filter.ownerUserId || s.ownerUserId === filter.ownerUserId)
        ) || null
      );
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

  it('removes stale saves for events removed from the shared calendar', async () => {
    setupReadMock({
      events: [],
      saves: [
        {
          ...save,
          eventDeleted: true,
          eventDeletedAt: '2026-01-03T00:00:00.000Z',
          eventSnapshot: {
            title: SAMPLE_EVENT.title,
            startDate: SAMPLE_EVENT.startDate,
            slug: 'spring-wedding-fayre-deleted',
            eventType: 'Wedding Fayre',
          },
        },
      ],
    });

    const res = await withAuth(
      request(app).get('/api/public-calendar/events/saved'),
      CUSTOMER_USER
    );

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

// ─── New behaviour tests (Fix 1, 3, 5, 8) ───────────────────────────────────

describe('GET /api/public-calendar/events — case-insensitive category filter', () => {
  let app;
  // Simulate an event stored with a mixed-case category (legacy data).
  const mixedCaseEvent = { ...SAMPLE_EVENT, id: 'pce_mixed', category: 'Wedding Fayre' };
  // Simulate an event stored with a lowercase category (created via the new API).
  const lowerCaseEvent = { ...SAMPLE_EVENT, id: 'pce_lower', category: 'wedding fayre' };

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [mixedCaseEvent, lowerCaseEvent] });
  });

  it('finds event stored with mixed-case category when query is lowercase', async () => {
    const res = await request(app).get('/api/public-calendar/events?category=wedding+fayre');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toContain('pce_mixed');
  });

  it('finds event stored with lowercase category when query is mixed-case', async () => {
    const res = await request(app).get('/api/public-calendar/events?category=Wedding+Fayre');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toContain('pce_lower');
  });

  it('returns both events regardless of stored-casing when query matches', async () => {
    const res = await request(app).get('/api/public-calendar/events?category=WEDDING+FAYRE');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBe(2);
  });
});

describe('GET /api/public-calendar/events — bare-date filter is timezone-safe', () => {
  let app;
  // An event starting at UTC midnight on 2027-03-01.
  const eventOnDay = { ...SAMPLE_EVENT, id: 'pce_day', startDate: '2027-03-01T00:00:00.000Z' };
  // An event starting the day before.
  const eventBefore = { ...SAMPLE_EVENT, id: 'pce_before', startDate: '2027-02-28T23:59:59.000Z' };

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [eventBefore, eventOnDay] });
  });

  it('includes event on the start date when filtering with a bare date', async () => {
    const res = await request(app).get('/api/public-calendar/events?startDate=2027-03-01');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toContain('pce_day');
    expect(res.body.events.map(e => e.id)).not.toContain('pce_before');
  });

  it('excludes events after the end date when filtering with a bare date', async () => {
    const res = await request(app).get('/api/public-calendar/events?endDate=2027-02-28');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toContain('pce_before');
    expect(res.body.events.map(e => e.id)).not.toContain('pce_day');
  });
});

describe('POST /api/public-calendar/events — URL validation', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock({ events: [], suppliers: [PUBLISHER_SUPPLIER_DOC] });
    dbUnified.write.mockClear();
  });

  it('rejects javascript: scheme in imageUrl', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'XSS Event',
        startDate: '2027-06-01T10:00:00Z',
        imageUrl: 'javascript:alert(1)',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining(['imageUrl must be a valid http or https URL'])
    );
  });

  it('rejects data: URI in imageUrl', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Data Event',
        startDate: '2027-06-01T10:00:00Z',
        imageUrl: 'data:text/html,<script>alert(1)</script>',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining(['imageUrl must be a valid http or https URL'])
    );
  });

  it('rejects javascript: scheme in externalUrl', async () => {
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'XSS Ext',
        startDate: '2027-06-01T10:00:00Z',
        externalUrl: 'javascript:void(0)',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining(['externalUrl must be a valid http or https URL'])
    );
  });

  it('accepts a valid https imageUrl', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Good Image',
        startDate: '2027-06-01T10:00:00Z',
        imageUrl: 'https://example.com/image.jpg',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.imageUrl).toBe('https://example.com/image.jpg');
  });

  it('accepts a valid http externalUrl', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Good Ext',
        startDate: '2027-06-01T10:00:00Z',
        externalUrl: 'http://example.com/booking',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.externalUrl).toBe('http://example.com/booking');
  });

  it('accepts an empty imageUrl (clears the field)', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'No Image',
        startDate: '2027-06-01T10:00:00Z',
        imageUrl: '',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.imageUrl).toBe('');
  });

  it('normalises category to lowercase on creation', async () => {
    dbUnified.write.mockResolvedValue(undefined);
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Cat Test',
        startDate: '2027-06-01T10:00:00Z',
        category: 'Wedding Fayre',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.category).toBe('wedding fayre');
  });
});

describe('PUT /api/public-calendar/events/:id — updatedByUserId', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock({
      events: [SAMPLE_EVENT],
      suppliers: [PUBLISHER_SUPPLIER_DOC],
    });
    dbUnified.write.mockClear();
  });

  it('response includes updatedByUserId matching the caller', async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ title: 'New Title', startDate: SAMPLE_EVENT.startDate }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.event.updatedByUserId).toBe(PUBLISHER_SUPPLIER_USER.id);
  });

  it('admin update also records updatedByUserId', async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ title: 'Admin Title', startDate: SAMPLE_EVENT.startDate }),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.event.updatedByUserId).toBe(ADMIN_USER.id);
  });
});

describe('Public calendar lifecycle, richer fields, export and publishing requests', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    dbUnified.write.mockClear();
    dbUnified.updateOne.mockClear();
  });

  it('hides draft and cancelled events from the default public listing', async () => {
    setupReadMock({
      events: [
        { ...SAMPLE_EVENT, id: 'pce_published', status: 'published' },
        { ...SAMPLE_EVENT, id: 'pce_draft', status: 'draft' },
        { ...SAMPLE_EVENT, id: 'pce_cancelled', status: 'cancelled' },
      ],
    });

    const res = await request(app).get('/api/public-calendar/events?includePast=true');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toEqual(['pce_published']);
  });

  it('treats missing status old events as published and normalises fallbacks', async () => {
    setupReadMock({
      events: [
        {
          ...SAMPLE_EVENT,
          imageUrl: 'https://example.com/old.jpg',
          externalUrl: 'https://example.com/book',
        },
      ],
    });

    const res = await request(app).get('/api/public-calendar/events?includePast=true');
    expect(res.status).toBe(200);
    expect(res.body.events[0].status).toBe('published');
    expect(res.body.events[0].featuredImageUrl).toBe('https://example.com/old.jpg');
    expect(res.body.events[0].externalBookingUrl).toBe('https://example.com/book');
    expect(res.body.events[0].slug).toMatch(/^spring-wedding-fayre-/);
  });

  it('supports richer event fields on creation', async () => {
    setupReadMock({ events: [], suppliers: [PUBLISHER_SUPPLIER_DOC] });
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Venue Tour Evening',
        startDate: '2027-07-01T18:00:00Z',
        eventType: 'Venue Tour',
        priceType: 'free',
        bookingRequired: true,
        postcode: 'M1 1AE',
        county: 'Greater Manchester',
        externalBookingUrl: 'https://example.com/tour',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.eventType).toBe('Venue Tour');
    expect(res.body.event.priceType).toBe('free');
    expect(res.body.event.bookingRequired).toBe(true);
    expect(res.body.event.externalBookingUrl).toBe('https://example.com/tour');
  });

  it('holds supplier-created events for review when public calendar approval is required', async () => {
    setupReadMock({
      events: [],
      suppliers: [PUBLISHER_SUPPLIER_DOC],
      settings: { features: { requirePublicCalendarApproval: true } },
    });
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Approval Needed',
        startDate: '2027-07-01T18:00:00Z',
        status: 'published',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.event.status).toBe('pending_review');
    expect(res.body.event.publishedAt).toBeNull();
  });

  it('rejects unsafe rich URLs and invalid dates', async () => {
    setupReadMock({ events: [], suppliers: [PUBLISHER_SUPPLIER_DOC] });
    const res = await withAuth(
      request(app).post('/api/public-calendar/events').send({
        title: 'Bad Event',
        startDate: '2027-07-02T18:00:00Z',
        endDate: '2027-07-01T18:00:00Z',
        externalBookingUrl: 'data:text/html,bad',
      }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        'endDate must be on or after startDate',
        'externalBookingUrl must be a valid http or https URL',
      ])
    );
  });

  it('exports an .ics file for visible public events', async () => {
    setupReadMock({
      events: [{ ...SAMPLE_EVENT, status: 'published', organiserName: 'Fayre Co' }],
    });
    const res = await request(app).get(`/api/public-calendar/events/${SAMPLE_EVENT.id}/ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('SUMMARY:Spring Wedding Fayre');
  });

  it('allows a non-publisher supplier to create a publishing access request', async () => {
    setupReadMock({
      suppliers: [NON_PUBLISHER_SUPPLIER_DOC],
      public_calendar_publisher_requests: [],
    });
    const res = await withAuth(
      request(app).post('/api/public-calendar/publisher-request').send({
        reason: 'We host quarterly open days and supplier showcases.',
        eventTypes: 'Open Day, Supplier Showcase',
        exampleEventTitle: 'Autumn Studio Open Day',
        expectedFrequency: 'quarterly',
      }),
      NON_PUBLISHER_USER
    );
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('pending');
  });

  it('prevents duplicate pending publishing access requests', async () => {
    setupReadMock({
      suppliers: [NON_PUBLISHER_SUPPLIER_DOC],
      public_calendar_publisher_requests: [
        { id: 'pcpr_1', supplierId: NON_PUBLISHER_SUPPLIER_DOC.id, status: 'pending' },
      ],
    });
    const res = await withAuth(
      request(app)
        .post('/api/public-calendar/publisher-request')
        .send({ reason: 'We host regular workshops.' }),
      NON_PUBLISHER_USER
    );
    expect(res.status).toBe(409);
  });

  it('admin approval updates the supplier override to true', async () => {
    setupReadMock({
      public_calendar_publisher_requests: [
        {
          id: 'pcpr_1',
          supplierId: NON_PUBLISHER_SUPPLIER_DOC.id,
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const res = await withAuth(
      request(app)
        .post('/api/public-calendar/publisher-requests/pcpr_1/approve')
        .send({ reason: 'Looks valid' }),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('approved');
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: NON_PUBLISHER_SUPPLIER_DOC.id },
      expect.objectContaining({
        $set: expect.objectContaining({ publicCalendarPublisherOverride: true }),
      })
    );
  });
});

describe('Public calendar regression fixes', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    dbUnified.write.mockClear();
  });

  it('hides past events without endDate from default public listings', async () => {
    setupReadMock({
      events: [
        {
          ...SAMPLE_EVENT,
          id: 'pce_past_no_end',
          startDate: '2020-01-01T10:00:00.000Z',
          endDate: '',
          status: 'published',
        },
        {
          ...SAMPLE_EVENT,
          id: 'pce_future_no_end',
          startDate: '2027-01-01T10:00:00.000Z',
          endDate: '',
          status: 'published',
        },
      ],
    });

    const res = await request(app).get('/api/public-calendar/events');
    expect(res.status).toBe(200);
    expect(res.body.events.map(e => e.id)).toEqual(['pce_future_no_end']);
  });

  it('allows direct public access to cancelled event details with status included', async () => {
    setupReadMock({
      events: [{ ...SAMPLE_EVENT, status: 'cancelled', cancelledReason: 'Venue issue' }],
    });

    const res = await request(app).get(`/api/public-calendar/events/${SAMPLE_EVENT.id}`);
    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('cancelled');
    expect(res.body.event.cancelledReason).toBe('Venue issue');
  });

  it('rejects updating startDate beyond an existing endDate', async () => {
    setupReadMock({ events: [SAMPLE_EVENT], suppliers: [PUBLISHER_SUPPLIER_DOC] });

    const res = await withAuth(
      request(app)
        .put(`/api/public-calendar/events/${SAMPLE_EVENT.id}`)
        .send({ startDate: '2027-03-02T10:00:00.000Z' }),
      PUBLISHER_SUPPLIER_USER
    );
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining(['endDate must be on or after startDate'])
    );
  });
});

describe('Public calendar admin management surfaces', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it('includes savesCount for admin event listings', async () => {
    setupReadMock({
      events: [SAMPLE_EVENT],
      saves: [
        { id: 'pcs_1', userId: CUSTOMER_USER.id, eventId: SAMPLE_EVENT.id },
        { id: 'pcs_2', userId: OTHER_PUBLISHER_USER.id, eventId: SAMPLE_EVENT.id },
      ],
    });

    const res = await withAuth(
      request(app).get('/api/public-calendar/events?status=all&includePast=true'),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.events[0].savesCount).toBe(2);
  });

  it('excludes soft-deleted legacy events from admin counts and listings', async () => {
    setupReadMock({
      events: [
        SAMPLE_EVENT,
        { ...SAMPLE_EVENT, id: 'pce_deleted_status', status: 'deleted' },
        { ...SAMPLE_EVENT, id: 'pce_deleted_at', deletedAt: '2026-01-03T00:00:00.000Z' },
      ],
    });

    const res = await withAuth(
      request(app).get('/api/public-calendar/events?status=all&includePast=true'),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.events.map(event => event.id)).toEqual([SAMPLE_EVENT.id]);
  });

  it('creates a support ticket when a customer reports a public event', async () => {
    setupReadMock({ events: [SAMPLE_EVENT] });

    const res = await withAuth(
      request(app).post(`/api/public-calendar/events/${SAMPLE_EVENT.id}/report`).send({
        reason: 'Incorrect information',
        notes: 'The venue address is wrong.',
      }),
      CUSTOMER_USER
    );

    expect(res.status).toBe(201);
    expect(dbUnified.write).not.toHaveBeenCalledWith(
      'public_calendar_event_reports',
      expect.any(Array)
    );
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      'tickets',
      expect.objectContaining({
        senderId: CUSTOMER_USER.id,
        senderType: 'customer',
        source: 'public_calendar_report',
        relatedEventId: SAMPLE_EVENT.id,
        subject: expect.stringContaining(SAMPLE_EVENT.title),
        message: expect.stringContaining('The venue address is wrong.'),
      })
    );
  });

  it('enriches admin event reports with event details', async () => {
    setupReadMock({
      events: [SAMPLE_EVENT],
      public_calendar_event_reports: [
        {
          id: 'pcer_1',
          eventId: SAMPLE_EVENT.id,
          reporterUserId: CUSTOMER_USER.id,
          reason: 'Incorrect information',
          status: 'open',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const res = await withAuth(
      request(app).get('/api/public-calendar/reports?status=open'),
      ADMIN_USER
    );
    expect(res.status).toBe(200);
    expect(res.body.reports[0].eventTitle).toBe(SAMPLE_EVENT.title);
    expect(res.body.reports[0].eventSlug).toMatch(/^spring-wedding-fayre-/);
  });
});
