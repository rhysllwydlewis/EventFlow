'use strict';

/**
 * db-unified turns a failed query into an empty result by default (so most routes
 * degrade quietly). Callers that must tell "nothing there" from "the query failed"
 * (the supplier dashboard) pass { throwOnError: true }. These tests run the REAL
 * db-unified in local-storage mode with a store that throws.
 */

// Never let a unit test reach a real database, whatever the shell environment holds.
delete process.env.MONGODB_URI;
delete process.env.MONGODB_LOCAL_URI;

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const store = require('../../store');
const dbUnified = require('../../db-unified');

describe('db-unified throwOnError', () => {
  beforeAll(async () => {
    await dbUnified.initializeDatabase();
  });

  beforeEach(() => {
    jest.spyOn(store, 'read').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is running against local storage, not a real database', () => {
    expect(dbUnified.getDatabaseType()).toBe('local');
  });

  it('swallows failures by default, as before', async () => {
    expect(await dbUnified.find('things', {})).toEqual([]);
    expect(await dbUnified.findOne('things', {})).toBeNull();
    expect(await dbUnified.count('things', {})).toBe(0);
    expect(await dbUnified.aggregate('things', [])).toEqual([]);
    expect(await dbUnified.findWithOptions('things', {}, { limit: 5 })).toEqual([]);
  });

  it('rethrows when asked to', async () => {
    const strict = { throwOnError: true };

    await expect(dbUnified.find('things', {}, strict)).rejects.toThrow('storage unavailable');
    await expect(dbUnified.findOne('things', {}, strict)).rejects.toThrow('storage unavailable');
    await expect(dbUnified.count('things', {}, strict)).rejects.toThrow('storage unavailable');
    await expect(dbUnified.aggregate('things', [], strict)).rejects.toThrow('storage unavailable');
    await expect(dbUnified.findWithOptions('things', {}, { throwOnError: true })).rejects.toThrow(
      'storage unavailable'
    );
  });

  it('returns normal results when nothing fails, with or without the option', async () => {
    jest.restoreAllMocks();
    jest.spyOn(store, 'read').mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    const strict = { throwOnError: true };

    expect(await dbUnified.find('things', { id: 'a' }, strict)).toEqual([{ id: 'a' }]);
    expect(await dbUnified.findOne('things', { id: 'b' }, strict)).toEqual({ id: 'b' });
    expect(await dbUnified.count('things', {}, strict)).toBe(2);
    expect(await dbUnified.findWithOptions('things', {}, { limit: 1, throwOnError: true })).toEqual(
      [{ id: 'a' }]
    );
  });
});
