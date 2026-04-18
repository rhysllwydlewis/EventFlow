'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'customer' };
    next();
  },
}));

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
}));

const mockInfo = jest.fn();
jest.mock('../../utils/logger', () => ({
  info: (...args) => mockInfo(...args),
  warn: jest.fn(),
  error: jest.fn(),
}));

const telemetryRouter = require('../../routes/telemetry');

describe('POST /api/v1/telemetry/messenger', () => {
  function makeApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/v1/telemetry', telemetryRouter);
    return app;
  }

  beforeEach(() => {
    mockInfo.mockClear();
  });

  it('accepts valid messenger telemetry payload', async () => {
    const app = makeApp();
    const payload = {
      sessionId: 'sess-1',
      counters: {
        dupSeqDrops: 1,
        cmidReconciles: 2,
        maxGapSize: 3,
        timeToLiveMs: 400,
      },
    };
    const res = await request(app).post('/api/v1/telemetry/messenger').send(payload);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(mockInfo).toHaveBeenCalledWith(
      'metric.messenger.telemetry',
      expect.objectContaining({ userId: 'user-1', sessionId: 'sess-1' })
    );
  });

  it('rejects invalid payloads', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/v1/telemetry/messenger').send({
      sessionId: '',
      counters: {},
    });
    expect(res.status).toBe(400);
    expect(mockInfo).not.toHaveBeenCalled();
  });
});
