/**
 * Deleting the stored images behind a photo that was removed from a gallery.
 *
 * The risk in this code is deleting an image that is still in use, or one that is not the
 * caller's, so most of these tests are about what must be KEPT.
 *
 * @jest-environment node
 */
'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  REFERENCE_FIELDS,
  deleteUnusedStoredCopies,
  photoStoredAddresses,
  storedPhotoId,
} = require('../../utils/photoStoredCopies');
const { createMongoStyleDb } = require('../helpers/mongo-style-db');

// One upload stores four images, each under its own id
const photo = name => ({
  url: `/api/photos/photo_${name}_opt`,
  thumbnail: `/api/photos/photo_${name}_thumb`,
  large: `/api/photos/photo_${name}_large`,
  original: `/api/photos/photo_${name}_orig`,
  approved: true,
});
const gone = photo('gone');
const GONE_ADDRESSES = [gone.url, gone.thumbnail, gone.large, gone.original];

function setup(collections = {}) {
  const db = createMongoStyleDb(collections);
  const dbUnified = { find: jest.fn(db.find) };
  const photoUpload = { deleteImage: jest.fn(async () => undefined) };
  const run = records => deleteUnusedStoredCopies({ dbUnified, photoUpload, records });
  return { db, dbUnified, photoUpload, run };
}

describe('storedPhotoId', () => {
  test.each([
    ['/api/photos/photo_abc123', 'photo_abc123'],
    ['/api/photos/1700000000000-9f8e7d.jpg', '1700000000000-9f8e7d.jpg'],
  ])('%s is a stored photo', (address, id) => {
    expect(storedPhotoId(address)).toBe(id);
  });

  test.each([
    ['an address with another path segment', '/api/photos/photo_a/photo_victim'],
    ['an address with a query', '/api/photos/photo_a?w=640'],
    ['an absolute address', 'https://event-flow.co.uk/api/photos/photo_a'],
    ['a legacy upload path', '/uploads/photo.jpg'],
    ['a dot segment', '/api/photos/..'],
    ['a hidden-file style id', '/api/photos/.photo'],
    ['an empty id', '/api/photos/'],
    ['the versioned api path', '/api/v1/photos/photo_a'],
    ['a missing value', undefined],
    ['a non-string', { url: '/api/photos/photo_a' }],
  ])('%s is not', (_label, address) => {
    expect(storedPhotoId(address)).toBeNull();
  });
});

describe('photoStoredAddresses', () => {
  test('lists the four images an upload stores, in a fixed order', () => {
    expect(photoStoredAddresses(gone)).toEqual(GONE_ADDRESSES);
  });

  test('lists a copy once when two fields name it', () => {
    expect(
      photoStoredAddresses({ url: '/api/photos/photo_a', original: '/api/photos/photo_a' })
    ).toEqual(['/api/photos/photo_a']);
  });

  test('takes a plain address, as a package gallery stores one', () => {
    expect(photoStoredAddresses('/api/photos/photo_a')).toEqual(['/api/photos/photo_a']);
  });

  test('leaves out anything that is not a stored photo address', () => {
    expect(
      photoStoredAddresses({
        url: '/api/photos/photo_a',
        thumbnail: '/uploads/t.jpg',
        large: 'https://example.com/api/photos/photo_b',
        original: '/api/photos/photo_a/photo_victim',
      })
    ).toEqual(['/api/photos/photo_a']);
  });

  test.each([[null], [undefined], [42], [{}], ['']])('finds nothing in %p', record => {
    expect(photoStoredAddresses(record)).toEqual([]);
  });
});

describe('deleteUnusedStoredCopies', () => {
  test('deletes all four stored images when nothing else uses them', async () => {
    const { run, photoUpload } = setup({
      suppliers: [{ id: 's1', photosGallery: [photo('kept')] }],
    });

    const result = await run([gone]);

    expect(photoUpload.deleteImage.mock.calls.map(([address]) => address)).toEqual(GONE_ADDRESSES);
    expect(result).toEqual({ deleted: GONE_ADDRESSES, kept: [] });
  });

  test('deletes the images of every removed record, each once', async () => {
    const { run, photoUpload } = setup();
    const other = photo('other');

    await run([gone, gone, other]);

    expect(photoUpload.deleteImage).toHaveBeenCalledTimes(8);
  });

  test('does nothing for no records, and nothing that is not a stored photo', async () => {
    const { run, photoUpload, dbUnified } = setup();

    await run([]);
    await run(undefined);
    await run([{ url: '/uploads/legacy.jpg' }, 'https://example.com/a.jpg', null]);

    expect(dbUnified.find).not.toHaveBeenCalled();
    expect(photoUpload.deleteImage).not.toHaveBeenCalled();
  });

  test('never deletes an address that names a different image from the one it appears to', async () => {
    const { run, photoUpload } = setup();

    // `deleteImage` deletes by the last path segment, so the second would delete someone else's image
    const result = await run([
      { url: '/api/photos/mine/photo_victim', thumbnail: '/api/photos/..' },
    ]);

    expect(photoUpload.deleteImage).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: [], kept: [] });
  });

  describe('keeps a stored image that something else still uses', () => {
    // Each case puts the THUMBNAIL address in one field of one record; only that copy may be kept.
    const thumbnail = gone.thumbnail;
    const cases = [
      [
        'another supplier gallery photo (url)',
        'suppliers',
        { id: 'x', photosGallery: [{ url: thumbnail }] },
      ],
      [
        'another supplier gallery photo (thumbnail)',
        'suppliers',
        { id: 'x', photosGallery: [{ thumbnail }] },
      ],
      [
        'another supplier gallery photo (large)',
        'suppliers',
        { id: 'x', photosGallery: [{ large: thumbnail }] },
      ],
      [
        'another supplier gallery photo (original)',
        'suppliers',
        { id: 'x', photosGallery: [{ original: thumbnail }] },
      ],
      ['a supplier image list', 'suppliers', { id: 'x', images: ['/a.jpg', thumbnail] }],
      ['a supplier image list of objects', 'suppliers', { id: 'x', images: [{ url: thumbnail }] }],
      ['a supplier logo', 'suppliers', { id: 'x', logo: thumbnail }],
      ['a supplier cover image', 'suppliers', { id: 'x', coverImage: thumbnail }],
      ['a supplier banner', 'suppliers', { id: 'x', bannerUrl: thumbnail }],
      ['a supplier social image', 'suppliers', { id: 'x', openGraphImage: thumbnail }],
      ['a package gallery address', 'packages', { id: 'x', gallery: ['/a.jpg', thumbnail] }],
      ['a package gallery photo (url)', 'packages', { id: 'x', gallery: [{ url: thumbnail }] }],
      ['a package gallery photo (thumbnail)', 'packages', { id: 'x', gallery: [{ thumbnail }] }],
      ['a package cover image', 'packages', { id: 'x', image: thumbnail }],
      ['a user avatar', 'users', { id: 'x', avatarUrl: thumbnail }],
      ['a marketplace listing image', 'marketplace_listings', { id: 'x', images: [thumbnail] }],
      [
        'a marketplace listing image object',
        'marketplace_listings',
        { id: 'x', images: [{ url: thumbnail }] },
      ],
      ['a category hero image', 'categories', { id: 'x', heroImage: thumbnail }],
      ['a public calendar event image', 'public_calendar_events', { id: 'x', imageUrl: thumbnail }],
      [
        'a public calendar event featured image',
        'public_calendar_events',
        { id: 'x', featuredImageUrl: thumbnail },
      ],
    ];

    test.each(cases)('%s', async (_label, collection, document) => {
      const { run, photoUpload } = setup({ [collection]: [document] });

      const result = await run([gone]);

      expect(result.kept).toEqual([thumbnail]);
      expect(result.deleted).toEqual([gone.url, gone.large, gone.original]);
      expect(photoUpload.deleteImage).not.toHaveBeenCalledWith(thumbnail);
    });

    test('the supplier it was removed from, when another of its records still shows it', async () => {
      // The removed photo is gone from this gallery, but a second record here points at the same image
      const { run, photoUpload } = setup({
        suppliers: [{ id: 's1', photosGallery: [{ url: gone.url, thumbnail: gone.thumbnail }] }],
      });

      const result = await run([gone]);

      expect(result.kept).toEqual([gone.url, gone.thumbnail]);
      expect(photoUpload.deleteImage).toHaveBeenCalledTimes(2);
    });

    test('a reference with a query string or an absolute address', async () => {
      const { run } = setup({
        suppliers: [{ id: 'x', logo: `https://event-flow.co.uk${gone.url}?w=640` }],
        packages: [{ id: 'y', image: `${gone.large}#frag` }],
      });

      const result = await run([gone]);

      expect(result.kept).toEqual([gone.url, gone.large]);
    });

    test('but not an address that only starts or ends like the image id', async () => {
      const { run } = setup({
        suppliers: [
          {
            id: 'x',
            logo: `${gone.url}_extra`,
            coverImage: `/api/photos/prefix_${gone.url.split('/').pop()}`,
            bannerUrl: `/api/photos/other/${gone.url.split('/').pop()}`,
          },
        ],
      });

      const result = await run([gone]);

      // One adds to the end of the id, one to the start, one puts another path segment before it:
      // each names a different address, so none of them is a use of the image
      expect(result.kept).toEqual([]);
      expect(result.deleted).toEqual(GONE_ADDRESSES);
    });

    test('a record that was not removed first still counts as using its own images', async () => {
      // The caller must remove the reference before calling; if it did not, nothing is deleted
      const { run, photoUpload } = setup({ suppliers: [{ id: 's1', photosGallery: [gone] }] });

      const result = await run([gone]);

      expect(result.deleted).toEqual([]);
      expect(photoUpload.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('keeps everything when it cannot be sure', () => {
    test('asks the database to report a failure instead of answering with an empty list', async () => {
      const { run, dbUnified } = setup();

      await run([gone]);

      // dbUnified.find swallows errors and returns [] unless told not to; that would read as "unused"
      for (const call of dbUnified.find.mock.calls) {
        expect(call[2]).toEqual({ throwOnError: true });
      }
      expect(dbUnified.find).toHaveBeenCalledTimes(Object.keys(REFERENCE_FIELDS).length);
    });

    test('when looking for what uses it fails', async () => {
      const { run, dbUnified, photoUpload } = setup();
      dbUnified.find.mockRejectedValueOnce(new Error('database down'));

      const result = await run([gone]);

      expect(result).toEqual({ deleted: [], kept: GONE_ADDRESSES });
      expect(photoUpload.deleteImage).not.toHaveBeenCalled();
    });

    test('when a lookup does not answer with a list', async () => {
      const { run, dbUnified, photoUpload } = setup();
      dbUnified.find.mockResolvedValue(undefined);

      const result = await run([gone]);

      expect(result.deleted).toEqual([]);
      expect(photoUpload.deleteImage).not.toHaveBeenCalled();
    });

    test('and never throws, even with no database layer at all', async () => {
      const photoUpload = { deleteImage: jest.fn() };

      await expect(
        deleteUnusedStoredCopies({ dbUnified: {}, photoUpload, records: [gone] })
      ).resolves.toEqual({ deleted: [], kept: GONE_ADDRESSES });
      expect(photoUpload.deleteImage).not.toHaveBeenCalled();
    });
  });

  test('a failing delete does not stop the others, does not throw, and is reported as kept', async () => {
    const { run, photoUpload } = setup();
    photoUpload.deleteImage.mockImplementation(async address => {
      if (address === gone.thumbnail) {
        throw new Error('storage error');
      }
    });

    const result = await run([gone]);

    expect(photoUpload.deleteImage).toHaveBeenCalledTimes(4);
    expect(result.kept).toEqual([gone.thumbnail]);
    expect(result.deleted).toEqual([gone.url, gone.large, gone.original]);
  });
});

describe('REFERENCE_FIELDS covers the fields that can hold a stored photo address', () => {
  // Every image-like field the data models declare must be either covered by REFERENCE_FIELDS, or
  // listed here with the reason it is not a place a gallery photo can be referenced from. A field
  // missing from both is how an image still in use ends up deleted, so a new one fails this test
  // until someone decides which it is.
  const NOT_REFERENCES = {
    'models/ConversationV4.js': {
      avatar:
        'a chat participant avatar, copied from the user avatar, which is covered (users.avatarUrl)',
      referenceImage: 'an image a customer attaches to a chat: its own upload, not a gallery photo',
    },
    'models/MarketplaceImage.js': {
      imageData: 'the stored image bytes themselves, not a reference to one',
    },
  };

  const covered = new Set(
    Object.values(REFERENCE_FIELDS)
      .flat()
      .map(field => field.split('.')[0])
  );
  const imageLike = /image|logo|avatar|banner|cover|photo|thumb|picture/i;

  const modelsDir = path.join(__dirname, '../../models');
  const found = [];
  for (const file of fs.readdirSync(modelsDir).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(modelsDir, file), 'utf8');
    for (const match of source.matchAll(/^\s+([A-Za-z]+): \{/gm)) {
      if (imageLike.test(match[1])) {
        found.push([`models/${file}`, match[1]]);
      }
    }
  }

  test('the scan found the fields it is meant to', () => {
    const names = found.map(([, name]) => name);
    expect(names).toEqual(expect.arrayContaining(['avatarUrl', 'logo', 'photosGallery', 'image']));
  });

  test.each(found)('%s: %s', (file, field) => {
    const excused = (NOT_REFERENCES[file] || {})[field];
    expect(covered.has(field) || Boolean(excused)).toBe(true);
  });
});
