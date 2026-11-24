/**
 * The local (file-backed) database's `$regex` filter, which runs in the Node process.
 *
 * A pattern is checked by sanitizeRegExp before a RegExp is built from it: a sound pattern behaves
 * exactly as before, and one that backtracks catastrophically, or is not a string at all, is refused
 * (the query fails like any other bad query) rather than run against the data.
 *
 * @jest-environment node
 */
'use strict';

describe('db-unified $regex filter (local storage)', () => {
  let dbUnified;
  let storeData;

  beforeEach(async () => {
    jest.resetModules();
    storeData = {};
    jest.doMock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.doMock('../../store', () => ({
      uid: jest.fn(prefix => `${prefix}_1`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
    storeData.users = [
      { id: 'u1', email: 'alice@example.com', name: 'Alice' },
      { id: 'u2', email: 'bob@example.com', name: 'Bob' },
      { id: 'u3', email: 'carol@sample.org', name: 'Carol' },
    ];
  });

  const ids = rows => rows.map(row => row.id);

  test('a sound pattern matches as before', async () => {
    const rows = await dbUnified.find('users', { email: { $regex: '@example\\.com$' } });
    expect(ids(rows)).toEqual(['u1', 'u2']);
  });

  test('$options still applies', async () => {
    const rows = await dbUnified.find('users', { name: { $regex: '^ALICE$', $options: 'i' } });
    expect(ids(rows)).toEqual(['u1']);
  });

  test('findOne and count use the same check', async () => {
    expect((await dbUnified.findOne('users', { name: { $regex: '^Bo' } })).id).toBe('u2');
    expect(await dbUnified.count('users', { email: { $regex: 'example' } })).toBe(2);
  });

  test('a catastrophic pattern is refused before it is built', async () => {
    // The stored rows are short, so if the refusal ever broke this would fail fast instead of
    // running the pattern on data that makes it hang
    await expect(
      dbUnified.find('users', { email: { $regex: '(a+)+$' } }, { throwOnError: true })
    ).rejects.toThrow(/cannot repeat a group/);
  });

  test('a refused pattern fails the query the way any bad query fails: no rows, not a crash', async () => {
    expect(await dbUnified.find('users', { email: { $regex: '(a*)*' } })).toEqual([]);
  });

  test.each([
    ['an object', { $ne: 'x' }],
    ['a number', 5],
    ['an array', ['a']],
  ])('a pattern that is %s is refused', async (_name, pattern) => {
    await expect(
      dbUnified.find('users', { email: { $regex: pattern } }, { throwOnError: true })
    ).rejects.toThrow(/must be a string/);
  });

  test('an over-long pattern is refused', async () => {
    await expect(
      dbUnified.find('users', { email: { $regex: 'a'.repeat(1001) } }, { throwOnError: true })
    ).rejects.toThrow(/longer than/);
  });
});
