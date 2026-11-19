'use strict';

/**
 * Gallery writes must change only the photo involved. The routes used to read the
 * whole `photosGallery` array, edit it and `$set` it back, so two overlapping
 * requests each started from the same copy and the later write discarded the
 * earlier one: a photo reported as uploaded vanished.
 */

const { galleryAppendUpdate, galleryRemoveUpdate } = require('../../utils/supplierGalleryUpdate');

describe('galleryAppendUpdate', () => {
  it('pushes only the new record when the gallery is an array', () => {
    const photo = { id: 'p1', url: '/api/photos/1' };
    expect(galleryAppendUpdate({ photosGallery: [{ id: 'old' }] }, photo)).toEqual({
      $push: { photosGallery: { $each: [photo] } },
    });
  });

  it('pushes onto a supplier with no gallery yet', () => {
    expect(galleryAppendUpdate({}, { id: 'p1' })).toEqual({
      $push: { photosGallery: { $each: [{ id: 'p1' }] } },
    });
  });

  it('accepts several records and extra fields to set in the same write', () => {
    expect(galleryAppendUpdate({}, [{ id: 'a' }, { id: 'b' }], { updatedAt: 'now' })).toEqual({
      $push: { photosGallery: { $each: [{ id: 'a' }, { id: 'b' }] } },
      $set: { updatedAt: 'now' },
    });
  });

  it('replaces a legacy null gallery instead of pushing onto it, which MongoDB rejects', () => {
    expect(galleryAppendUpdate({ photosGallery: null }, { id: 'a' }, { updatedAt: 'now' })).toEqual(
      {
        $set: { photosGallery: [{ id: 'a' }], updatedAt: 'now' },
      }
    );
  });
});

describe('galleryRemoveUpdate', () => {
  const gallery = [{ id: 'p1', url: '/a' }, { id: 'p2', url: '/b' }, { url: '/legacy' }];

  it('pulls a record by id when it has one', () => {
    expect(
      galleryRemoveUpdate({ photosGallery: gallery }, gallery[0], { updatedAt: 'now' })
    ).toEqual({
      $pull: { photosGallery: { id: 'p1' } },
      $set: { updatedAt: 'now' },
    });
  });

  it('pulls a legacy record by URL when it has no id', () => {
    expect(galleryRemoveUpdate({ photosGallery: gallery }, gallery[2])).toEqual({
      $pull: { photosGallery: { url: '/legacy' } },
    });
  });

  it('returns null when several records share the identity, so the caller falls back', () => {
    const duplicated = [{ url: '/same' }, { url: '/same' }];
    expect(galleryRemoveUpdate({ photosGallery: duplicated }, duplicated[0])).toBeNull();
  });

  it('returns null for a non-array gallery or a photo with no usable identity', () => {
    expect(galleryRemoveUpdate({ photosGallery: null }, { id: 'p1' })).toBeNull();
    expect(galleryRemoveUpdate({ photosGallery: [{}] }, {})).toBeNull();
    expect(galleryRemoveUpdate({ photosGallery: gallery }, null)).toBeNull();
  });
});

describe('overlapping gallery writes through the local store', () => {
  let dbUnified;
  let storeData;

  beforeEach(async () => {
    jest.resetModules();
    storeData = { suppliers: [{ id: 's1', photosGallery: [{ id: 'existing', url: '/e' }] }] };
    const mockStore = {
      uid: jest.fn(p => `${p}_1`),
      read: jest.fn(name => (storeData[name] || []).map(d => ({ ...d }))),
      write: jest.fn((name, data) => {
        storeData[name] = data.map(d => ({ ...d }));
      }),
    };
    jest.mock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.mock('../../store', () => mockStore);
    dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
  });

  const urls = () => storeData.suppliers[0].photosGallery.map(p => p.url);

  it('the old read-modify-write approach loses a photo (the bug)', async () => {
    // Both requests read the supplier before either has written.
    const readA = (await dbUnified.read('suppliers'))[0];
    const readB = (await dbUnified.read('suppliers'))[0];
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      { $set: { photosGallery: [...readA.photosGallery, { id: 'a', url: '/a' }] } }
    );
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      { $set: { photosGallery: [...readB.photosGallery, { id: 'b', url: '/b' }] } }
    );
    expect(urls()).toEqual(['/e', '/b']); // '/a' was uploaded and then discarded
  });

  it('two overlapping uploads both persist', async () => {
    const readA = (await dbUnified.read('suppliers'))[0];
    const readB = (await dbUnified.read('suppliers'))[0];
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      galleryAppendUpdate(readA, { id: 'a', url: '/a' }, { updatedAt: 't1' })
    );
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      galleryAppendUpdate(readB, { id: 'b', url: '/b' }, { updatedAt: 't2' })
    );
    expect(urls()).toEqual(['/e', '/a', '/b']);
  });

  it('a delete that overlaps an upload keeps the upload', async () => {
    const stale = (await dbUnified.read('suppliers'))[0];
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      galleryAppendUpdate(stale, { id: 'new', url: '/new' })
    );
    // The delete was decided from the stale read, before '/new' existed.
    await dbUnified.updateOne(
      'suppliers',
      { id: 's1' },
      galleryRemoveUpdate(stale, stale.photosGallery[0], { updatedAt: 't3' })
    );
    expect(urls()).toEqual(['/new']);
    expect(storeData.suppliers[0].updatedAt).toBe('t3');
  });
});
