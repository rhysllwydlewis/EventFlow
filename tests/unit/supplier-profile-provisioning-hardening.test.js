'use strict';

const express = require('express');
const request = require('supertest');

function mockLogger() {
  jest.doMock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));
}

describe('supplier profile provisioning service', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLogger();
  });

  function loadService({ existing = null, settings = {}, insertImpl } = {}) {
    const dbUnified = {
      read: jest.fn(async collection => (collection === 'settings' ? settings : [])),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'suppliers' && filter.ownerUserId === 'usr_supplier') {
          return existing;
        }
        return null;
      }),
      insertOne: insertImpl || jest.fn(async (_collection, doc) => doc),
      uid: jest.fn(() => 'sup_new'),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const service = require('../../services/supplierProfileProvisioning.service');
    return { service, dbUnified };
  }

  it('is idempotent and returns an existing supplier profile without inserting', async () => {
    const existing = { id: 'sup_existing', ownerUserId: 'usr_supplier' };
    const { service, dbUnified } = loadService({ existing });

    const result = await service.ensureSupplierProfileForUser({
      id: 'usr_supplier',
      role: 'supplier',
      email: 'supplier@example.com',
    });

    expect(result).toBe(existing);
    expect(dbUnified.findOne).toHaveBeenCalledWith('suppliers', { ownerUserId: 'usr_supplier' });
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  it('does not create supplier profiles for customer users', async () => {
    const { service, dbUnified } = loadService();

    await expect(
      service.ensureSupplierProfileForUser({ id: 'usr_customer', role: 'customer' })
    ).resolves.toBeNull();
    expect(dbUnified.findOne).not.toHaveBeenCalled();
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  it('creates a draft supplier profile with safe defaults when missing', async () => {
    const { service, dbUnified } = loadService();

    const result = await service.ensureSupplierProfileForUser({
      id: 'usr_supplier',
      role: 'supplier',
      email: 'owner@example.com',
      company: 'Example Events',
      location: 'London',
    });

    expect(result).toMatchObject({
      id: 'sup_new',
      ownerUserId: 'usr_supplier',
      email: 'owner@example.com',
      name: 'Example Events',
      location: 'London',
      category: 'Other',
      profileComplete: false,
      photosGallery: [],
      amenities: [],
      approved: false,
      verificationStatus: 'unverified',
    });
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      'suppliers',
      expect.objectContaining({ id: 'sup_new' })
    );
  });

  it('re-reads after insert failure to handle duplicate-key races', async () => {
    let found = null;
    const dbUnified = {
      read: jest.fn(async () => ({})),
      findOne: jest.fn(async () => found),
      insertOne: jest.fn(async (_collection, doc) => {
        found = { ...doc, id: 'sup_race' };
        return null;
      }),
      uid: jest.fn(() => 'sup_race'),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');

    const result = await ensureSupplierProfileForUser({
      id: 'usr_supplier',
      role: 'supplier',
      email: 'race@example.com',
    });

    expect(result.id).toBe('sup_race');
    expect(dbUnified.findOne).toHaveBeenCalledTimes(2);
  });
});

describe('requireApprovedSupplier middleware', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLogger();
  });

  function runMiddleware(profile) {
    const dbUnified = {
      findOne: jest.fn(async () => profile),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const { requireApprovedSupplier } = require('../../middleware/auth');
    const req = { user: { id: 'usr_supplier', role: 'supplier' }, path: '/x', method: 'GET' };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    return requireApprovedSupplier(req, res, next).then(() => ({ req, res, next }));
  }

  it('returns SUPPLIER_PROFILE_MISSING when profile is absent', async () => {
    const { res, next } = await runMiddleware(null);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SUPPLIER_PROFILE_MISSING',
        error: 'Supplier profile missing',
        setupUrl: '/dashboard-supplier#profile-form',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns SUPPLIER_NOT_APPROVED when profile exists but is not approved', async () => {
    const { res, next } = await runMiddleware({
      id: 'sup_1',
      ownerUserId: 'usr_supplier',
      approved: false,
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SUPPLIER_NOT_APPROVED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.supplierProfile for approved suppliers', async () => {
    const profile = { id: 'sup_1', ownerUserId: 'usr_supplier', approved: true };
    const { req, next } = await runMiddleware(profile);

    expect(req.supplierProfile).toBe(profile);
    expect(next).toHaveBeenCalled();
  });
});

describe('missing supplier profile backfill script', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLogger();
  });

  function loadBackfill({ applyCreated = null } = {}) {
    const users = [
      { id: 'usr_missing', role: 'supplier', email: 'missing@example.com' },
      { id: 'usr_ok', role: 'supplier', email: 'ok@example.com' },
    ];
    const dbUnified = {
      initializeDatabase: jest.fn(async () => undefined),
      find: jest.fn(async () => users),
      findOne: jest.fn(async (_collection, filter) =>
        filter.ownerUserId === 'usr_ok' ? { id: 'sup_ok', ownerUserId: 'usr_ok' } : null
      ),
    };
    const ensureSupplierProfileForUser = jest.fn(
      async user => applyCreated || { id: `sup_${user.id}`, ownerUserId: user.id }
    );
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../services/supplierProfileProvisioning.service', () => ({
      ensureSupplierProfileForUser,
    }));
    const script = require('../../scripts/backfill-missing-supplier-profiles');
    return { script, dbUnified, ensureSupplierProfileForUser };
  }

  it('dry-run finds supplier users missing supplier profiles without creating them', async () => {
    const { script, ensureSupplierProfileForUser } = loadBackfill();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const summary = await script.runBackfill({ apply: false });

    expect(summary).toMatchObject({ checked: 2, missing: 1, created: 0, skipped: 1, errors: 0 });
    expect(ensureSupplierProfileForUser).not.toHaveBeenCalled();
  });

  it('--apply creates missing draft supplier profiles', async () => {
    const { script, ensureSupplierProfileForUser } = loadBackfill();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const summary = await script.runBackfill({ apply: true });

    expect(summary).toMatchObject({ checked: 2, missing: 1, created: 1, skipped: 0, errors: 0 });
    expect(ensureSupplierProfileForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'usr_missing', role: 'supplier' })
    );
  });
});

describe('packages route supplier ownership and approval', () => {
  let packagesRouter;
  let data;

  beforeEach(() => {
    jest.resetModules();
    mockLogger();
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    jest.doMock('../../services/subscriptionService', () => ({
      getUserFeatures: jest.fn(async () => ({ name: 'Starter', features: { maxPackages: 3 } })),
    }));
    packagesRouter = require('../../routes/packages');
    data = { suppliers: [], packages: [], settings: {} };

    const dbUnified = {
      find: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        if (collection === 'packages' && filter.supplierId && filter.supplierId.$in) {
          return rows.filter(row => filter.supplierId.$in.includes(row.supplierId));
        }
        if (collection === 'packages' && filter.supplierId) {
          return rows.filter(row => row.supplierId === filter.supplierId);
        }
        if (collection === 'suppliers' && filter.ownerUserId) {
          return rows.filter(row => row.ownerUserId === filter.ownerUserId);
        }
        return rows;
      }),
      findOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        return rows.find(row => Object.keys(filter).every(key => row[key] === filter[key])) || null;
      }),
      read: jest.fn(async collection => data[collection] || {}),
      insertOne: jest.fn(async (collection, doc) => {
        data[collection].push(doc);
        return doc;
      }),
    };

    packagesRouter.initializeDependencies({
      dbUnified,
      authRequired: (req, _res, next) => {
        req.user = { id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
      requireVerifiedUser: (_req, _res, next) => next(),
      requireApprovedSupplier: async (req, res, next) => {
        const supplier = data.suppliers.find(s => s.ownerUserId === req.user.id);
        if (!supplier) {
          return res
            .status(403)
            .json({ code: 'SUPPLIER_PROFILE_MISSING', error: 'Supplier profile missing' });
        }
        req.supplierProfile = supplier;
        if (supplier.approved !== true) {
          return res
            .status(403)
            .json({ code: 'SUPPLIER_NOT_APPROVED', error: 'Supplier not approved' });
        }
        return next();
      },
      csrfProtection: (_req, _res, next) => next(),
      featureRequired: () => (_req, _res, next) => next(),
      writeLimiter: (_req, _res, next) => next(),
      photoUpload: {
        upload: { single: () => (_req, _res, next) => next() },
        processAndSaveImage: jest.fn(),
      },
      uploadValidation: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      uid: jest.fn(prefix => `${prefix}_new`),
    });
  });

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(packagesRouter);
    return instance;
  }

  it('GET /api/me/packages only returns packages owned by logged-in supplier', async () => {
    data.suppliers.push({ id: 'sup_owned', ownerUserId: 'usr_supplier', approved: true });
    data.packages.push(
      { id: 'pkg_owned', supplierId: 'sup_owned', title: 'Owned' },
      { id: 'pkg_other', supplierId: 'sup_other', title: 'Other' }
    );

    const res = await request(app()).get('/me/packages');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('pkg_owned');
  });

  it('POST /api/me/packages succeeds for approved owned supplier and defaults sole supplierId', async () => {
    data.suppliers.push({ id: 'sup_owned', ownerUserId: 'usr_supplier', approved: true });

    const res = await request(app())
      .post('/me/packages')
      .send({
        title: 'Gold package',
        price: '£100',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });

    expect(res.status).toBe(200);
    expect(res.body.package).toMatchObject({ supplierId: 'sup_owned', title: 'Gold package' });
  });

  it('POST /api/me/packages fails for missing supplier profile', async () => {
    const res = await request(app())
      .post('/me/packages')
      .send({
        supplierId: 'sup_missing',
        title: 'Gold package',
        price: '£100',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_PROFILE_MISSING');
  });

  it('POST /api/me/packages fails for unapproved supplier', async () => {
    data.suppliers.push({ id: 'sup_owned', ownerUserId: 'usr_supplier', approved: false });

    const res = await request(app())
      .post('/me/packages')
      .send({
        supplierId: 'sup_owned',
        title: 'Gold package',
        price: '£100',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
  });

  it('POST /api/me/packages fails for supplierId owned by another user', async () => {
    data.suppliers.push({ id: 'sup_owned', ownerUserId: 'usr_supplier', approved: true });

    const res = await request(app())
      .post('/me/packages')
      .send({
        supplierId: 'sup_other',
        title: 'Gold package',
        price: '£100',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_PROFILE_OWNERSHIP_FAILED');
  });

  it('existing package limit behaviour remains intact', async () => {
    data.suppliers.push({ id: 'sup_owned', ownerUserId: 'usr_supplier', approved: true });
    data.packages.push(
      { id: 'pkg_1', supplierId: 'sup_owned', paused: false },
      { id: 'pkg_2', supplierId: 'sup_owned', paused: false },
      { id: 'pkg_3', supplierId: 'sup_owned', paused: false }
    );

    const res = await request(app())
      .post('/me/packages')
      .send({
        supplierId: 'sup_owned',
        title: 'Over limit',
        price: '£100',
        primaryCategoryKey: 'catering',
        eventTypes: ['wedding'],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('allows up to 3 active packages');
  });
});

describe('supplier registration provisioning integration', () => {
  const originalPartnerAbuseHashSecret = process.env.PARTNER_ABUSE_HASH_SECRET;

  beforeEach(() => {
    jest.resetModules();
    mockLogger();
    process.env.PARTNER_ABUSE_HASH_SECRET = 'supplier-provisioning-risk-test-secret';
  });

  afterEach(() => {
    if (originalPartnerAbuseHashSecret === undefined) {
      delete process.env.PARTNER_ABUSE_HASH_SECRET;
    } else {
      process.env.PARTNER_ABUSE_HASH_SECRET = originalPartnerAbuseHashSecret;
    }
  });

  function loadAuthRegistrationApp() {
    jest.dontMock('../../services/supplierProfileProvisioning.service');
    const data = {
      users: [],
      suppliers: [],
      supplierClaims: [],
      partner_abuse_events: [],
      partner_abuse_overrides: [],
      partner_abuse_appeals: [],
      settings: { features: { registration: true, supplierApplications: true } },
    };
    let idCounter = 0;
    const nextId = prefix => `${prefix}_${++idCounter}`;

    jest.doMock('../../store', () => ({ uid: nextId }));
    jest.doMock('../../utils/postmark', () => ({
      sendVerificationEmail: jest.fn(async () => ({ provider: 'mock', messageId: 'msg_1' })),
    }));
    jest.doMock('../../utils/token', () => ({
      TOKEN_TYPES: { EMAIL_VERIFICATION: 'email_verification' },
      generateVerificationToken: jest.fn(() => 'verification_token'),
      verifyToken: jest.fn(() => ({ valid: true, payload: {} })),
    }));
    jest.doMock('../../middleware/csrf', () => ({
      csrfProtection: (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/rateLimits', () => ({
      authLimiter: (_req, _res, next) => next(),
      resendEmailLimiter: (_req, _res, next) => next(),
      strictAuthLimiter: (_req, _res, next) => next(),
      passwordResetLimiter: (_req, _res, next) => next(),
      registrationLimiter: (_req, _res, next) => next(),
      tokenLinkLimiter: (_req, _res, next) => next(),
      writeLimiter: (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/features', () => ({
      getFeatureFlags: jest.fn(async () => ({ registration: true, supplierApplications: true })),
      featureRequired: () => (_req, _res, next) => next(),
    }));

    const dbUnified = {
      read: jest.fn(async collection => data[collection] || {}),
      findWithOptions: jest.fn(async (collection, query = {}, options = {}) => {
        const rows = Array.isArray(data[collection]) ? data[collection] : [];
        const matches = row =>
          Object.entries(query).every(([key, expected]) => {
            if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
              if (Array.isArray(expected.$in)) {
                return expected.$in.includes(row[key]);
              }
              if (expected.$gte !== undefined) {
                return row[key] >= expected.$gte;
              }
              if (expected.$gt !== undefined) {
                return row[key] > expected.$gt;
              }
              if (expected.$exists !== undefined) {
                return expected.$exists
                  ? Object.prototype.hasOwnProperty.call(row, key)
                  : !Object.prototype.hasOwnProperty.call(row, key);
              }
            }
            return row[key] === expected;
          });
        const results = rows.filter(matches);
        const sortEntries = Object.entries(options.sort || {});
        if (sortEntries.length) {
          const [field, direction] = sortEntries[0];
          results.sort(
            (left, right) =>
              direction * String(left[field] || '').localeCompare(String(right[field] || ''))
          );
        }
        return results.slice(0, options.limit || results.length);
      }),
      findOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        return rows.find(row => Object.keys(filter).every(key => row[key] === filter[key])) || null;
      }),
      insertOne: jest.fn(async (collection, doc) => {
        data[collection].push(doc);
        return doc;
      }),
      updateOne: jest.fn(async (collection, filter, update) => {
        const rows = data[collection] || [];
        const row = rows.find(item => Object.keys(filter).every(key => item[key] === filter[key]));
        if (!row) {
          return false;
        }
        Object.assign(row, update.$set || update);
        return true;
      }),
      deleteOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        const index = rows.findIndex(row =>
          Object.keys(filter).every(key => row[key] === filter[key])
        );
        if (index === -1) {
          return false;
        }
        rows.splice(index, 1);
        return true;
      }),
      uid: jest.fn(nextId),
    };
    jest.doMock('../../db-unified', () => dbUnified);

    const authRouter = require('../../routes/auth');
    const app = express();
    app.use(express.json());
    app.use(authRouter);
    return { app, data, dbUnified };
  }

  function validRegistration(overrides = {}) {
    return {
      firstName: 'Debug',
      lastName: 'User',
      email: `debug-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'SecurePassword123!',
      role: 'customer',
      location: 'London',
      ...overrides,
    };
  }

  it('supplier registration creates both users and linked suppliers records', async () => {
    const { app, data } = loadAuthRegistrationApp();

    const res = await request(app)
      .post('/register')
      .send(validRegistration({ role: 'supplier', company: 'Debug Supplier Co' }));

    expect(res.status).toBe(201);
    expect(data.users).toHaveLength(1);
    expect(data.suppliers).toHaveLength(1);
    expect(data.suppliers[0]).toMatchObject({
      ownerUserId: data.users[0].id,
      email: data.users[0].email,
      name: 'Debug Supplier Co',
      profileComplete: false,
      approved: false,
      verificationStatus: 'unverified',
    });
  });

  it('customer registration does not create a supplier profile', async () => {
    const { app, data } = loadAuthRegistrationApp();

    const res = await request(app)
      .post('/register')
      .send(validRegistration({ role: 'customer' }));

    expect(res.status).toBe(201);
    expect(data.users).toHaveLength(1);
    expect(data.users[0].role).toBe('customer');
    expect(data.suppliers).toHaveLength(0);
  });

  it('carries an explicit claimSupplierId from the claim link into a pending claim, even without a matching email/website', async () => {
    const { app, data } = loadAuthRegistrationApp();
    data.suppliers.push({
      id: 'sup_bot_claim_target',
      ownershipStatus: 'unclaimed',
      name: 'Claimable Venue',
      website: 'https://claimable-venue.example/',
      email: 'info@claimable-venue.example',
      acquisition: { source: 'supplier_bot', candidateId: 'cand_claim_target' },
    });

    const res = await request(app)
      .post('/register')
      .send(
        validRegistration({
          role: 'supplier',
          company: 'A Different Trading Name',
          // Deliberately unrelated to the listing's email/website — only the
          // explicit claimSupplierId from the claim link should drive the match.
          email: 'owner@unrelated-inbox.example',
          claimSupplierId: 'sup_bot_claim_target',
        })
      );

    expect(res.status).toBe(201);
    expect(data.supplierClaims).toHaveLength(1);
    expect(data.supplierClaims[0]).toMatchObject({
      supplierId: 'sup_bot_claim_target',
      requesterUserId: data.users[0].id,
      source: 'claim_link_explicit',
      signals: [],
    });
    expect(data.suppliers.find(s => s.ownerUserId === data.users[0].id)).toMatchObject({
      supplierBotCollision: expect.objectContaining({
        supplierId: 'sup_bot_claim_target',
        claimId: data.supplierClaims[0].id,
      }),
    });
  });

  it('ignores a claimSupplierId that does not point at an unclaimed Supplier Bot profile', async () => {
    const { app, data } = loadAuthRegistrationApp();
    data.suppliers.push({
      id: 'sup_claimed_already',
      ownershipStatus: 'claimed',
      ownerUserId: 'usr_other',
      acquisition: { source: 'supplier_bot', candidateId: 'cand_other' },
    });

    const res = await request(app)
      .post('/register')
      .send(
        validRegistration({
          role: 'supplier',
          company: 'Some Business',
          claimSupplierId: 'sup_claimed_already',
        })
      );

    expect(res.status).toBe(201);
    expect(data.supplierClaims).toHaveLength(0);
  });

  it('supplier registration rolls back the new user when supplier profile provisioning fails', async () => {
    const { app, data, dbUnified } = loadAuthRegistrationApp();
    dbUnified.insertOne.mockImplementation(async (collection, doc) => {
      if (collection === 'suppliers') {
        return null;
      }
      data[collection].push(doc);
      return doc;
    });

    const res = await request(app)
      .post('/register')
      .send(validRegistration({ role: 'supplier', company: 'Rollback Supplier Co' }));

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SUPPLIER_PROFILE_PROVISIONING_FAILED');
    expect(data.users).toHaveLength(0);
    expect(data.suppliers).toHaveLength(0);
  });
});

describe('debug supplier provisioning smoke script', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLogger();
  });

  it('skips safely when MONGODB_URI is not configured', async () => {
    const originalMongoUri = process.env.MONGODB_URI;
    const originalAllowLocal = process.env.ALLOW_LOCAL_DEBUG_SMOKE;
    delete process.env.MONGODB_URI;
    delete process.env.ALLOW_LOCAL_DEBUG_SMOKE;

    const dbUnified = {
      initializeDatabase: jest.fn(),
      deleteOne: jest.fn(),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../services/supplierProfileProvisioning.service', () => ({
      ensureSupplierProfileForUser: jest.fn(),
    }));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { runSmoke } = require('../../scripts/debug-supplier-provisioning-smoke');
      const result = await runSmoke();

      expect(result).toMatchObject({ skipped: true, reason: 'MONGODB_URI not set' });
      expect(dbUnified.initializeDatabase).not.toHaveBeenCalled();
    } finally {
      if (originalMongoUri === undefined) {
        delete process.env.MONGODB_URI;
      } else {
        process.env.MONGODB_URI = originalMongoUri;
      }
      if (originalAllowLocal === undefined) {
        delete process.env.ALLOW_LOCAL_DEBUG_SMOKE;
      } else {
        process.env.ALLOW_LOCAL_DEBUG_SMOKE = originalAllowLocal;
      }
    }
  });

  function loadSmokeWithMemoryDb({ failPackageInsert = false } = {}) {
    jest.dontMock('../../services/supplierProfileProvisioning.service');
    const data = { users: [], suppliers: [], packages: [], settings: {} };
    let idCounter = 0;
    const matches = (row, filter) => Object.keys(filter).every(key => row[key] === filter[key]);
    const dbUnified = {
      initializeDatabase: jest.fn(async () => undefined),
      read: jest.fn(async collection => data[collection] || {}),
      uid: jest.fn(prefix => `${prefix}_smoke_${++idCounter}`),
      findOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        return rows.find(row => matches(row, filter)) || null;
      }),
      insertOne: jest.fn(async (collection, doc) => {
        if (failPackageInsert && collection === 'packages') {
          return null;
        }
        data[collection].push(doc);
        return doc;
      }),
      deleteOne: jest.fn(async (collection, filter) => {
        const rows = data[collection] || [];
        const index = rows.findIndex(row => matches(row, filter));
        if (index === -1) {
          return false;
        }
        rows.splice(index, 1);
        return true;
      }),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runSmoke } = require('../../scripts/debug-supplier-provisioning-smoke');
    return { data, dbUnified, runSmoke };
  }

  async function withLocalSmokeEnabled(fn) {
    const originalMongoUri = process.env.MONGODB_URI;
    const originalAllowLocal = process.env.ALLOW_LOCAL_DEBUG_SMOKE;
    delete process.env.MONGODB_URI;
    process.env.ALLOW_LOCAL_DEBUG_SMOKE = '1';
    try {
      await fn();
    } finally {
      if (originalMongoUri === undefined) {
        delete process.env.MONGODB_URI;
      } else {
        process.env.MONGODB_URI = originalMongoUri;
      }
      if (originalAllowLocal === undefined) {
        delete process.env.ALLOW_LOCAL_DEBUG_SMOKE;
      } else {
        process.env.ALLOW_LOCAL_DEBUG_SMOKE = originalAllowLocal;
      }
    }
  }

  it('creates dummy customer/supplier/package records and deletes them after a successful smoke run', async () => {
    await withLocalSmokeEnabled(async () => {
      const { data, dbUnified, runSmoke } = loadSmokeWithMemoryDb();

      const result = await runSmoke();

      expect(result).toMatchObject({ skipped: false, ok: true });
      expect(dbUnified.insertOne).toHaveBeenCalledWith(
        'users',
        expect.objectContaining({ role: 'customer' })
      );
      expect(dbUnified.insertOne).toHaveBeenCalledWith(
        'users',
        expect.objectContaining({ role: 'supplier' })
      );
      expect(dbUnified.insertOne).toHaveBeenCalledWith(
        'suppliers',
        expect.objectContaining({ ownerUserId: expect.stringContaining('usr_supplier_debug_') })
      );
      expect(dbUnified.insertOne).toHaveBeenCalledWith(
        'packages',
        expect.objectContaining({ supplierId: expect.any(String) })
      );
      expect(data.users).toHaveLength(0);
      expect(data.suppliers).toHaveLength(0);
      expect(data.packages).toHaveLength(0);
    });
  });

  it('deletes dummy records even when the smoke run fails after provisioning', async () => {
    await withLocalSmokeEnabled(async () => {
      const { data, runSmoke } = loadSmokeWithMemoryDb({ failPackageInsert: true });

      await expect(runSmoke()).rejects.toThrow('Failed to insert debug package');

      expect(data.users).toHaveLength(0);
      expect(data.suppliers).toHaveLength(0);
      expect(data.packages).toHaveLength(0);
    });
  });

  it('--keep leaves debug records for inspection', async () => {
    await withLocalSmokeEnabled(async () => {
      const { data, runSmoke } = loadSmokeWithMemoryDb();

      const result = await runSmoke({ keep: true });

      expect(result).toMatchObject({ skipped: false, ok: true, kept: true });
      expect(data.users).toHaveLength(2);
      expect(data.suppliers).toHaveLength(1);
      expect(data.packages).toHaveLength(1);
    });
  });

  it('--keep is blocked in production without explicit override', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowKeep = process.env.ALLOW_DEBUG_SMOKE_KEEP;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEBUG_SMOKE_KEEP;
    const { assertKeepAllowed } = require('../../scripts/debug-supplier-provisioning-smoke');

    expect(() => assertKeepAllowed({ keep: true })).toThrow('--keep is blocked in production');

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalAllowKeep === undefined) {
      delete process.env.ALLOW_DEBUG_SMOKE_KEEP;
    } else {
      process.env.ALLOW_DEBUG_SMOKE_KEEP = originalAllowKeep;
    }
  });
});
