'use strict';

/**
 * Replying to a review against a REAL MongoDB.
 *
 * MongoDB gives every inserted document an `_id`. A review written by the older form therefore has
 * both its own `id` and an `_id`, which a fake test database never adds, so the bug that made
 * "Review not found" appear when a supplier replied to such a review could not be seen in the
 * ordinary unit tests. This runs in the replica-set CI job (MONGO_REPLICA_SET=true) and against
 * any local MongoDB:
 *
 *   MONGO_REPLICA_SET=true MONGODB_URI='mongodb://127.0.0.1:27017/x?replicaSet=rs0' \
 *     npx jest tests/integration/review-reply-real-mongo.test.js
 */

const { MongoClient } = require('mongodb');

const describeRealMongo = process.env.MONGO_REPLICA_SET === 'true' ? describe : describe.skip;
const DB_NAME = `eventflow_review_reply_${process.pid}_${Date.now()}`;
const REPLY = 'Thank you for the kind words, we loved the day too.';

describeRealMongo('replying to a review (real MongoDB)', () => {
  let client;
  let raw;
  let dbUnified;
  let reviewService;
  let reviewShape;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0';
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    raw = client.db(DB_NAME);
    // The application code reads and writes the database named here.
    process.env.MONGODB_URI = uri.replace(/\/[^/?]*(\?|$)/, `/${DB_NAME}$1`);
    process.env.MONGODB_DB_NAME = DB_NAME;
    jest.resetModules();
    dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
    reviewService = require('../../services/reviewService');
    reviewShape = require('../../utils/reviewShape');
  });

  afterEach(async () => {
    await raw.collection('reviews').deleteMany({});
  });

  afterAll(async () => {
    if (raw) {
      await raw.dropDatabase();
    }
    if (client) {
      await client.close();
    }
  });

  async function insertLegacyReview() {
    const review = {
      id: 'legacy-review-1',
      supplierId: 'sup-1',
      userId: 'cust-1',
      userName: 'Sam T.',
      rating: 4,
      comment: 'Older form review.',
      approved: true,
      approvedBy: 'system',
      createdAt: '2026-05-01T12:00:00.000Z',
    };
    const { insertedId } = await raw.collection('reviews').insertOne({ ...review });
    return { review, insertedId };
  }

  it('MongoDB really does add an _id to a review that has its own id (the premise)', async () => {
    const { insertedId } = await insertLegacyReview();
    const stored = await raw.collection('reviews').findOne({ id: 'legacy-review-1' });
    expect(String(stored._id)).toBe(String(insertedId));
    expect(stored.id).toBe('legacy-review-1');
  });

  it('lets the supplier reply to a legacy review by its own id', async () => {
    await insertLegacyReview();
    const updated = await reviewService.addSupplierResponse('legacy-review-1', 'sup-1', REPLY, 'u');
    expect(updated.response.text).toBe(REPLY);

    const stored = await raw.collection('reviews').findOne({ id: 'legacy-review-1' });
    expect(stored.response.text).toBe(REPLY);
    // Only the reply was written: the rest of the stored review is as it was.
    expect(stored.comment).toBe('Older form review.');
    expect(stored.approved).toBe(true);
  });

  it('also accepts the _id hex that an already-open dashboard page may still send', async () => {
    const { insertedId } = await insertLegacyReview();
    await reviewService.addSupplierResponse(String(insertedId), 'sup-1', REPLY, 'u');
    const stored = await raw.collection('reviews').findOne({ id: 'legacy-review-1' });
    expect(stored.response.text).toBe(REPLY);
  });

  it('shows the reply on the review when the dashboard lists it', async () => {
    await insertLegacyReview();
    await reviewService.addSupplierResponse('legacy-review-1', 'sup-1', REPLY, 'u');
    const all = await raw.collection('reviews').find({ supplierId: 'sup-1' }).toArray();
    const normal = all.map(reviewShape.normaliseReview);
    expect(normal).toHaveLength(1);
    expect(normal[0]).toMatchObject({ id: 'legacy-review-1', state: 'approved' });
    expect(normal[0].response.text).toBe(REPLY);
  });

  it('refuses a reply from another supplier and writes nothing', async () => {
    await insertLegacyReview();
    await expect(
      reviewService.addSupplierResponse('legacy-review-1', 'someone-else', REPLY, 'u')
    ).rejects.toThrow('Supplier ID mismatch');
    const stored = await raw.collection('reviews').findOne({ id: 'legacy-review-1' });
    expect(stored.response).toBeUndefined();
  });

  it('answers "Review not found" for an id that does not exist', async () => {
    await expect(
      reviewService.addSupplierResponse('does-not-exist', 'sup-1', REPLY, 'u')
    ).rejects.toThrow('Review not found');
  });
});
