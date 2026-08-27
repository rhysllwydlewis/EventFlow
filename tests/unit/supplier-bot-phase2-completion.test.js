'use strict';

const {
  collisionSignals,
  createSupplierBotClaimRequest,
  findSupplierBotCollision,
  normalizeWebsite,
} = require('../../services/supplierBotClaim.service');
const { createUnclaimedSupplierFromBot } = require('../../services/supplierBotIngestion.service');
const {
  DEFAULT_GRACE_DAYS,
  configuredGraceDays,
  isPackageGraceActive,
  startSupplierBotPackageGrace,
} = require('../../services/supplierBotPackageGrace.service');
const { lifecycleBlockReason } = require('../../services/seoRecordLifecycle.util');
const seoEligibility = require('../../services/seoEligibility.service');

function botSupplier(overrides = {}) {
  return {
    id: 'sup_bot_existing',
    ownershipStatus: 'unclaimed',
    name: 'Example Venue',
    category: 'Venues',
    location: 'Cardiff',
    website: 'https://example-venue.test/',
    email: 'hello@example-venue.test',
    status: 'draft',
    approved: false,
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'cand_1',
      sourcePackages: [],
      advertisedPrices: [],
    },
    ...overrides,
  };
}

describe('Phase 2 Supplier Bot completion boundaries', () => {
  afterEach(() => {
    delete process.env.SUPPLIER_BOT_PACKAGE_GRACE_DAYS;
  });

  it('normalises signup websites and detects exact email/website collisions', () => {
    expect(normalizeWebsite('www.example-venue.test/')).toBe('https://example-venue.test/');
    expect(
      collisionSignals(
        { email: 'HELLO@example-venue.test ', website: 'example-venue.test' },
        botSupplier()
      )
    ).toEqual(['public_email_exact', 'website_exact', 'email_domain_match']);
  });

  it('matches a signup by email domain against the listing website without an explicit website field', () => {
    expect(collisionSignals({ email: 'owner@example-venue.test' }, botSupplier())).toEqual([
      'email_domain_match',
    ]);
  });

  it('does not match an unrelated signup email on a different domain', () => {
    expect(collisionSignals({ email: 'someone@other-business.test' }, botSupplier())).toEqual([]);
  });

  it('excludes free webmail domains from the email-domain collision signal', () => {
    expect(
      collisionSignals({ email: 'owner@gmail.com' }, botSupplier({ website: 'https://gmail.com/' }))
    ).toEqual([]);
  });

  it('finds only unclaimed Supplier Bot profiles as signup collisions', async () => {
    const suppliers = [
      botSupplier(),
      botSupplier({
        id: 'sup_manual',
        ownershipStatus: 'claimed',
        acquisition: { source: 'manual' },
      }),
    ];
    const dbUnified = { read: jest.fn(async () => suppliers) };

    const result = await findSupplierBotCollision({
      dbUnified,
      user: { email: 'hello@example-venue.test', website: '' },
    });

    expect(result.supplier.id).toBe('sup_bot_existing');
    expect(result.signals).toEqual(['public_email_exact', 'email_domain_match']);
  });

  it('creates an idempotent claim request without transferring ownership', async () => {
    const claims = [];
    const dbUnified = {
      findOne: jest.fn(
        async (_collection, filter) => claims.find(item => item.id === filter.id) || null
      ),
      insertOne: jest.fn(async (_collection, doc) => {
        claims.push(doc);
        return doc;
      }),
    };
    const supplier = botSupplier();
    const user = { id: 'usr_1', role: 'supplier', verified: true, email: supplier.email };

    const first = await createSupplierBotClaimRequest({
      dbUnified,
      supplier,
      user,
      signals: ['public_email_exact'],
      source: 'test',
    });
    const second = await createSupplierBotClaimRequest({
      dbUnified,
      supplier,
      user,
      signals: ['public_email_exact'],
      source: 'test',
    });

    expect(first.created).toBe(true);
    expect(first.claim.status).toBe('pending_proof');
    expect(second.created).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(claims).toHaveLength(1);
    expect(supplier.ownerUserId).toBeUndefined();
    expect(supplier.ownershipStatus).toBe('unclaimed');
  });

  it('keeps unclaimed bot suppliers non-public even if approved is accidentally flipped', () => {
    const supplier = botSupplier({
      status: 'published',
      approved: true,
      description: 'A complete venue description suitable for a real public profile.',
    });

    expect(lifecycleBlockReason(supplier)).toBe('not_approved');
    expect(seoEligibility.canBeViewedPublicly(supplier).eligible).toBe(false);
    expect(seoEligibility.canAppearInDirectory(supplier).eligible).toBe(false);
    expect(seoEligibility.canBeIndexed(supplier).eligible).toBe(false);
  });

  it('preserves imported package and advertised-price evidence for later claim handover', async () => {
    const suppliers = [];
    const dbUnified = {
      read: jest.fn(async () => suppliers),
      insertOne: jest.fn(async (_collection, doc) => {
        suppliers.push(doc);
        return doc;
      }),
    };
    const payload = {
      candidateId: 'cand_packages',
      businessName: 'Package Venue',
      category: 'Venues',
      location: 'Cardiff',
      website: 'https://package-venue.test',
      description: 'Venue description',
      publicEmail: 'hello@package-venue.test',
      publicPhone: '02920000000',
      services: ['Weddings'],
      packages: [{ name: 'Exclusive hire', price: '£2,000', features: ['Exclusive use'] }],
      advertisedPrices: ['From £2,000'],
      publicationQuality: 92,
      dataConfidence: 90,
      complianceStatus: 'pass',
      compliancePolicyVersion: 'phase2',
      generatedAt: new Date().toISOString(),
      generatorVersion: 'test',
    };

    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload });
    expect(result.supplier.acquisition.sourcePackages).toEqual(payload.packages);
    expect(result.supplier.acquisition.advertisedPrices).toEqual(payload.advertisedPrices);
    expect(result.supplier.status).toBe('draft');
    expect(result.supplier.ownershipStatus).toBe('unclaimed');
  });

  it('defines a bounded time-limited package grace that starts only after a validated claim handover', async () => {
    const supplier = botSupplier({ ownershipStatus: 'claimed', ownerUserId: 'usr_owner' });
    const updates = [];
    const dbUnified = {
      findOne: jest.fn(async () => supplier),
      updateOne: jest.fn(async (_collection, _filter, update) => {
        updates.push(update.$set);
        return true;
      }),
    };
    const claimedAt = new Date('2026-08-27T12:00:00.000Z');

    expect(configuredGraceDays()).toBe(DEFAULT_GRACE_DAYS);
    const result = await startSupplierBotPackageGrace({
      dbUnified,
      supplierId: supplier.id,
      claimedAt,
    });

    expect(updates).toHaveLength(1);
    expect(result.supplierBotPackageGraceStartedAt).toBe('2026-08-27T12:00:00.000Z');
    expect(result.supplierBotPackageGraceUntil).toBe('2026-09-26T12:00:00.000Z');
    expect(isPackageGraceActive(result, new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
    expect(isPackageGraceActive(result, new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
  });

  it('clamps package grace configuration instead of allowing an unlimited bypass', () => {
    process.env.SUPPLIER_BOT_PACKAGE_GRACE_DAYS = '9999';
    expect(configuredGraceDays()).toBe(90);
    process.env.SUPPLIER_BOT_PACKAGE_GRACE_DAYS = '0';
    expect(configuredGraceDays()).toBe(1);
  });
});

describe('normal supplier signup collision routing', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
  });

  it('creates a pending claim reference instead of losing a bot collision', async () => {
    const data = {
      settings: [{}],
      suppliers: [botSupplier()],
      supplierClaims: [],
    };
    const dbUnified = {
      read: jest.fn(async collection => data[collection] || []),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'suppliers' && filter.ownerUserId) {
          return data.suppliers.find(item => item.ownerUserId === filter.ownerUserId) || null;
        }
        if (collection === 'supplierClaims' && filter.id) {
          return data.supplierClaims.find(item => item.id === filter.id) || null;
        }
        return null;
      }),
      insertOne: jest.fn(async (collection, doc) => {
        if (!data[collection]) {
          data[collection] = [];
        }
        data[collection].push(doc);
        return doc;
      }),
      uid: jest.fn(() => 'sup_signup'),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');

    const created = await ensureSupplierProfileForUser({
      id: 'usr_signup',
      role: 'supplier',
      verified: false,
      email: 'hello@example-venue.test',
      website: 'https://example-venue.test',
      company: 'Example Venue',
      location: 'Cardiff',
    });

    expect(created.id).toBe('sup_signup');
    expect(created.ownerUserId).toBe('usr_signup');
    expect(created.approved).toBe(false);
    expect(created.supplierBotCollision).toMatchObject({
      supplierId: 'sup_bot_existing',
      candidateId: 'cand_1',
      claimStatus: 'pending_email_verification',
    });
    expect(data.supplierClaims).toHaveLength(1);
    expect(data.supplierClaims[0]).toMatchObject({
      supplierId: 'sup_bot_existing',
      requesterUserId: 'usr_signup',
      status: 'pending_email_verification',
      source: 'normal_signup_collision',
    });
    expect(data.suppliers[0].ownershipStatus).toBe('unclaimed');
    expect(data.suppliers[0].ownerUserId).toBeUndefined();
  });
});
