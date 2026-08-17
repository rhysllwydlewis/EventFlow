'use strict';

jest.mock('../../db-unified', () => ({
  initializeDatabase: jest.fn().mockResolvedValue('mongodb'),
  getDatabaseType: jest.fn(),
  insertOne: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const logger = require('../../utils/logger');
const { acquireLock, withLock } = require('../../services/schedulerLock.service');

describe('schedulerLock.service — Mongo-backed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.getDatabaseType.mockReturnValue('mongodb');
  });

  it('waits for the database to initialise before checking its type', async () => {
    dbUnified.insertOne.mockResolvedValue({ id: 'scheduler:my-job' });
    dbUnified.deleteOne.mockResolvedValue(true);

    await acquireLock('my-job');

    expect(dbUnified.initializeDatabase).toHaveBeenCalled();
  });

  it('acquires the lock when the insert succeeds, and releases it via deleteOne', async () => {
    dbUnified.insertOne.mockResolvedValue({ id: 'scheduler:my-job' });
    dbUnified.deleteOne.mockResolvedValue(true);

    const release = await acquireLock('my-job');
    expect(release).toBeInstanceOf(Function);
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      'scheduler_locks',
      expect.objectContaining({ id: 'scheduler:my-job', jobKey: 'my-job' })
    );

    await release();
    expect(dbUnified.deleteOne).toHaveBeenCalledWith('scheduler_locks', { id: 'scheduler:my-job' });
  });

  it('fails to acquire when insertOne returns null (duplicate-key / already held)', async () => {
    dbUnified.insertOne.mockResolvedValue(null);

    const release = await acquireLock('my-job');
    expect(release).toBeNull();
  });

  it('withLock skips the work function and returns skipped when the lock is held', async () => {
    dbUnified.insertOne.mockResolvedValue(null);
    const fn = jest.fn();

    const result = await withLock('my-job', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: true, reason: 'locked' });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('already running elsewhere'));
  });

  it('withLock runs the work function and releases the lock afterwards', async () => {
    dbUnified.insertOne.mockResolvedValue({ id: 'scheduler:my-job' });
    dbUnified.deleteOne.mockResolvedValue(true);
    const fn = jest.fn().mockResolvedValue({ ok: true });

    const result = await withLock('my-job', fn);

    expect(result).toEqual({ ok: true });
    expect(dbUnified.deleteOne).toHaveBeenCalledWith('scheduler_locks', { id: 'scheduler:my-job' });
  });

  it('withLock releases the lock even when the work function throws', async () => {
    dbUnified.insertOne.mockResolvedValue({ id: 'scheduler:my-job' });
    dbUnified.deleteOne.mockResolvedValue(true);
    const boom = new Error('boom');

    await expect(
      withLock('my-job', async () => {
        throw boom;
      })
    ).rejects.toThrow('boom');

    expect(dbUnified.deleteOne).toHaveBeenCalledWith('scheduler_locks', { id: 'scheduler:my-job' });
  });
});

describe('schedulerLock.service — local-store fallback (no MongoDB)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.getDatabaseType.mockReturnValue('local');
  });

  it('acquires and releases without touching the database', async () => {
    const release = await acquireLock('local-job');
    expect(release).toBeInstanceOf(Function);
    expect(dbUnified.insertOne).not.toHaveBeenCalled();

    // A second acquire before release fails — same in-process guarantee the
    // old `_running` booleans gave within a single process.
    const second = await acquireLock('local-job');
    expect(second).toBeNull();

    await release();
    const third = await acquireLock('local-job');
    expect(third).toBeInstanceOf(Function);
  });
});
