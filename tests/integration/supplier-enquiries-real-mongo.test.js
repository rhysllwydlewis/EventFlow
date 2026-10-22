'use strict';

/**
 * The supplier dashboard's enquiry data in a REAL MongoDB, which the fake database in the unit
 * tests cannot show:
 *
 *  - the indexes the application creates exist, and the queries the dashboard runs use them
 *    (no collection scan) once a supplier has thousands of enquiries and visits;
 *  - the list, the counts and the dashboard summary agree at that size;
 *  - many people (or one double click) setting the status of the same new enquiry at the same time
 *    leave exactly one status document.
 *
 * Runs in the replica-set CI job (MONGO_REPLICA_SET=true):
 *
 *   MONGO_REPLICA_SET=true MONGODB_URI='mongodb://127.0.0.1:27017/x?replicaSet=rs0' \
 *     npx jest tests/integration/supplier-enquiries-real-mongo.test.js
 */

const { MongoClient } = require('mongodb');

const describeRealMongo = process.env.MONGO_REPLICA_SET === 'true' ? describe : describe.skip;
const DB_NAME = `eventflow_enquiries_${process.pid}_${Date.now()}`;
const SUPPLIER = 'sup_scale';
const OTHER = 'sup_other';
const QUOTES = 2500;
const CONTACTS = 1500;
const VISITS = 4000;

/** The stage names an explain plan used, from the winning plan down. */
function stagesOf(plan, found = []) {
  if (!plan || typeof plan !== 'object') {
    return found;
  }
  if (plan.stage) {
    found.push(plan.stage);
  }
  ['inputStage', 'queryPlan'].forEach(key => stagesOf(plan[key], found));
  (plan.inputStages || []).forEach(stage => stagesOf(stage, found));
  (plan.shards || []).forEach(shard => stagesOf(shard.winningPlan, found));
  return found;
}

async function planFor(cursor) {
  const explained = await cursor.explain('queryPlanner');
  const winning =
    explained.queryPlanner?.winningPlan ||
    explained.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ||
    {};
  return stagesOf(winning);
}

describeRealMongo('supplier enquiries and dashboard (real MongoDB)', () => {
  let client;
  let raw;
  let dbUnified;
  let enquiries;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0';
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    raw = client.db(DB_NAME);
    process.env.MONGODB_URI = uri.replace(/\/[^/?]*(\?|$)/, `/${DB_NAME}$1`);
    process.env.MONGODB_DB_NAME = DB_NAME;
    jest.resetModules();
    dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
    enquiries = require('../../services/supplierEnquiries');

    const now = Date.now();
    const iso = offsetMinutes => new Date(now - offsetMinutes * 60000).toISOString();
    await raw.collection('quoteRequests').insertMany([
      ...Array.from({ length: QUOTES }, (_, i) => ({
        id: `qr_${i}`,
        name: `Customer ${i}`,
        email: `c${i}@example.com`,
        notes: 'Looking for a quote',
        suppliers: [{ supplierId: SUPPLIER }, { supplierId: `sup_noise_${i % 50}` }],
        createdAt: iso(i + 1),
      })),
      ...Array.from({ length: QUOTES }, (_, i) => ({
        id: `qr_o${i}`,
        name: `Other ${i}`,
        email: `o${i}@example.com`,
        notes: 'For somebody else',
        suppliers: [{ supplierId: OTHER }],
        createdAt: iso(i + 1),
      })),
    ]);
    await raw.collection('enquiries').insertMany([
      ...Array.from({ length: CONTACTS }, (_, i) => ({
        id: `enq_${i}`,
        supplierId: SUPPLIER,
        senderName: `Sender ${i}`,
        senderEmail: `s${i}@example.com`,
        message: 'Do you cover my area?',
        createdAt: iso(i + 1),
      })),
      ...Array.from({ length: CONTACTS }, (_, i) => ({
        id: `enq_o${i}`,
        supplierId: OTHER,
        senderName: `Other ${i}`,
        senderEmail: `x${i}@example.com`,
        message: 'Not for this supplier',
        createdAt: iso(i + 1),
      })),
    ]);
    await raw.collection('events').insertMany(
      Array.from({ length: VISITS }, (_, i) => ({
        id: `ev_${i}`,
        type: 'profile_view',
        supplierId: i % 4 === 0 ? OTHER : SUPPLIER,
        visitorKey: `a:${i % 700}`,
        timestamp: iso(i + 1),
      }))
    );
  }, 120000);

  afterAll(async () => {
    if (raw) {
      await raw.dropDatabase();
    }
    if (client) {
      await client.close();
    }
  });

  it('creates the indexes the dashboard queries need', async () => {
    const indexNames = async name =>
      (await raw.collection(name).indexes()).map(index => JSON.stringify(index.key));
    expect(await indexNames('quoteRequests')).toContain(
      JSON.stringify({ 'suppliers.supplierId': 1, createdAt: -1 })
    );
    expect(await indexNames('enquiries')).toContain(
      JSON.stringify({ supplierId: 1, createdAt: -1 })
    );
    expect(await indexNames('events')).toContain(JSON.stringify({ supplierId: 1, timestamp: -1 }));
    const states = (await raw.collection('supplier_enquiry_states').indexes()).find(
      index => index.key.id === 1
    );
    expect(states && states.unique).toBe(true);
  });

  it('reads one supplier’s quote requests, contact messages and visits through an index', async () => {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const quotePlan = await planFor(
      raw
        .collection('quoteRequests')
        .find({ 'suppliers.supplierId': SUPPLIER, createdAt: { $gte: since } })
    );
    const contactPlan = await planFor(
      raw.collection('enquiries').find({ supplierId: SUPPLIER, createdAt: { $gte: since } })
    );
    const eventPlan = await planFor(
      raw.collection('events').find({ supplierId: SUPPLIER, timestamp: { $gte: since } })
    );
    for (const stages of [quotePlan, contactPlan, eventPlan]) {
      expect(stages).toContain('IXSCAN');
      expect(stages).not.toContain('COLLSCAN');
    }
  });

  it('lists and counts thousands of enquiries correctly, and only this supplier’s', async () => {
    const started = Date.now();
    const result = await enquiries.listEnquiries({
      supplierId: SUPPLIER,
      query: { days: '90', limit: '100' },
    });
    const took = Date.now() - started;

    // Each source is capped at 1000 records per window so one supplier cannot make a request huge.
    expect(result.counts.bySource.quoteRequests).toBe(1000);
    expect(result.counts.bySource.contactForm).toBe(1000);
    expect(result.counts.total).toBe(2000);
    expect(result.enquiries).toHaveLength(100);
    expect(result.enquiries.every(item => !String(item.id).includes('_o'))).toBe(true);
    expect(took).toBeLessThan(5000);
  });

  it('keeps the list, the status filter and the counts in step once enquiries are marked', async () => {
    await enquiries.setEnquiryStatus(SUPPLIER, 'qr_0', 'handled');
    await enquiries.setEnquiryStatus(SUPPLIER, 'enq_0', 'read');
    const all = await enquiries.listEnquiries({ supplierId: SUPPLIER, query: { limit: '100' } });
    expect(all.counts.new).toBe(all.counts.total - 2);
    const handled = await enquiries.listEnquiries({
      supplierId: SUPPLIER,
      query: { status: 'handled' },
    });
    expect(handled.enquiries.map(item => item.id)).toEqual(['qr_0']);
  });

  it('leaves exactly one status document when the same new enquiry is marked many times at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        enquiries.setEnquiryStatus(SUPPLIER, 'qr_7', i % 2 ? 'read' : 'handled')
      )
    );
    expect(results.every(Boolean)).toBe(true);
    const docs = await raw
      .collection('supplier_enquiry_states')
      .find({ id: `${SUPPLIER}:qr_7` })
      .toArray();
    expect(docs).toHaveLength(1);
    expect(['read', 'handled']).toContain(docs[0].status);
    expect(typeof docs[0].createdAt).toBe('string');
  });

  it('does not let a status for another supplier’s enquiry be created', async () => {
    expect(await enquiries.setEnquiryStatus(SUPPLIER, 'qr_o1', 'read')).toBeNull();
    expect(
      await raw.collection('supplier_enquiry_states').countDocuments({ enquiryId: 'qr_o1' })
    ).toBe(0);
  });

  it('counts different visitors, not page loads, for the dashboard summary', async () => {
    const { buildDashboardSummary } = require('../../services/supplierDashboardSummary');
    const started = Date.now();
    const summary = await buildDashboardSummary({
      userId: 'user_scale',
      supplier: { id: SUPPLIER, ownerUserId: 'user_scale', name: 'Scale Ltd', approved: true },
      requestedDays: 90,
    });
    expect(summary.views.total).toBeGreaterThan(0);
    expect(summary.views.uniqueVisitors).toBeGreaterThan(0);
    expect(summary.views.uniqueVisitors).toBeLessThanOrEqual(summary.views.total);
    // 700 different visitor keys were generated for this supplier's and the other's visits.
    expect(summary.views.uniqueVisitors).toBeLessThanOrEqual(700);
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
