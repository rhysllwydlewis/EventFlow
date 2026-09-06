'use strict';

const mockQueueAdd = jest.fn(async (_name, _data, options) => ({ id: options.jobId }));
const mockQueueClose = jest.fn(async () => {});
const mockWorkerClose = jest.fn(async () => {});
const mockRedisMultiExec = jest.fn(async () => []);
const mockRedisMulti = {
  zadd: jest.fn(() => mockRedisMulti),
  zremrangebyscore: jest.fn(() => mockRedisMulti),
  expire: jest.fn(() => mockRedisMulti),
  exec: mockRedisMultiExec,
};
const mockRedisClient = {
  ping: jest.fn(async () => 'PONG'),
  zrevrange: jest.fn(async () => ['worker-1', String(Date.now())]),
  multi: jest.fn(() => mockRedisMulti),
  zrem: jest.fn(async () => 1),
  quit: jest.fn(async () => 'OK'),
  on: jest.fn(),
};
const mockWorkers = [];

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedisClient));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(name => ({
    name,
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation((name, processor) => {
    const handlers = {};
    const worker = {
      name,
      processor,
      close: mockWorkerClose,
      isRunning: jest.fn(() => true),
      waitUntilReady: jest.fn(async () => {}),
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
        return worker;
      }),
      handlers,
    };
    mockWorkers.push(worker);
    return worker;
  }),
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
    mockWorkers.length = 0;
    mockRedisClient.zrevrange.mockResolvedValue(['worker-1', String(Date.now())]);
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
    expect(mockRedisClient.zrevrange).toHaveBeenCalledWith(
      queue.WORKER_HEARTBEAT_KEY,
      0,
      0,
      'WITHSCORES'
    );
  });

  it('runs queue operations, heartbeat startup and orderly shutdown', async () => {
    const queue = require('../../services/queue');
    const { notificationsQueue, useStub } = queue.getQueues();

    expect(useStub).toBe(false);
    expect(queue.QUEUE_NAMESPACE).toBe('bull');
    await expect(
      queue.enqueueNotificationJob({ messageId: 'm1', recipients: ['u2'] })
    ).resolves.toEqual({ id: queue.notificationJobId('m1') });
    await expect(queue.enqueueEmailJob({ messageId: 'm1', recipientId: 'u2' })).resolves.toEqual({
      id: queue.emailJobId('m1', 'u2'),
    });
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      1,
      'fanout',
      expect.any(Object),
      expect.objectContaining({
        jobId: queue.notificationJobId('m1'),
        removeOnFail: true,
      })
    );
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      2,
      'send-email',
      expect.any(Object),
      expect.objectContaining({
        jobId: queue.emailJobId('m1', 'u2'),
        removeOnFail: 500,
      })
    );
    const worker = queue.createWorker('notifications', jest.fn());
    queue.createWorker('email', jest.fn());
    await queue.startWorkerHeartbeat({ intervalMs: 60_000 });

    expect(notificationsQueue.name).toBe('notifications');
    expect(worker.name).toBe('notifications');
    expect(mockRedisMulti.zadd).toHaveBeenCalledWith(
      queue.WORKER_HEARTBEAT_KEY,
      expect.any(Number),
      queue.WORKER_INSTANCE_ID
    );
    expect(queue.isWorkerFleetReady()).toBe(true);

    await queue.shutdownQueues();
    expect(mockRedisClient.zrem).toHaveBeenCalledWith(
      queue.WORKER_HEARTBEAT_KEY,
      queue.WORKER_INSTANCE_ID
    );
    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockRedisClient.quit).toHaveBeenCalled();
  });

  it('uses deterministic BullMQ-safe IDs and refuses heartbeat before both workers are ready', async () => {
    const queue = require('../../services/queue');

    expect(queue.notificationJobId('m1')).toBe(queue.notificationJobId('m1'));
    expect(queue.notificationJobId('m1')).not.toContain(':');
    expect(queue.emailJobId('m1', 'u2')).not.toContain(':');
    expect(queue.emailJobId('m1', 'u2')).not.toBe(queue.emailJobId('m1', 'u3'));

    queue.createWorker('notifications', jest.fn());
    await expect(queue.startWorkerHeartbeat()).rejects.toThrow(/failed readiness checks/);
    await queue.shutdownQueues();
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

  it('rejects an unsafe namespace before connecting to Redis', () => {
    process.env.EVENTFLOW_QUEUE_NAMESPACE = 'unsafe namespace';

    expect(() => require('../../services/queue')).toThrow(/EVENTFLOW_QUEUE_NAMESPACE/);
  });
});
