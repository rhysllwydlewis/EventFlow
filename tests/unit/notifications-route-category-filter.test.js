'use strict';

const express = require('express');
const request = require('supertest');

const mockGetForUser = jest.fn(async () => ({
  notifications: [],
  pagination: { total: 0, limit: 50, skip: 0, hasMore: false },
  unreadCount: 0,
}));
const mockGetUnreadCount = jest.fn(async () => 0);

jest.mock('../../services/notification.service', () =>
  jest.fn().mockImplementation(() => ({
    getForUser: mockGetForUser,
    getUnreadCount: mockGetUnreadCount,
  }))
);

const notificationsRouter = require('../../routes/notifications');

function buildApp() {
  notificationsRouter.initializeDependencies({
    authRequired: (req, res, next) => {
      req.user = { id: 'user-1' };
      next();
    },
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    mongoDb: { getDb: async () => ({ collection: jest.fn() }) },
    getWebSocketServer: () => null,
    csrfProtection: (req, res, next) => next(),
  });

  const app = express();
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('GET /api/notifications — admin-category exclusion wiring', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetForUser.mockResolvedValue({
      notifications: [],
      pagination: { total: 0, limit: 50, skip: 0, hasMore: false },
      unreadCount: 0,
    });
    mockGetUnreadCount.mockResolvedValue(0);
    app = buildApp();
  });

  it('passes excludeCategories: ["admin"] through to getForUser', async () => {
    const res = await request(app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(mockGetForUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ excludeCategories: ['admin'] })
    );
  });

  it('passes excludeCategories: ["admin"] through to getUnreadCount', async () => {
    const res = await request(app).get('/api/notifications/unread-count');

    expect(res.status).toBe(200);
    expect(mockGetUnreadCount).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ excludeCategories: ['admin'] })
    );
  });
});
