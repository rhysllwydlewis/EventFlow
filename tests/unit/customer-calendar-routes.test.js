/**
 * Unit tests for customer calendar entries routes (routes/customer-calendar.js)
 *
 * Tests:
 *   - GET  /      - returns only the authenticated user's entries
 *   - POST /      - creates a new entry; validates title, type, date, time, description
 *   - PUT  /:id   - updates an existing entry (owner only); 404 for missing/other user's entry
 *   - DELETE /:id - deletes an entry (owner only); 404 for missing/other user's entry
 */

'use strict';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret-for-jest-min-32-characters-long'; // pragma: allowlist secret
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

// ─── Mocks ───────────────────────────────────────────────────────────────────

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

function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET);
}

const USER_A = { id: 'user_a', email: 'a@test.com', role: 'customer', verified: true };
const USER_B = { id: 'user_b', email: 'b@test.com', role: 'customer', verified: true };

const EXISTING_ENTRY = {
  id: 'ce_001',
  userId: USER_A.id,
  title: 'Wedding Viewing',
  type: 'appointment',
  date: '2027-06-15',
  time: '14:00',
  description: 'Venue visit',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/me/calendar-entries', require('../../routes/customer-calendar'));
  return app;
}

function withAuth(req, user) {
  return req.set('Cookie', `token=${makeToken(user)}`);
}

function setupReadMock(entries = [], notifications = [], savedPublicEvents = []) {
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'customer_calendar_entries') {
      return [...entries];
    }
    if (collection === 'notifications') {
      return [...notifications];
    }
    if (collection === 'public_calendar_saves') {
      return savedPublicEvents.map(event => ({
        id: `save_${event.id}`,
        userId: USER_A.id,
        eventId: event.id,
      }));
    }
    if (collection === 'public_calendar_events') {
      return [...savedPublicEvents];
    }
    if (collection === 'users') {
      return [USER_A, USER_B];
    }
    return [];
  });
  dbUnified.findOne.mockImplementation(async (collection, filter) => {
    if (collection === 'users') {
      return [USER_A, USER_B].find(u => u.id === filter.id) || null;
    }
    return null;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/me/calendar-entries', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    setupReadMock([EXISTING_ENTRY]);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/me/calendar-entries');
    expect(res.status).toBe(401);
  });

  it("returns only the authenticated user's entries", async () => {
    const res = await withAuth(request(app).get('/api/me/calendar-entries'), USER_A);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBe(1);
    expect(res.body.entries[0].id).toBe(EXISTING_ENTRY.id);
  });

  it('returns empty list for user with no entries', async () => {
    const res = await withAuth(request(app).get('/api/me/calendar-entries'), USER_B);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(0);
  });

  it('creates a 7-day reminder notification once for upcoming calendar entries', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-06-08T12:00:00.000Z'));
    setupReadMock([EXISTING_ENTRY], []);

    const res = await withAuth(request(app).get('/api/me/calendar-entries'), USER_A);

    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(1);
    expect(dbUnified.write).toHaveBeenCalledWith(
      'notifications',
      expect.arrayContaining([
        expect.objectContaining({
          id: `calrem_${USER_A.id}_${EXISTING_ENTRY.id}_7_${EXISTING_ENTRY.date}`,
          userId: USER_A.id,
          type: 'reminder',
          priority: 'normal',
          category: 'calendar',
          actionUrl: '/dashboard/customer#events-calendar',
        }),
      ])
    );
    jest.useRealTimers();
  });

  it('does not duplicate an existing calendar reminder notification', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-06-14T12:00:00.000Z'));
    const existingReminder = {
      id: `calrem_${USER_A.id}_${EXISTING_ENTRY.id}_1_${EXISTING_ENTRY.date}`,
    };
    setupReadMock([EXISTING_ENTRY], [existingReminder]);

    const res = await withAuth(request(app).get('/api/me/calendar-entries'), USER_A);

    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(0);
    expect(dbUnified.write).not.toHaveBeenCalledWith('notifications', expect.any(Array));
    jest.useRealTimers();
  });

  it('creates reminders for saved public calendar events due in 1 day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-08-19T12:00:00.000Z'));
    const savedPublicEvent = {
      id: 'pce_public_1',
      slug: 'summer-fayre',
      title: 'Summer Fayre',
      startDate: '2027-08-20T10:30:00.000Z',
    };
    setupReadMock([], [], [savedPublicEvent]);

    const res = await withAuth(request(app).get('/api/me/calendar-entries'), USER_A);

    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(1);
    expect(dbUnified.write).toHaveBeenCalledWith(
      'notifications',
      expect.arrayContaining([
        expect.objectContaining({
          id: `calrem_public_${USER_A.id}_${savedPublicEvent.id}_1_2027-08-20`,
          type: 'reminder',
          priority: 'high',
          actionUrl: '/events/summer-fayre',
          metadata: expect.objectContaining({ source: 'public' }),
        }),
      ])
    );
    jest.useRealTimers();
  });
});

describe('POST /api/me/calendar-entries', () => {
  let app;
  const validBody = {
    title: 'Venue Viewing',
    type: 'appointment',
    date: '2027-07-20',
    time: '10:30',
    description: 'Check the hall',
  };

  beforeEach(() => {
    app = buildApp();
    setupReadMock([]);
    dbUnified.write.mockClear();
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/me/calendar-entries').send(validBody);
    expect(res.status).toBe(401);
  });

  it('creates a new entry for an authenticated user', async () => {
    const res = await withAuth(
      request(app).post('/api/me/calendar-entries').send(validBody),
      USER_A
    );
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.entry.title).toBe('Venue Viewing');
    expect(res.body.entry.userId).toBe(USER_A.id);
    expect(res.body.entry.type).toBe('appointment');
    expect(res.body.entry.date).toBe('2027-07-20');
    expect(res.body.entry.time).toBe('10:30');
    expect(dbUnified.write).toHaveBeenCalledWith(
      'customer_calendar_entries',
      expect.arrayContaining([expect.objectContaining({ title: 'Venue Viewing' })])
    );
  });

  it('returns 400 when title is missing', async () => {
    const noTitle = { ...validBody };
    delete noTitle.title;
    const res = await withAuth(request(app).post('/api/me/calendar-entries').send(noTitle), USER_A);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 when type is invalid', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/me/calendar-entries')
        .send({ ...validBody, type: 'invalid-type' }),
      USER_A
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type/i);
  });

  it('returns 400 when date format is wrong', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/me/calendar-entries')
        .send({ ...validBody, date: '20/07/2027' }),
      USER_A
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it('returns 400 when time format is invalid', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/me/calendar-entries')
        .send({ ...validBody, time: '25:99' }),
      USER_A
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/time/i);
  });

  it('stores null time when time is omitted', async () => {
    const noTime = { ...validBody };
    delete noTime.time;
    const res = await withAuth(request(app).post('/api/me/calendar-entries').send(noTime), USER_A);
    expect(res.status).toBe(201);
    expect(res.body.entry.time).toBeNull();
  });

  it('stores null time when time is an empty string', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/me/calendar-entries')
        .send({ ...validBody, time: '' }),
      USER_A
    );
    expect(res.status).toBe(201);
    expect(res.body.entry.time).toBeNull();
  });

  it('returns 400 when description exceeds max length', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/me/calendar-entries')
        .send({ ...validBody, description: 'x'.repeat(501) }),
      USER_A
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });
});

describe('PUT /api/me/calendar-entries/:id', () => {
  let app;
  const updateBody = {
    title: 'Updated Viewing',
    type: 'meeting',
    date: '2027-08-01',
    time: '09:00',
    description: 'New notes',
  };

  beforeEach(() => {
    app = buildApp();
    setupReadMock([EXISTING_ENTRY]);
    dbUnified.write.mockClear();
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .put(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`)
      .send(updateBody);
    expect(res.status).toBe(401);
  });

  it('allows owner to update their entry', async () => {
    const res = await withAuth(
      request(app).put(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`).send(updateBody),
      USER_A
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.entry.title).toBe('Updated Viewing');
    expect(res.body.entry.type).toBe('meeting');
    expect(res.body.entry.date).toBe('2027-08-01');
    expect(res.body.entry.time).toBe('09:00');
    expect(res.body.entry.updatedAt).toBeDefined();
    expect(dbUnified.write).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when entry does not exist', async () => {
    const res = await withAuth(
      request(app).put('/api/me/calendar-entries/ce_missing').send(updateBody),
      USER_A
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when trying to update another user's entry", async () => {
    // USER_B cannot update USER_A's entry — both user+id must match.
    const res = await withAuth(
      request(app).put(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`).send(updateBody),
      USER_B
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid update body', async () => {
    const res = await withAuth(
      request(app)
        .put(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`)
        .send({ title: '', type: 'appointment', date: '2027-01-01' }),
      USER_A
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });
});

describe('DELETE /api/me/calendar-entries/:id', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    setupReadMock([EXISTING_ENTRY]);
    dbUnified.write.mockClear();
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).delete(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`);
    expect(res.status).toBe(401);
  });

  it('allows owner to delete their entry', async () => {
    const res = await withAuth(
      request(app).delete(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`),
      USER_A
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(dbUnified.write).toHaveBeenCalledWith('customer_calendar_entries', []);
  });

  it('returns 404 when entry does not exist', async () => {
    const res = await withAuth(request(app).delete('/api/me/calendar-entries/ce_missing'), USER_A);
    expect(res.status).toBe(404);
    expect(dbUnified.write).not.toHaveBeenCalled();
  });

  it("returns 404 when trying to delete another user's entry", async () => {
    const res = await withAuth(
      request(app).delete(`/api/me/calendar-entries/${EXISTING_ENTRY.id}`),
      USER_B
    );
    expect(res.status).toBe(404);
    expect(dbUnified.write).not.toHaveBeenCalled();
  });
});
