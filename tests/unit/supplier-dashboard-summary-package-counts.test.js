/**
 * GET /api/v1/supplier/dashboard-summary — packages.{active,draft,paused}
 *
 * The supplier dashboard renders a package count twice: once in the hero stat
 * card and once in the KPI grid. Those used to be computed independently — the
 * hero counted /api/me/packages with active = "not paused", while the KPI grid
 * used this endpoint, where active = "not unapproved". A package that was
 * unapproved but unpaused satisfied one definition and not the other, so the
 * same metric rendered as two different numbers on a single page load.
 *
 * Both now read the counts below, so these cases pin the one definition:
 * active means live for customers — neither paused by the supplier nor
 * withheld pending admin approval.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockDb = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
  read: jest.fn().mockResolvedValue([]),
};
jest.mock('../../db-unified', () => mockDb);

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'user-sup-1', role: 'supplier', email: 'supplier@test.com' };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const express = require('express');

function buildApp() {
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/supplier', router);
  return app;
}

const SUPPLIER = {
  id: 'sup-1',
  ownerUserId: 'user-sup-1',
  name: 'Snapshot Photography',
};

/**
 * dashboard-summary issues several independent find() calls (packages, messages,
 * analytics…). Only the packages lookup is keyed by supplierId, so route the
 * package fixtures there and leave every other collection empty.
 */
function withPackages(packages) {
  mockDb.find.mockImplementation(async collection => (collection === 'packages' ? packages : []));
}

async function getSummary() {
  const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');
  expect(res.status).toBe(200);
  return res.body;
}

describe('GET /api/v1/supplier/dashboard-summary — package counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.read.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(SUPPLIER);
  });

  it('counts a live package as active', async () => {
    withPackages([{ id: 'pkg-1', supplierId: 'sup-1', approved: true }]);

    const body = await getSummary();

    expect(body.packages).toEqual({ total: 1, active: 1, draft: 0, paused: 0 });
  });

  it('treats a package awaiting approval as a draft, not active', async () => {
    withPackages([{ id: 'pkg-1', supplierId: 'sup-1', approved: false }]);

    const body = await getSummary();

    expect(body.packages).toEqual({ total: 1, active: 0, draft: 1, paused: 0 });
  });

  it('treats a paused package as paused, not active', async () => {
    withPackages([{ id: 'pkg-1', supplierId: 'sup-1', approved: true, paused: true }]);

    const body = await getSummary();

    expect(body.packages).toEqual({ total: 1, active: 0, draft: 0, paused: 1 });
  });

  it('counts a package that is both paused and unapproved once, as paused', async () => {
    withPackages([{ id: 'pkg-1', supplierId: 'sup-1', approved: false, paused: true }]);

    const body = await getSummary();

    // The states are mutually exclusive in the response, so total must still be 1 —
    // a package counted under two headings would inflate the dashboard's numbers.
    expect(body.packages).toEqual({ total: 1, active: 0, draft: 0, paused: 1 });
  });

  it('classifies a mixed set so the buckets sum to the total', async () => {
    withPackages([
      { id: 'pkg-1', supplierId: 'sup-1', approved: true },
      { id: 'pkg-2', supplierId: 'sup-1', approved: true },
      { id: 'pkg-3', supplierId: 'sup-1', approved: false },
      { id: 'pkg-4', supplierId: 'sup-1', approved: true, paused: true },
    ]);

    const body = await getSummary();

    expect(body.packages).toEqual({ total: 4, active: 2, draft: 1, paused: 1 });
    const { active, draft, paused, total } = body.packages;
    expect(active + draft + paused).toBe(total);
  });

  it('reports zeroes rather than failing when the supplier has no packages', async () => {
    withPackages([]);

    const body = await getSummary();

    expect(body.packages).toEqual({ total: 0, active: 0, draft: 0, paused: 0 });
  });

  it('falls back to zeroed counts when the packages lookup throws', async () => {
    mockDb.find.mockImplementation(async collection => {
      if (collection === 'packages') {
        throw new Error('database unavailable');
      }
      return [];
    });

    const body = await getSummary();

    // A failed sub-query must not take the whole dashboard down with it.
    expect(body.packages).toEqual({ total: 0, active: 0, draft: 0, paused: 0 });
  });
});
