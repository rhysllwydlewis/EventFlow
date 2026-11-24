/**
 * Issue #1680: the Ops Assistant cannot open a MongoDB connection from its
 * sandbox, so the three data-audit scripts reported "0 findings" against local
 * fallback storage. They now run inside the server behind the existing
 * HMAC-protected ops-bot API. These tests pin the guarantees that make that
 * safe: dry-run only, trimmed output, and "inconclusive" instead of a false
 * clean result.
 */

'use strict';

const mockDb = {
  read: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
  initializeDatabase: jest.fn(),
  getDatabaseStatus: jest.fn(),
  getDatabaseType: jest.fn(),
  getReadFallbackCount: jest.fn(),
};
jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/opsBotHmac');
const audits = require('../../services/opsBotAudits.service');
const listingScript = require('../../scripts/audit-marketplace-listing-locations');
const supplierScript = require('../../scripts/audit-supplier-locations');

const HEALTHY = { type: 'mongodb', connected: true, state: 'connected' };

function seed(collections) {
  mockDb.read.mockImplementation(async name => collections[name] || []);
}

function assertNothingWritten() {
  expect(mockDb.updateOne).not.toHaveBeenCalled();
  expect(mockDb.updateMany).not.toHaveBeenCalled();
  expect(mockDb.deleteMany).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getDatabaseStatus.mockReturnValue(HEALTHY);
  mockDb.getDatabaseType.mockReturnValue('mongodb');
  mockDb.getReadFallbackCount.mockReturnValue(0);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('orphaned supplier data audit', () => {
  const collections = {
    users: [{ id: 'u1' }],
    suppliers: [
      { id: 's1', ownerUserId: 'u1' },
      { id: 's2', ownerUserId: 'deleted-user' },
      { id: 's3' },
    ],
    packages: [
      { id: 'p1', supplierId: 's1' },
      { id: 'p2', supplierId: 'missing-supplier', approved: true },
    ],
    photos: [{ id: 'ph1', supplierId: 'missing-supplier' }],
    supplierAnalytics: [],
    public_calendar_events: [],
    marketplace_listings: [],
  };

  it('returns counts only and never writes', async () => {
    seed(collections);

    const report = await audits.auditOrphanedSupplierData();

    expect(report).toMatchObject({
      audit: 'orphaned-supplier-data',
      mode: 'dry-run',
      inconclusive: false,
      counts: {
        checkedSuppliers: 3,
        legacyUnownedSuppliers: 1,
        orphanSuppliers: 1,
        orphanPackages: 1,
        publicOrphanPackages: 1,
        orphanPhotos: 1,
      },
    });
    // Counts and the audit's own error list only: no record ids or owner data.
    expect(Object.keys(report).sort()).toEqual(
      ['audit', 'backend', 'counts', 'errors', 'generatedAt', 'inconclusive', 'mode'].sort()
    );
    assertNothingWritten();
  });

  it('flags the report inconclusive when MongoDB is not the active, connected backend', async () => {
    seed({});
    mockDb.getDatabaseStatus.mockReturnValue({ type: 'local', connected: true, state: 'fallback' });

    const report = await audits.auditOrphanedSupplierData();

    expect(report.inconclusive).toBe(true);
    expect(report.counts.checkedSuppliers).toBe(0);
  });

  it('flags the report inconclusive when a read falls back to local storage mid-run', async () => {
    seed(collections);
    mockDb.getReadFallbackCount.mockReturnValueOnce(0).mockReturnValue(2);

    const report = await audits.auditOrphanedSupplierData();

    expect(report.inconclusive).toBe(true);
  });
});

describe('marketplace listing location audit', () => {
  const listings = [
    { id: 'l1', citySlug: 'london', location: 'London' },
    { id: 'l2', location: 'Somewhere vague' },
    { id: 'l3', location: '' },
  ];

  it('runs in dry-run mode, trims the rows and never writes', async () => {
    seed({ marketplace_listings: listings });
    const runSpy = jest.spyOn(listingScript, 'run');

    const report = await audits.auditMarketplaceListingLocations();

    expect(runSpy.mock.calls[0][0]).toMatchObject({ apply: false });
    expect(report).toMatchObject({
      audit: 'marketplace-listing-locations',
      mode: 'dry-run',
      inconclusive: false,
      totalListings: 3,
      audited: 3,
      truncated: false,
    });
    // Already-mapped listings are not reported as needing a decision.
    expect(report.needsReview.map(row => row.id)).toEqual(['l2', 'l3']);
    for (const row of report.needsReview) {
      expect(Object.keys(row).sort()).toEqual(['confidence', 'id', 'reason', 'status']);
    }
    assertNothingWritten();
  });

  it('says when the list of records needing review is capped, separately from the audit limit', async () => {
    const many = Array.from({ length: 150 }, (_unused, index) => ({
      id: `l${index}`,
      location: '',
    }));
    seed({ marketplace_listings: many });

    const report = await audits.auditMarketplaceListingLocations({ limit: 150 });

    // Every record was audited, so the audit itself is not truncated...
    expect(report.audited).toBe(150);
    expect(report.truncated).toBe(false);
    // ...but only the first MAX_REPORTED_ROWS findings are listed, and the
    // report must not pretend otherwise.
    expect(report.needsReview).toHaveLength(audits.MAX_REPORTED_ROWS);
    expect(report.needsReviewTotal).toBe(150);
    expect(report.needsReviewTruncated).toBe(true);
  });

  it('reports a complete review list as not truncated', async () => {
    seed({ marketplace_listings: listings });

    const report = await audits.auditMarketplaceListingLocations();

    expect(report.needsReviewTotal).toBe(2);
    expect(report.needsReviewTruncated).toBe(false);
  });

  it('bounds the work with a limit and says when the report was truncated', async () => {
    seed({ marketplace_listings: listings });

    const report = await audits.auditMarketplaceListingLocations({ limit: '2' });

    expect(report.audited).toBe(2);
    expect(report.totalListings).toBe(3);
    expect(report.truncated).toBe(true);
  });
});

describe('supplier location audit', () => {
  const suppliers = [
    { id: 's1', location: 'Nowhere in particular' },
    { id: 's2', location: '' },
  ];

  it('runs in dry-run mode and never writes', async () => {
    seed({ suppliers });
    const runSpy = jest.spyOn(supplierScript, 'run');

    const report = await audits.auditSupplierLocations({ limit: 50 });

    expect(runSpy.mock.calls[0][0]).toMatchObject({ apply: false, limit: 50 });
    expect(report).toMatchObject({
      audit: 'supplier-locations',
      mode: 'dry-run',
      inconclusive: false,
      totalSuppliers: 2,
      audited: 2,
    });
    expect(report.needsReview.every(row => row.id)).toBe(true);
    assertNothingWritten();
  });

  it('is inconclusive against local fallback storage', async () => {
    seed({ suppliers });
    mockDb.getDatabaseStatus.mockReturnValue({ type: 'local', connected: false, state: 'down' });

    const report = await audits.auditSupplierLocations();

    expect(report.inconclusive).toBe(true);
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps the limit', () => {
    expect(audits.clampLimit(undefined)).toBe(audits.DEFAULT_ROW_LIMIT);
    expect(audits.clampLimit('abc')).toBe(audits.DEFAULT_ROW_LIMIT);
    expect(audits.clampLimit('0')).toBe(audits.DEFAULT_ROW_LIMIT);
    expect(audits.clampLimit('-5')).toBe(audits.DEFAULT_ROW_LIMIT);
    expect(audits.clampLimit('25')).toBe(25);
    expect(audits.clampLimit('99999')).toBe(audits.MAX_ROW_LIMIT);
  });
});

describe('ops-bot audit routes', () => {
  const SECRET = 's'.repeat(48);
  const originalSecret = process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
  const originalEnabled = process.env.OPS_ASSISTANT_ENABLED;
  let app;

  beforeAll(() => {
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = SECRET;
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    // eslint-disable-next-line global-require
    const router = require('../../routes/ops-bot');
    app = express();
    app.use(express.json());
    app.use('/internal/ops-bot', router);
  });

  afterAll(() => {
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = originalSecret;
    process.env.OPS_ASSISTANT_ENABLED = originalEnabled;
  });

  function signed(path, method = 'GET') {
    const timestamp = String(Date.now());
    return {
      'x-eventflow-bot-timestamp': timestamp,
      'x-eventflow-bot-signature': `sha256=${signatureFor(SECRET, timestamp, method, path, '{}')}`,
    };
  }

  const paths = [
    '/internal/ops-bot/audits/orphaned-supplier-data',
    '/internal/ops-bot/audits/marketplace-listing-locations',
    '/internal/ops-bot/audits/supplier-locations',
  ];

  it.each(paths)('rejects %s without a valid signature', async path => {
    seed({});
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(mockDb.read).not.toHaveBeenCalled();
  });

  it.each(paths)('serves %s to a correctly signed request', async path => {
    seed({});
    const response = await request(app).get(path).set(signed(path));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, mode: 'dry-run' });
    assertNothingWritten();
  });

  it('includes the query string in the signed path, so a limit must be signed', async () => {
    seed({ suppliers: [] });
    const path = '/internal/ops-bot/audits/supplier-locations?limit=10';
    const ok = await request(app).get(path).set(signed(path));
    expect(ok.status).toBe(200);

    const unsignedQuery = await request(app)
      .get(path)
      .set(signed('/internal/ops-bot/audits/supplier-locations'));
    expect(unsignedQuery.status).toBe(401);
  });

  it('has no write method on the audit paths', async () => {
    for (const path of paths) {
      // Correctly signed for POST, so the only thing that can stop it is the
      // absence of a write route.
      const response = await request(app).post(path).set(signed(path, 'POST'));
      expect(response.status).toBe(404);
    }
    assertNothingWritten();
  });
});
