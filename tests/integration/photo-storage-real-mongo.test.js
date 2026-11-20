'use strict';

/**
 * Storing uploaded photos in a REAL MongoDB.
 *
 * db-unified.js puts a unique index on photos.id, and a document without that field counts as
 * `null` there, so the image documents photo-upload.js stored (which had only `_id`) collided:
 * in a database built by this code, the first photo upload failed with HTTP 503 "Photo storage
 * unavailable" (E11000 duplicate key, id: null). A fake database has no such index, so the ordinary
 * unit tests could not see it. This runs in the replica-set CI job (MONGO_REPLICA_SET=true):
 *
 *   MONGO_REPLICA_SET=true MONGODB_URI='mongodb://127.0.0.1:27017/x?replicaSet=rs0' \
 *     npx jest tests/integration/photo-storage-real-mongo.test.js
 */

const zlib = require('zlib');
const { MongoClient } = require('mongodb');

const describeRealMongo = process.env.MONGO_REPLICA_SET === 'true' ? describe : describe.skip;
const DB_NAME = `eventflow_photo_storage_${process.pid}_${Date.now()}`;

// A real, solid-colour 64x64 PNG (the validator checks dimensions).
function solidPng(size) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const byte of buf) {
      c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(size).fill([200, 60, 90]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describeRealMongo('photo storage (real MongoDB, unique index on photos.id)', () => {
  let client;
  let raw;
  let photoUpload;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0';
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    raw = client.db(DB_NAME);
    process.env.MONGODB_URI = uri.replace(/\/[^/?]*(\?|$)/, `/${DB_NAME}$1`);
    process.env.MONGODB_DB_NAME = DB_NAME;
    jest.resetModules();
    const dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
    photoUpload = require('../../photo-upload');
  });

  afterAll(async () => {
    if (raw) {
      await raw.dropDatabase();
    }
    if (client) {
      await client.close();
    }
  });

  it('really has the unique index on photos.id that the application creates', async () => {
    const indexes = await raw.collection('photos').indexes();
    const byId = indexes.find(index => index.key && index.key.id === 1);
    expect(byId && byId.unique).toBe(true);
  });

  it('stores the four sizes of one upload, and then another upload', async () => {
    const png = solidPng(64);
    const first = await photoUpload.processAndSaveImage(png, 'first.png', 'supplier');
    const second = await photoUpload.processAndSaveImage(png, 'second.png', 'supplier');
    for (const result of [first, second]) {
      expect(result.original).toMatch(/^\/api\/photos\//);
      expect(result.thumbnail).toMatch(/^\/api\/photos\//);
      expect(result.optimized).toMatch(/^\/api\/photos\//);
      expect(result.large).toMatch(/^\/api\/photos\//);
    }
    expect(await raw.collection('photos').countDocuments({ type: { $exists: true } })).toBe(8);
  });

  it('records whose each stored copy is, only when it is told', async () => {
    const png = solidPng(64);
    const owned = await photoUpload.processAndSaveImage(png, 'owned.png', 'supplier', {
      ownerUserId: 'owner_1',
      uploadedBy: 'admin_9',
    });
    const anonymous = await photoUpload.processAndSaveImage(png, 'anonymous.png', 'supplier');
    const idOf = address => address.split('/').pop();

    for (const address of [owned.original, owned.thumbnail, owned.optimized, owned.large]) {
      const doc = await raw.collection('photos').findOne({ _id: idOf(address) });
      expect(doc.ownerUserId).toBe('owner_1');
      expect(doc.uploadedBy).toBe('admin_9');
    }
    for (const address of [
      anonymous.original,
      anonymous.thumbnail,
      anonymous.optimized,
      anonymous.large,
    ]) {
      const doc = await raw.collection('photos').findOne({ _id: idOf(address) });
      expect(doc).not.toHaveProperty('ownerUserId');
      expect(doc).not.toHaveProperty('uploadedBy');
    }
  });

  it('says whose images are, null for one with no recorded owner or no document', async () => {
    const png = solidPng(64);
    const owned = await photoUpload.processAndSaveImage(png, 'who.png', 'supplier', {
      ownerUserId: 'owner_2',
    });
    const anonymous = await photoUpload.processAndSaveImage(png, 'nobody.png', 'supplier');
    await raw
      .collection('marketplace_images')
      .insertOne({ _id: 'mkt_image_1', userId: 'seller_3', imageData: 'x' });

    const owners = await photoUpload.getImageOwners([
      owned.optimized,
      owned.thumbnail,
      anonymous.optimized,
      '/api/photos/mkt_image_1',
      '/api/photos/does_not_exist',
    ]);

    expect(owners).toEqual({
      [owned.optimized]: 'owner_2',
      [owned.thumbnail]: 'owner_2',
      [anonymous.optimized]: null,
      '/api/photos/mkt_image_1': 'seller_3',
      '/api/photos/does_not_exist': null,
    });
    expect(await photoUpload.getImageOwners([])).toEqual({});
  });

  it('ignores an owner that is not a user id string', async () => {
    const png = solidPng(64);
    const result = await photoUpload.processAndSaveImage(png, 'bad.png', 'supplier', {
      ownerUserId: { $ne: null },
      uploadedBy: 42,
    });
    const doc = await raw.collection('photos').findOne({ _id: result.optimized.split('/').pop() });

    expect(doc).not.toHaveProperty('ownerUserId');
    expect(doc).not.toHaveProperty('uploadedBy');
  });

  it('keeps `id` equal to `_id` so the image is found either way', async () => {
    const doc = await raw.collection('photos').findOne({ type: 'optimized' });
    expect(typeof doc.id).toBe('string');
    expect(doc.id).toBe(doc._id);
  });
});
