'use strict';

const mockQueueAdd = jest.fn(async (_name, _data, options) => ({ id: options.jobId }));
const mockQueueClose = jest.fn(async () => {});
const mockWorkerClose = jest.fn(async () => {});
const mockRedisClient = {
  ping: jest.fn(async () => 'PONG'),
  get: jest.fn(async () => String(Date.now())),
  set: jest.fn(async () => 'OK'),
  quit: jest.fn(async () => 'OK'),
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedisClient));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(name => ({
    name,
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation((name, processor) => ({
    name,
    processor,
    close: mockWorkerClose,
  })),
}));

describe('Redis queue runtime health', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.internal:6379',
    };
    mockRedisClient.get.mockResolvedValue(String(Date.now()));
    mockRedisClient.ping.mockResolvedValue('PONG');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('probes producer/worker health and caches the result', async () => {
    const queue = require('../../services/queue');

    await expect(queue.getQueueHealth({ force: true })).resolves.toMatchObject({
      ready: true,
      mode: 'redis',
      producer: 'ready',
      worker: 'healthy',
    });
    await queue.getQueueHealth();

    expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.get).toHaveBeenCalledWith(queue.WORKER_HEARTBEAT_KEY);
  });

  it('runs queue operations, heartbeat startup and orderly shutdown', async () => {
    const queue = require('../../services/queue');
    const { notificationsQueue, useStub } = queue.getQueues();

    expect(useStub).toBe(false);
    await expect(
      queue.enqueueNotificationJob({ messageId: 'm1', recipients: ['u2'] })
    ).resolves.toEqual({ id: 'message:m1' });
    await expect(queue.enqueueEmailJob({ messageId: 'm1', recipientId: 'u2' })).resolves.toEqual({
      id: 'message:m1:recipient:u2',
    });
    const worker = queue.createWorker('notifications', jest.fn());
    await queue.startWorkerHeartbeat({ intervalMs: 60_000 });

    expect(notificationsQueue.name).toBe('notifications');
    expect(worker.name).toBe('notifications');
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      queue.WORKER_HEARTBEAT_KEY,
      expect.any(String),
      'EX',
      45
    );

    await queue.shutdownQueues();
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockRedisClient.quit).toHaveBeenCalled();
  });

  it('reports Redis failures and supports producer-only probes', async () => {
    const queue = require('../../services/queue');

    mockRedisClient.ping.mockRejectedValueOnce(new Error('unreachable'));
    await expect(queue.getQueueHealth({ force: true })).resolves.toMatchObject({
      ready: false,
      reason: 'redis_unreachable',
    });

    await expect(
      queue.getQueueHealth({ force: true, requireWorker: false })
    ).resolves.toMatchObject({ ready: true, worker: 'not_required' });
  });
});
