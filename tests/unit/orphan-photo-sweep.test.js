/**
 * Sweeping stored photo images that nothing uses.
 *
 * The risk is deleting an image that is still in use, so most of these tests are about what must
 * be KEPT: an address found anywhere in any other collection, anything young, anything undated,
 * and the whole run when the scan looks wrong.
 *
 * @jest-environment node
 */
'use strict';

const { matches } = require('../helpers/mongo-style-db');
const { sweepOrphanPhotos, referencedPhotoIds } = require('../../utils/orphanPhotoSweep');

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const daysAgo = days => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

/** The few MongoDB calls the sweep makes, over in-memory collections. */
function fakeDb(collections) {
  const store = JSON.parse(JSON.stringify(collections));
  const calls = { deleteMany: [] };
  const cursor = documents => ({
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () =>
          index < documents.length ? { value: documents[index++], done: false } : { done: true },
      };
    },
  });
  return {
    store,
    calls,
    listCollections: () => ({
      toArray: async () => Object.keys(store).map(name => ({ name })),
    }),
    collection: name => ({
      find: (filter = {}) => cursor((store[name] || []).filter(doc => matches(doc, filter))),
      deleteMany: async filter => {
        calls.deleteMany.push(filter);
        const before = (store[name] || []).length;
        store[name] = (store[name] || []).filter(doc => !matches(doc, filter));
        return { deletedCount: before - store[name].length };
      },
    }),
  };
}

const image = (id, extra = {}) => ({
  _id: id,
  id,
  type: 'optimized',
  size: 1000,
  createdAt: daysAgo(60),
  ...extra,
});

/**
 * Six images that are in use, referenced from a collection no test touches, so that the orphans a
 * test adds are well under half of all the images (a sweep that would delete more than half is
 * refused) and the run is not refused for finding no references.
 */
const ANCHOR_IDS = Array.from({ length: 6 }, (_, i) => `anchor_${i}`);
const withAnchor = (photos, more = {}) => ({
  anchor_refs: [{ photos: ANCHOR_IDS.map(id => `/api/photos/${id}`) }],
  ...more,
  photos: [...ANCHOR_IDS.map(id => image(id)), ...photos],
});

const idsLeft = db => db.store.photos.map(doc => doc._id).sort();
/** What is left when only the anchors and these ids remain */
const anchorsAnd = (...ids) => [...ANCHOR_IDS, ...ids].sort();

const sweep = (db, options = {}) => sweepOrphanPhotos(db, { now: NOW, ...options });

describe('what counts as an orphan', () => {
  test('an old image nothing refers to is reported by a dry run, and nothing is deleted', async () => {
    const db = fakeDb(withAnchor([image('lonely')]));

    const report = await sweep(db);

    expect(report).toMatchObject({ mode: 'dry run', candidates: 1, deleted: 0, refused: null });
    expect(report.sample).toEqual(['lonely']);
    expect(idsLeft(db)).toEqual(anchorsAnd('lonely'));
    expect(db.calls.deleteMany).toEqual([]);
  });

  test('--apply deletes it, and only it', async () => {
    const db = fakeDb(withAnchor([image('lonely'), image('lonely_two')]));

    const report = await sweep(db, { apply: true });

    expect(report).toMatchObject({ mode: 'apply', candidates: 2, deleted: 2 });
    expect(idsLeft(db)).toEqual(anchorsAnd());
  });

  test.each([
    ['a plain field', { suppliers: [{ id: 'x', logo: '/api/photos/used' }] }],
    [
      'a nested list of objects',
      { packages: [{ id: 'x', gallery: [{ url: '/api/photos/used' }] }] },
    ],
    ['a query string', { users: [{ id: 'x', avatarUrl: '/api/photos/used?w=640' }] }],
    [
      'an absolute address',
      { reviews: [{ id: 'x', photos: ['https://event-flow.co.uk/api/photos/used'] }] },
    ],
    ['the versioned route', { packages: [{ id: 'x', image: '/api/v1/photos/used' }] }],
    [
      'a field nobody has heard of',
      { brand_new_things: [{ a: { b: [{ c: { d: '/api/photos/used' } }] } }] },
    ],
    [
      'text that contains an address',
      { notes: [{ body: 'see <img src="/api/photos/used"> here' }] },
    ],
  ])('an image used by %s is kept', async (_name, others) => {
    const db = fakeDb(withAnchor([image('used'), image('lonely')], others));

    const report = await sweep(db, { apply: true });

    expect(idsLeft(db)).toEqual(anchorsAnd('used'));
    expect(report.kept.used).toBe(ANCHOR_IDS.length + 1); // the anchors and this one
  });

  test('an address that only starts or ends like the id does not protect it', async () => {
    const db = fakeDb(
      withAnchor([image('photo_abc')], {
        suppliers: [
          { id: 'x', logo: '/api/photos/photo_abc_longer' },
          { id: 'y', logo: '/api/photos/prefix_photo_abc' },
          { id: 'z', logo: '/api/photos/other/photo_abc' },
        ],
      })
    );

    await sweep(db, { apply: true });

    // /api/photos/other/photo_abc names the id "other", so none of them is a use of photo_abc
    expect(idsLeft(db)).toEqual(anchorsAnd());
  });

  test('a held (pending) photo uses its images; an approved or rejected one does not', async () => {
    const db = fakeDb(
      withAnchor([image('held_img'), image('approved_img'), image('rejected_img')])
    );
    // Held-photo records live in the same collection as the images
    db.store.photos.push(
      { id: 'r1', status: 'pending', url: '/api/photos/held_img' },
      { id: 'r2', status: 'approved', url: '/api/photos/approved_img' },
      { id: 'r3', status: 'rejected', url: '/api/photos/rejected_img' }
    );

    await sweep(db, { apply: true });

    expect(idsLeft(db).filter(Boolean)).toEqual(anchorsAnd('held_img'));
    expect(db.store.photos.filter(doc => doc.status).map(doc => doc.id)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });

  test('only stored images are ever candidates: records and unknown types are never deleted', async () => {
    const db = fakeDb(withAnchor([image('typed')]));
    db.store.photos.push(
      { id: 'record_1', status: 'approved', url: '/api/photos/zzz' },
      { _id: 'odd', type: 'something_else', createdAt: daysAgo(90) },
      { _id: 'no_type', createdAt: daysAgo(90) }
    );

    await sweep(db, { apply: true });

    expect(db.store.photos.map(doc => doc._id || doc.id).sort()).toEqual(
      [...ANCHOR_IDS, 'no_type', 'odd', 'record_1'].sort()
    );
  });

  test("the marketplace's own image store is neither read nor swept", async () => {
    const db = fakeDb(
      withAnchor([image('lonely')], {
        marketplace_images: [{ _id: 'mkt_1', url: '/api/photos/lonely', userId: 'u' }],
      })
    );

    const report = await sweep(db, { apply: true });

    expect(report.scanned).not.toHaveProperty('marketplace_images');
    expect(db.store.marketplace_images).toHaveLength(1);
    expect(idsLeft(db)).toEqual(anchorsAnd());
  });

  test('system collections are not read', async () => {
    const db = fakeDb(
      withAnchor([image('lonely')], { 'system.views': [{ x: '/api/photos/lonely' }] })
    );

    const report = await sweep(db);

    expect(report.scanned).not.toHaveProperty('system.views');
    expect(report.candidates).toBe(1);
  });
});

describe('what is kept by default', () => {
  test('an image younger than the grace period', async () => {
    const db = fakeDb(withAnchor([image('fresh', { createdAt: daysAgo(3) }), image('old')]));

    const report = await sweep(db, { apply: true });

    expect(idsLeft(db)).toEqual(anchorsAnd('fresh'));
    expect(report.kept.tooRecent).toBe(1);
  });

  test('the grace period is adjustable', async () => {
    const db = fakeDb(withAnchor([image('week_old', { createdAt: daysAgo(10) })]));

    await sweep(db, { apply: true, graceDays: 30 });
    expect(idsLeft(db)).toEqual(anchorsAnd('week_old'));

    await sweep(db, { apply: true, graceDays: 7 });
    expect(idsLeft(db)).toEqual(anchorsAnd());
  });

  test('an image with no readable creation date', async () => {
    const db = fakeDb(
      withAnchor([image('missing', { createdAt: undefined }), image('junk', { createdAt: 'nope' })])
    );

    const report = await sweep(db, { apply: true });

    expect(idsLeft(db)).toEqual(anchorsAnd('junk', 'missing'));
    expect(report.kept.undated).toBe(2);
  });
});

describe('when it refuses to run', () => {
  test('no references anywhere: the scan cannot be trusted, so nothing is deleted even with --apply', async () => {
    const db = fakeDb({ photos: [image('a'), image('b')], suppliers: [] });

    const report = await sweep(db, { apply: true });

    expect(report.refused).toMatch(/no references were found/);
    expect(report.deleted).toBe(0);
    expect(idsLeft(db)).toEqual(['a', 'b']);
    // ...but it still says what it found, so the person looking can see why it is wrong
    expect(report).toMatchObject({ candidates: 2, sample: ['a', 'b'], candidateBytes: 2000 });
  });

  test('no images at all is simply nothing to do', async () => {
    const db = fakeDb({ photos: [], suppliers: [] });

    const report = await sweep(db, { apply: true });

    expect(report).toMatchObject({ refused: null, candidates: 0, deleted: 0 });
  });

  test('more than half the images would go: refused, unless that is allowed', async () => {
    const orphans = Array.from({ length: 7 }, (_, i) => image(`orphan_${i}`));
    const db = fakeDb(withAnchor(orphans)); // 13 images, 7 of them orphans

    const refused = await sweep(db, { apply: true });
    expect(refused.refused).toMatch(/7 of 13 images would be deleted, more than half/);
    expect(refused.deleted).toBe(0);
    expect(idsLeft(db)).toHaveLength(13);
    // The refusal still reports what it found, so whoever decides can inspect it
    expect(refused).toMatchObject({ candidates: 7, byType: { optimized: 7 } });
    expect(refused.sample).toHaveLength(7);

    const allowed = await sweep(db, { apply: true, allowLarge: true });
    expect(allowed).toMatchObject({ refused: null, deleted: 7 });
    expect(idsLeft(db)).toEqual(anchorsAnd());
  });

  test('exactly half is allowed', async () => {
    const orphans = Array.from({ length: 6 }, (_, i) => image(`orphan_${i}`));
    const db = fakeDb(withAnchor(orphans)); // 12 images, 6 of them orphans

    const report = await sweep(db, { apply: true });

    expect(report).toMatchObject({ refused: null, deleted: 6 });
  });
});

describe('limits and the report', () => {
  test('deletes at most `limit` images in a run, and says how many there are', async () => {
    const used = Array.from({ length: 10 }, (_, i) => image(`used_${i}`));
    const orphans = Array.from({ length: 5 }, (_, i) => image(`orphan_${i}`));
    const db = fakeDb({
      suppliers: used.map((photo, i) => ({ id: `s${i}`, logo: `/api/photos/${photo._id}` })),
      photos: [...used, ...orphans],
    });

    const report = await sweep(db, { apply: true, limit: 3 });

    expect(report).toMatchObject({ candidates: 5, deleted: 3 });
    expect(idsLeft(db)).toHaveLength(12);
  });

  test('deletes in batches', async () => {
    const used = Array.from({ length: 700 }, (_, i) => image(`used_${i}`));
    const orphans = Array.from({ length: 450 }, (_, i) => image(`orphan_${i}`));
    const db = fakeDb({
      suppliers: [{ id: 's', gallery: used.map(photo => `/api/photos/${photo._id}`) }],
      photos: [...used, ...orphans],
    });

    const report = await sweep(db, { apply: true });

    expect(report.deleted).toBe(450);
    expect(db.calls.deleteMany.map(filter => filter._id.$in.length)).toEqual([200, 200, 50]);
    // Every batch only matches stored images, whatever else shares a _id
    expect(db.calls.deleteMany.every(filter => Array.isArray(filter.type.$in))).toBe(true);
  });

  test('reports the size, the types, a sample and what was read', async () => {
    const db = fakeDb(
      withAnchor(
        [
          image('a', { type: 'optimized', size: 2048 }),
          image('b', { type: 'thumbnail', size: 1024 }),
          image('c', { type: 'thumbnail', size: 1024 }),
        ],
        { packages: [{ id: 'p1' }, { id: 'p2' }] }
      )
    );
    db.store.photos.push({ id: 'held', status: 'pending', url: '/api/photos/anchor_0' });

    const report = await sweep(db, { allowLarge: true });

    expect(report).toMatchObject({
      imagesTotal: 9,
      candidates: 3,
      candidateBytes: 4096,
      byType: { optimized: 1, thumbnail: 2 },
      scanned: { anchor_refs: 1, packages: 2, 'photos (held)': 1 },
    });
    expect(report.sample).toEqual(['a', 'b', 'c']);
  });

  test('a sample is at most twenty ids', async () => {
    const orphans = Array.from({ length: 30 }, (_, i) => image(`orphan_${i}`));
    const used = Array.from({ length: 40 }, (_, i) => image(`used_${i}`));
    const db = fakeDb({
      suppliers: [{ id: 's', gallery: used.map(photo => `/api/photos/${photo._id}`) }],
      photos: [...used, ...orphans],
    });

    const report = await sweep(db);

    expect(report.candidates).toBe(30);
    expect(report.sample).toHaveLength(20);
  });
});

describe('referencedPhotoIds', () => {
  test('finds every address in a record, however it is written', async () => {
    const db = fakeDb({
      things: [
        {
          a: '/api/photos/one',
          b: ['/api/v1/photos/two?w=1', { c: 'https://x.test/api/photos/three#frag' }],
          d: 'two /api/photos/four and /api/photos/five',
        },
      ],
    });

    const { ids, collections } = await referencedPhotoIds(db);

    expect([...ids].sort()).toEqual(['five', 'four', 'one', 'three', 'two']);
    expect(collections.things).toBe(1);
  });
});
