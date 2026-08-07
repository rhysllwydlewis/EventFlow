'use strict';

const mockGetQueueHealth = jest.fn(async () => ({ ready: true, producer: 'ready' }));
const mockIsWorkerFleetReady = jest.fn(() => true);
const mockIsPostmarkEnabled = jest.fn(() => true);

jest.mock('../../db-unified', () => ({
  initializeDatabase: jest.fn(),
  getStatus: jest.fn(),
}));
jest.mock('../../db', () => ({ getDb: jest.fn() }));
jest.mock('../../utils/postmark', () => ({ isPostmarkEnabled: mockIsPostmarkEnabled }));
jest.mock('../../services/queue', () => ({
  setQueueContext: jest.fn(),
  shutdownQueues: jest.fn(),
  startWorkerHeartbeat: jest.fn(),
  getQueueHealth: mockGetQueueHealth,
  isWorkerFleetReady: mockIsWorkerFleetReady,
}));
jest.mock('../../services/queue/workers/notification.worker', () => ({
  startNotificationWorker: jest.fn(),
}));
jest.mock('../../services/queue/workers/email.worker', () => ({
  startEmailWorker: jest.fn(),
}));
jest.mock('../../services/notificationFanout.service', () => ({
  startNotificationFanoutReconciler: jest.fn(),
}));

const { assertWorkerEnv, startHealthServer, stopHealthServer } = require('../../scripts/worker');

describe('worker readiness endpoint', () => {
  afterEach(async () => {
    await stopHealthServer();
    jest.clearAllMocks();
    mockGetQueueHealth.mockResolvedValue({ ready: true, producer: 'ready' });
    mockIsWorkerFleetReady.mockReturnValue(true);
    mockIsPostmarkEnabled.mockReturnValue(true);
  });

  it('reports actual consumer and Redis readiness', async () => {
    const server = await startHealthServer({ port: 0 });
    const { port } = server.address();

    const readyResponse = await fetch(`http://127.0.0.1:${port}/api/ready`);
    await expect(readyResponse.json()).resolves.toEqual({
      ready: true,
      process: 'worker',
      consumers: 'ready',
      redis: 'ready',
    });
    expect(readyResponse.status).toBe(200);

    mockIsWorkerFleetReady.mockReturnValue(false);
    const unavailableResponse = await fetch(`http://127.0.0.1:${port}/api/ready`);
    expect(unavailableResponse.status).toBe(503);
    await expect(unavailableResponse.json()).resolves.toMatchObject({
      ready: false,
      consumers: 'unavailable',
    });
  });

  it('does not expose other worker routes', async () => {
    const server = await startHealthServer({ port: 0 });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/anything-else`);

    expect(response.status).toBe(404);
  });
});

describe('worker production configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://database.internal/eventflow',
      REDIS_URL: 'redis://redis.internal:6379',
      BASE_URL: 'https://event-flow.co.uk',
      POSTMARK_API_KEY: 'postmark-token',
    };
    mockIsPostmarkEnabled.mockReturnValue(true);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts the complete production delivery configuration', () => {
    expect(() => assertWorkerEnv()).not.toThrow();
  });

  it('fails closed for missing delivery dependencies, non-HTTPS links, or provider failure', () => {
    delete process.env.POSTMARK_API_KEY;
    expect(() => assertWorkerEnv()).toThrow(/POSTMARK_API_KEY/);

    process.env.POSTMARK_API_KEY = 'postmark-token';
    process.env.BASE_URL = 'http://event-flow.co.uk';
    expect(() => assertWorkerEnv()).toThrow(/HTTPS/);

    process.env.BASE_URL = 'https://event-flow.co.uk';
    mockIsPostmarkEnabled.mockReturnValue(false);
    expect(() => assertWorkerEnv()).toThrow(/Postmark failed to initialize/);
  });
});
