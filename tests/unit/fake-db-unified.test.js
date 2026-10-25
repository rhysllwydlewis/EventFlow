'use strict';

/**
 * The in-memory stand-in must behave like db-unified where tests lean on it: writes answer
 * booleans the same way, and a failing collection fails writes as well as reads, swallowed unless
 * `{ throwOnError: true }` is passed.
 */

const fakeDb = require('../helpers/fake-db-unified');

beforeEach(() => {
  fakeDb.__reset({ things: [{ id: 'a', n: 1 }] });
});

describe('updateOne', () => {
  it('is true only when something changed, like db-unified (modifiedCount > 0)', async () => {
    expect(await fakeDb.updateOne('things', { id: 'a' }, { $set: { n: 2 } })).toBe(true);
    expect(await fakeDb.updateOne('things', { id: 'a' }, { $set: { n: 2 } })).toBe(false);
    expect(await fakeDb.updateOne('things', { id: 'missing' }, { $set: { n: 3 } })).toBe(false);
    expect(fakeDb.__store().things[0].n).toBe(2);
  });
});

describe('a failing collection', () => {
  it.each([
    ['read', name => fakeDb.read(name, { throwOnError: true }), name => fakeDb.read(name)],
    [
      'insertOne',
      name => fakeDb.insertOne(name, { id: 'b' }, { throwOnError: true }),
      name => fakeDb.insertOne(name, { id: 'b' }),
    ],
    [
      'updateOne',
      name => fakeDb.updateOne(name, { id: 'a' }, { $set: { n: 9 } }, { throwOnError: true }),
      name => fakeDb.updateOne(name, { id: 'a' }, { $set: { n: 9 } }),
    ],
    [
      'deleteOne',
      name => fakeDb.deleteOne(name, { id: 'a' }, { throwOnError: true }),
      name => fakeDb.deleteOne(name, { id: 'a' }),
    ],
  ])('%s throws only when asked, and is otherwise swallowed', async (_label, strict, lenient) => {
    fakeDb.__failOn('things');

    await expect(strict('things')).rejects.toThrow('fake db failure on things');
    const swallowed = await lenient('things');
    expect(Array.isArray(swallowed) ? swallowed.length : swallowed).toBeFalsy();
    // Nothing was written by a failed write.
    expect(fakeDb.__store().things).toEqual([{ id: 'a', n: 1 }]);
  });

  it('leaves other collections alone', async () => {
    fakeDb.__failOn('things');

    await expect(fakeDb.insertOne('other', { id: 'x' }, { throwOnError: true })).resolves.toEqual({
      id: 'x',
    });
  });
});
