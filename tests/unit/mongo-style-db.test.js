/**
 * The in-memory database the photo delete tests use has to behave like MongoDB where those tests
 * depend on it, or a test could pass for a reason that is not true in production.
 *
 * @jest-environment node
 */
'use strict';

const { createMongoStyleDb, matches } = require('../helpers/mongo-style-db');

describe('mongo-style-db matching', () => {
  const supplier = {
    id: 's1',
    logo: '/api/photos/logo_1',
    images: ['/api/photos/a', '/api/photos/b'],
    photosGallery: [{ url: '/api/photos/one' }, { url: '/api/photos/two', thumbnail: '/t2' }],
  };

  test('a dotted path matches when any element of an array matches', () => {
    expect(matches(supplier, { 'photosGallery.url': '/api/photos/two' })).toBe(true);
    expect(matches(supplier, { 'photosGallery.url': '/api/photos/three' })).toBe(false);
  });

  test('a plain value matches an array that contains it', () => {
    expect(matches(supplier, { images: '/api/photos/b' })).toBe(true);
    expect(matches(supplier, { images: '/api/photos/c' })).toBe(false);
  });

  test('$regex looks at every string in an array, and only at strings', () => {
    expect(matches(supplier, { images: { $regex: '/api/photos/b$' } })).toBe(true);
    expect(matches(supplier, { photosGallery: { $regex: 'one' } })).toBe(false);
  });

  test('$or matches when any branch does', () => {
    const filter = { $or: [{ logo: 'nope' }, { 'photosGallery.thumbnail': { $regex: 't2$' } }] };
    expect(matches(supplier, filter)).toBe(true);
    expect(matches(supplier, { $or: [{ logo: 'nope' }, { images: 'nope' }] })).toBe(false);
  });

  test('$in and $ne', () => {
    expect(matches(supplier, { id: { $in: ['x', 's1'] } })).toBe(true);
    expect(matches(supplier, { id: { $ne: 's1' } })).toBe(false);
  });

  test('an operator it does not know throws, instead of matching everything', () => {
    expect(() => matches(supplier, { id: { $near: 1 } })).toThrow(/does not support/);
  });
});

describe('mongo-style-db updates', () => {
  const fixture = {
    suppliers: [{ id: 's1', photosGallery: [{ url: 'a' }, { url: 'b' }] }],
    packages: [{ id: 'p1', gallery: ['x', { url: 'y' }, 'z'], image: 'x' }],
  };

  test('$pull removes the elements an object matches, and equal plain elements', async () => {
    const db = createMongoStyleDb(fixture);
    await db.updateOne('suppliers', { id: 's1' }, { $pull: { photosGallery: { url: 'a' } } });
    await db.updateOne('packages', { id: 'p1' }, { $pull: { gallery: 'x' } });
    await db.updateOne('packages', { id: 'p1' }, { $pull: { gallery: { url: 'y' } } });
    expect(db.collections.suppliers[0].photosGallery).toEqual([{ url: 'b' }]);
    expect(db.collections.packages[0].gallery).toEqual(['z']);
  });

  test('$set and $push change the stored document, and a later find sees it', async () => {
    const db = createMongoStyleDb(fixture);
    await db.updateOne('packages', { id: 'p1' }, { $set: { image: 'q' } });
    await db.updateOne(
      'suppliers',
      { id: 's1' },
      { $push: { photosGallery: { $each: [{ url: 'c' }] } } }
    );
    expect(await db.find('packages', { image: 'q' })).toHaveLength(1);
    expect(await db.find('suppliers', { 'photosGallery.url': 'c' })).toHaveLength(1);
  });

  test('insertOne stores a copy that a later find sees, and answers the document', async () => {
    const db = createMongoStyleDb({ photos: [] });
    const photo = { id: 'p1', status: 'pending' };

    const answer = await db.insertOne('photos', photo);
    photo.status = 'changed afterwards';

    expect(answer).toBe(photo);
    expect(await db.find('photos', { id: 'p1' })).toEqual([{ id: 'p1', status: 'pending' }]);
  });

  test('changing the database does not change the fixture it was built from', async () => {
    const db = createMongoStyleDb(fixture);
    await db.updateOne('suppliers', { id: 's1' }, { $pull: { photosGallery: { url: 'a' } } });
    expect(fixture.suppliers[0].photosGallery).toHaveLength(2);
  });

  test('deleteOne removes one document by id or by filter, and says whether it removed one', async () => {
    const db = createMongoStyleDb({ packages: [{ id: 'a' }, { id: 'b', kind: 'x' }, { id: 'c' }] });

    expect(await db.deleteOne('packages', 'a')).toBe(true);
    expect(await db.deleteOne('packages', { kind: 'x' })).toBe(true);
    expect(await db.deleteOne('packages', 'a')).toBe(false);
    expect(db.collections.packages).toEqual([{ id: 'c' }]);
  });

  test('findOne answers with a copy, so editing the record found does not change what is stored', async () => {
    const db = createMongoStyleDb({ photos: [{ id: 'p1', status: 'pending' }] });

    const found = await db.findOne('photos', { id: 'p1' });
    found.status = 'approved';

    expect(db.collections.photos[0].status).toBe('pending');
  });

  test('read answers with copies, so editing what was read does not change what is stored', async () => {
    const db = createMongoStyleDb(fixture);
    const [supplier] = await db.read('suppliers');
    supplier.photosGallery.splice(0, 1);
    expect(db.collections.suppliers[0].photosGallery).toHaveLength(2);
  });

  test('an update on a document that is not there changes nothing and says so', async () => {
    const db = createMongoStyleDb(fixture);
    expect(await db.updateOne('suppliers', { id: 'nope' }, { $set: { a: 1 } })).toBe(false);
  });

  test('an update operator it does not know throws', async () => {
    const db = createMongoStyleDb(fixture);
    await expect(db.updateOne('suppliers', { id: 's1' }, { $inc: { n: 1 } })).rejects.toThrow(
      /does not support/
    );
  });
});
