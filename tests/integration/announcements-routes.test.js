const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const announcementsRoutes = require('../../routes/announcements');

describe('Public announcements route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/v1', announcementsRoutes);
  });

  it('requires no auth and returns only active announcements', async () => {
    dbUnified.read.mockResolvedValue({
      announcements: [
        {
          id: 'a1',
          message: 'Active one',
          type: 'info',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'admin@event-flow.co.uk',
        },
        {
          id: 'a2',
          message: 'Inactive one',
          type: 'warning',
          active: false,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    const res = await request(app).get('/api/v1/announcements');

    expect(res.status).toBe(200);
    expect(res.body.announcements).toHaveLength(1);
    expect(res.body.announcements[0]).toMatchObject({
      id: 'a1',
      message: 'Active one',
      type: 'info',
    });
    // createdBy is admin-internal and must not leak to the public route
    expect(res.body.announcements[0].createdBy).toBeUndefined();
  });

  it('sorts active announcements newest first', async () => {
    dbUnified.read.mockResolvedValue({
      announcements: [
        { id: 'older', message: 'Older', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'newer', message: 'Newer', active: true, createdAt: '2026-06-01T00:00:00.000Z' },
      ],
    });

    const res = await request(app).get('/api/v1/announcements');

    expect(res.body.announcements.map(a => a.id)).toEqual(['newer', 'older']);
  });

  it('returns an empty list when there is no content record', async () => {
    dbUnified.read.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/announcements');

    expect(res.status).toBe(200);
    expect(res.body.announcements).toEqual([]);
  });

  it('returns 500 without leaking internals on a read failure', async () => {
    dbUnified.read.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/v1/announcements');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to load announcements');
  });
});
