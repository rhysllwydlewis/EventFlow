'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../services/queue', () => ({
  getQueueHealth: jest.fn(),
}));

const { getQueueHealth } = require('../../services/queue');
const systemRoutes = require('../../routes/system');

describe('system messaging queue readiness', () => {
  const originalEnv = process.env;
  let app;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.internal:6379',
      MONGODB_URI: 'mongodb://mongo.internal/eventflow',
      JWT_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      BASE_URL: 'https://event-flow.co.uk',
    };
    jest.clearAllMocks();
    const mongoDb = {
      isConnected: jest.fn(() => true),
      getConnectionState: jest.fn(() => 'connected'),
      getConnectionError: jest.fn(() => null),
    };
    const dbUnified = {
      getDatabaseStatus: jest.fn(() => ({ type: 'mongodb', initialized: true })),
      read: jest.fn(async () => ({})),
    };
    systemRoutes.initializeDependencies({
      APP_VERSION: 'test',
      EMAIL_ENABLED: true,
      postmark: { isPostmarkEnabled: () => true },
      mongoDb,
      dbUnified,
      getToken: () => 'token',
      authLimiter: (_req, _res, next) => next(),
      healthCheckLimiter: (_req, _res, next) => next(),
    });
    app = express();
    app.use('/api', systemRoutes);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns 503 when MongoDB is ready but the messaging worker is unavailable', async () => {
    getQueueHealth.mockResolvedValue({
      ready: false,
      mode: 'redis',
      producer: 'ready',
      worker: 'missing',
      workerHeartbeatAgeMs: null,
      reason: 'worker_heartbeat_unavailable',
    });

    const response = await request(app).get('/api/ready').expect(503);

    expect(response.body.reason).toBe('Messaging delivery unavailable');
    expect(response.body.services.messagingQueue).toMatchObject({
      ready: false,
      producer: 'ready',
      worker: 'missing',
    });
  });

  it('returns ready only when the producer and worker heartbeat are healthy', async () => {
    getQueueHealth.mockResolvedValue({
      ready: true,
      mode: 'redis',
      producer: 'ready',
      worker: 'healthy',
      workerHeartbeatAgeMs: 500,
      reason: null,
    });

    const response = await request(app).get('/api/ready').expect(200);

    expect(response.body.status).toBe('ready');
    expect(response.body.services.messagingQueue).toMatchObject({
      ready: true,
      worker: 'healthy',
    });
  });

  it('keeps health HTTP 200 but marks the service degraded when fan-out is unavailable', async () => {
    getQueueHealth.mockResolvedValue({
      ready: false,
      mode: 'redis',
      producer: 'unavailable',
      worker: 'unavailable',
      workerHeartbeatAgeMs: null,
      reason: 'redis_unreachable',
    });

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body.status).toBe('degraded');
    expect(response.body.services.messagingQueue.reason).toBe('redis_unreachable');
  });
});
