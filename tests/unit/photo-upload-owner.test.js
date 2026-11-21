/**
 * photo-upload.js records whose each stored image is, and answers it back.
 *
 * Every stored image carries `ownerUserId` (whose supplier, package or account it was uploaded for)
 * and `uploadedBy` (who actually uploaded it), so that deleting a gallery photo can tell an image
 * that is the gallery owner's from one that is somebody else's. `getImageOwners` reads them back in
 * one query per collection. These run the real image processing (sharp) against an in-memory fake
 * of the MongoDB collections.
 *
 * @jest-environment node
 */
'use strict';

const sharp = require('sharp');

const stores = { photos: [], marketplace_images: [] };
const dbFailure = { error: null };
const queries = [];

jest.mock('../../db', () => ({
  isMongoAvailable: jest.fn(async () => true),
  getDb: jest.fn(async () => {
    if (dbFailure.error) {
      throw dbFailure.error;
    }
    return {
      collection: name => ({
        insertOne: async doc => {
          stores[name].push(doc);
        },
        find: filter => ({
          toArray: async () => {
            queries.push({ collection: name, ids: filter._id.$in });
            return stores[name].filter(doc => filter._id.$in.includes(doc._id));
          },
        }),
      }),
    };
  }),
}));

const photoUpload = require('../../photo-upload');

const jpeg = () =>
  sharp({ create: { width: 40, height: 40, channels: 3, background: '#cc6677' } })
    .jpeg()
    .toBuffer();

const idOf = address => address.split('/').pop();

beforeEach(() => {
  stores.photos = [];
  stores.marketplace_images = [];
  dbFailure.error = null;
  queries.length = 0;
});

describe('recording whose an uploaded image is', () => {
  test('every stored copy of an upload carries the owner and the uploader', async () => {
    const result = await photoUpload.processAndSaveImage(await jpeg(), 'a.jpg', 'supplier', {
      ownerUserId: 'owner_1',
      uploadedBy: 'admin_9',
    });

    expect(stores.photos.map(doc => doc.type).sort()).toEqual([
      'large',
      'optimized',
      'original',
      'thumbnail',
    ]);
    for (const doc of stores.photos) {
      expect(doc.ownerUserId).toBe('owner_1');
      expect(doc.uploadedBy).toBe('admin_9');
    }
    expect(stores.photos.map(doc => doc._id)).toContain(idOf(result.optimized));
  });

  test('an avatar records its owner too', async () => {
    const result = await photoUpload.processAndSaveImage(await jpeg(), 'me.jpg', 'avatar', {
      ownerUserId: 'user_5',
      uploadedBy: 'user_5',
    });

    expect(stores.photos).toHaveLength(1);
    expect(stores.photos[0]).toMatchObject({
      _id: idOf(result.optimized),
      type: 'avatar',
      ownerUserId: 'user_5',
      uploadedBy: 'user_5',
    });
  });

  test('an upload with no owner given records none, rather than a wrong one', async () => {
    await photoUpload.processAndSaveImage(await jpeg(), 'a.jpg', 'supplier');

    expect(stores.photos).toHaveLength(4);
    for (const doc of stores.photos) {
      expect(doc).not.toHaveProperty('ownerUserId');
      expect(doc).not.toHaveProperty('uploadedBy');
    }
  });

  test.each([
    ['empty strings', { ownerUserId: '', uploadedBy: '' }],
    ['non-strings', { ownerUserId: 42, uploadedBy: { id: 'x' } }],
    ['null', null],
  ])('owner values that are not real ids (%s) are not recorded', async (_name, owner) => {
    await photoUpload.processAndSaveImage(await jpeg(), 'a.jpg', 'avatar', owner);

    expect(stores.photos[0]).not.toHaveProperty('ownerUserId');
    expect(stores.photos[0]).not.toHaveProperty('uploadedBy');
  });

  test('only the field that is a real id is recorded', async () => {
    await photoUpload.processAndSaveImage(await jpeg(), 'a.jpg', 'avatar', {
      ownerUserId: 'owner_1',
      uploadedBy: '',
    });

    expect(stores.photos[0].ownerUserId).toBe('owner_1');
    expect(stores.photos[0]).not.toHaveProperty('uploadedBy');
  });
});

describe('getImageOwners', () => {
  test('answers each address with its recorded owner, null when there is none', async () => {
    stores.photos.push(
      { _id: 'p_owned', ownerUserId: 'owner_1' },
      { _id: 'p_old' },
      { _id: 'p_badowner', ownerUserId: 7 }
    );

    const owners = await photoUpload.getImageOwners([
      '/api/photos/p_owned',
      '/api/photos/p_old',
      '/api/photos/p_badowner',
      '/api/photos/p_missing',
    ]);

    expect(owners).toEqual({
      '/api/photos/p_owned': 'owner_1',
      '/api/photos/p_old': null,
      '/api/photos/p_badowner': null,
      '/api/photos/p_missing': null,
    });
  });

  test("a marketplace image's owner is the user who uploaded it", async () => {
    stores.marketplace_images.push({ _id: 'm_1', userId: 'seller_3' }, { _id: 'm_2', userId: 9 });

    const owners = await photoUpload.getImageOwners(['/api/photos/m_1', '/api/photos/m_2']);

    expect(owners).toEqual({ '/api/photos/m_1': 'seller_3', '/api/photos/m_2': null });
  });

  test('the owner recorded on a general image wins over the marketplace record', async () => {
    stores.photos.push({ _id: 'shared', ownerUserId: 'owner_1' });
    stores.marketplace_images.push({ _id: 'shared', userId: 'seller_3' });

    const owners = await photoUpload.getImageOwners(['/api/photos/shared']);

    expect(owners['/api/photos/shared']).toBe('owner_1');
  });

  test('looks up the same id once however many addresses name it', async () => {
    stores.photos.push({ _id: 'p_1', ownerUserId: 'owner_1' });

    const owners = await photoUpload.getImageOwners([
      '/api/photos/p_1',
      'https://example.com/api/photos/p_1',
    ]);

    expect(owners).toEqual({
      '/api/photos/p_1': 'owner_1',
      'https://example.com/api/photos/p_1': 'owner_1',
    });
    expect(queries.map(query => query.ids)).toEqual([['p_1'], ['p_1']]);
  });

  test('no addresses means no database access', async () => {
    dbFailure.error = new Error('should not be touched');

    await expect(photoUpload.getImageOwners([])).resolves.toEqual({});
  });

  test('a database failure throws, so the caller keeps every image', async () => {
    dbFailure.error = new Error('database down');

    await expect(photoUpload.getImageOwners(['/api/photos/p_1'])).rejects.toThrow('database down');
  });
});
