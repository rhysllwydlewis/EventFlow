'use strict';

/**
 * The local file-store fallback must apply the same update operators as MongoDB.
 * It used to apply only $set and $unset and silently ignore everything else, so
 * `$push`, `$pull`, `$addToSet` and `$inc` reported success and changed nothing.
 */
describe('db-unified – update operators on local storage', () => {
  let dbUnified;
  let storeData;
  let logger;

  beforeEach(async () => {
    jest.resetModules();
    storeData = {};
    const mockStore = {
      uid: jest.fn(p => `${p}_123`),
      read: jest.fn(name => (storeData[name] ? storeData[name].map(d => ({ ...d })) : [])),
      write: jest.fn((name, data) => {
        storeData[name] = data.map(d => ({ ...d }));
      }),
    };
    jest.mock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.mock('../../store', () => mockStore);
    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    dbUnified = require('../../db-unified');
    logger = require('../../utils/logger');
    await dbUnified.initializeDatabase();
  });

  const seed = docs => {
    storeData.suppliers = docs;
  };
  const stored = id => storeData.suppliers.find(d => d.id === id);

  describe('$push', () => {
    it('appends to an existing array', async () => {
      seed([{ id: 's1', photos: [{ id: 'a' }] }]);
      expect(
        await dbUnified.updateOne('suppliers', { id: 's1' }, { $push: { photos: { id: 'b' } } })
      ).toBe(true);
      expect(stored('s1').photos).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('creates the array when the field is missing', async () => {
      seed([{ id: 's1' }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $push: { photos: { id: 'a' } } });
      expect(stored('s1').photos).toEqual([{ id: 'a' }]);
    });

    it('supports $each', async () => {
      seed([{ id: 's1', tags: ['x'] }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $push: { tags: { $each: ['y', 'z'] } } }
      );
      expect(stored('s1').tags).toEqual(['x', 'y', 'z']);
    });

    it('works on a dotted path', async () => {
      seed([{ id: 's1', meta: { notes: ['a'] } }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $push: { 'meta.notes': 'b' } });
      expect(stored('s1').meta.notes).toEqual(['a', 'b']);
    });

    it('refuses to push onto a non-array, as MongoDB does, and leaves the document alone', async () => {
      seed([{ id: 's1', photos: 'not-an-array' }]);
      expect(await dbUnified.updateOne('suppliers', { id: 's1' }, { $push: { photos: 'a' } })).toBe(
        false
      );
      expect(stored('s1').photos).toBe('not-an-array');
      await expect(
        dbUnified.updateOne(
          'suppliers',
          { id: 's1' },
          { $push: { photos: 'a' } },
          { throwOnError: true }
        )
      ).rejects.toThrow(/requires "photos" to be an array/);
    });
  });

  describe('$addToSet', () => {
    it('adds a value that is not present and ignores one that is', async () => {
      seed([{ id: 's1', badges: ['dbs'] }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $addToSet: { badges: 'licence' } });
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $addToSet: { badges: 'dbs' } });
      expect(stored('s1').badges).toEqual(['dbs', 'licence']);
    });

    it('compares objects by value', async () => {
      seed([{ id: 's1', links: [{ a: 1, b: 2 }] }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $addToSet: { links: { a: 1, b: 2 } } }
      );
      expect(stored('s1').links).toEqual([{ a: 1, b: 2 }]);
    });

    it('supports $each and de-duplicates within it', async () => {
      seed([{ id: 's1', badges: ['a'] }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $addToSet: { badges: { $each: ['a', 'b', 'b', 'c'] } } }
      );
      expect(stored('s1').badges).toEqual(['a', 'b', 'c']);
    });

    it('creates the array when the field is missing', async () => {
      seed([{ id: 's1' }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $addToSet: { badges: 'a' } });
      expect(stored('s1').badges).toEqual(['a']);
    });
  });

  describe('$pull', () => {
    it('removes matching scalar values', async () => {
      seed([{ id: 's1', badges: ['a', 'b', 'a'] }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $pull: { badges: 'a' } });
      expect(stored('s1').badges).toEqual(['b']);
    });

    it('removes elements matching a document condition', async () => {
      seed([{ id: 's1', photos: [{ id: 'a', url: 'u1' }, { id: 'b', url: 'u2' }, { url: 'u3' }] }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $pull: { photos: { id: 'b' } } });
      expect(stored('s1').photos).toEqual([{ id: 'a', url: 'u1' }, { url: 'u3' }]);

      await dbUnified.updateOne('suppliers', { id: 's1' }, { $pull: { photos: { url: 'u3' } } });
      expect(stored('s1').photos).toEqual([{ id: 'a', url: 'u1' }]);
    });

    it('supports operator conditions on scalars', async () => {
      seed([{ id: 's1', scores: [1, 5, 9] }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $pull: { scores: { $gte: 5 } } });
      expect(stored('s1').scores).toEqual([1]);
    });

    it('is a no-op when the field is missing or nothing matches', async () => {
      seed([{ id: 's1' }, { id: 's2', photos: [{ id: 'a' }] }]);
      expect(
        await dbUnified.updateOne('suppliers', { id: 's1' }, { $pull: { photos: { id: 'a' } } })
      ).toBe(true);
      expect(stored('s1').photos).toBeUndefined();
      await dbUnified.updateOne('suppliers', { id: 's2' }, { $pull: { photos: { id: 'zzz' } } });
      expect(stored('s2').photos).toEqual([{ id: 'a' }]);
    });
  });

  describe('$inc', () => {
    it('adds to a number, treats a missing field as zero, and supports negatives', async () => {
      seed([{ id: 's1', views: 2 }, { id: 's2' }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $inc: { views: 3 } });
      await dbUnified.updateOne('suppliers', { id: 's2' }, { $inc: { views: 1 } });
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $inc: { views: -1 } });
      expect(stored('s1').views).toBe(4);
      expect(stored('s2').views).toBe(1);
    });

    it('works on a dotted path', async () => {
      seed([{ id: 's1', stats: { clicks: 1 } }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $inc: { 'stats.clicks': 2 } });
      expect(stored('s1').stats.clicks).toBe(3);
    });

    it('rejects a non-numeric amount and a non-numeric field', async () => {
      seed([{ id: 's1', views: 'many' }]);
      expect(await dbUnified.updateOne('suppliers', { id: 's1' }, { $inc: { views: 1 } })).toBe(
        false
      );
      expect(await dbUnified.updateOne('suppliers', { id: 's1' }, { $inc: { other: 'x' } })).toBe(
        false
      );
      expect(stored('s1').views).toBe('many');
    });
  });

  describe('$unset', () => {
    it('removes a dotted path, leaving siblings in place', async () => {
      seed([{ id: 's1', trust: { dbs: { ok: true }, licence: { ok: true } } }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $unset: { 'trust.dbs': '' } });
      expect(stored('s1').trust).toEqual({ licence: { ok: true } });
    });

    it('is a no-op for a path that does not exist', async () => {
      seed([{ id: 's1', trust: {} }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $unset: { 'trust.dbs.ok': '', nope: '' } }
      );
      expect(stored('s1').trust).toEqual({});
    });
  });

  describe('combining operators', () => {
    it('applies $set with $addToSet and $unset in one update (the trust-badge shape)', async () => {
      seed([{ id: 's1', badges: [], trust: { dbs: { ok: false } }, updatedAt: 'old' }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        {
          $addToSet: { badges: 'dbs' },
          $set: { updatedAt: 'new' },
          $unset: { 'trust.dbs': '' },
        }
      );
      expect(stored('s1')).toEqual({ id: 's1', badges: ['dbs'], trust: {}, updatedAt: 'new' });
    });

    it('does not mutate the stored document when the update fails halfway', async () => {
      seed([{ id: 's1', badges: ['a'], name: 'before', views: 'x' }]);
      const ok = await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $set: { name: 'after' }, $inc: { views: 1 } }
      );
      expect(ok).toBe(false);
      expect(stored('s1').name).toBe('before');
    });
  });

  describe('updateMany', () => {
    it('applies operators to every matching document and only those', async () => {
      seed([
        { id: 's1', category: 'Venues', badges: [] },
        { id: 's2', category: 'Venues', badges: ['x'] },
        { id: 's3', category: 'Catering', badges: [] },
      ]);
      const modified = await dbUnified.updateMany(
        'suppliers',
        { category: 'Venues' },
        { $addToSet: { badges: 'seen' }, $inc: { runs: 1 } }
      );
      expect(modified).toBe(2);
      expect(stored('s1')).toMatchObject({ badges: ['seen'], runs: 1 });
      expect(stored('s2')).toMatchObject({ badges: ['x', 'seen'], runs: 1 });
      expect(stored('s3')).toEqual({ id: 's3', category: 'Catering', badges: [] });
    });
  });

  describe('safety', () => {
    it('logs and ignores an operator it does not support instead of pretending to apply it', async () => {
      seed([{ id: 's1', n: 1 }]);
      await dbUnified.updateOne('suppliers', { id: 's1' }, { $mul: { n: 5 }, $set: { ok: true } });
      expect(stored('s1')).toEqual({ id: 's1', n: 1, ok: true });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('$mul'));
    });

    it('cannot be used to write onto Object.prototype through an operator path', async () => {
      seed([{ id: 's1' }]);
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $push: { '__proto__.polluted': 'x' } }
      );
      await dbUnified.updateOne(
        'suppliers',
        { id: 's1' },
        { $inc: { 'constructor.prototype.hit': 1 } }
      );
      expect({}.polluted).toBeUndefined();
      expect({}.hit).toBeUndefined();
    });

    it('still treats a plain object update (no operators) as $set', async () => {
      seed([{ id: 's1', name: 'a' }]);
      await dbUnified.updateOne('suppliers', 's1', { name: 'b' });
      expect(stored('s1').name).toBe('b');
    });
  });
});
