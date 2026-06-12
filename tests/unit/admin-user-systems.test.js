/**
 * Admin User Systems — unit tests
 * Tests the adminUserSummary.service.js shared service and related API endpoints.
 */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-test', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockDb = {
  read: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
};
jest.mock('../../db-unified', () => mockDb);

const {
  buildUserSummary,
  listUsers,
  getUserDetail,
  classifySignupMethod,
  classifyVerificationMethod,
  buildAccountIssues,
  projectUser,
} = require('../../services/adminUserSummary.service');

// ── Sample data ─────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  id: 'u1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'customer',
  verified: true,
  passwordHash: '$2b$10$secret',
  marketingOptIn: false,
  emailUnsubscribed: false,
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
  ...overrides,
});

const makeSupplier = (overrides = {}) => ({
  id: 'sup1',
  ownerUserId: 'u1',
  name: 'Test Supplier',
  approved: true,
  approvalStatus: 'approved',
  description_short: 'A great supplier',
  ...overrides,
});

// ── classifySignupMethod ─────────────────────────────────────────────────────
describe('classifySignupMethod', () => {
  test('detects google by authProvider', () => {
    expect(classifySignupMethod({ authProvider: 'google' })).toBe('google');
  });
  test('detects google by googleSub', () => {
    expect(classifySignupMethod({ googleSub: 'g123' })).toBe('google');
  });
  test('detects email_password by passwordHash', () => {
    expect(classifySignupMethod({ passwordHash: '$2b$10$x' })).toBe('email_password');
  });
  test('detects admin_created (admin role, no password, no authProvider)', () => {
    expect(classifySignupMethod({ role: 'admin' })).toBe('admin_created');
  });
  test('returns unknown for unrecognised user', () => {
    expect(classifySignupMethod({})).toBe('unknown');
  });
});

// ── classifyVerificationMethod ───────────────────────────────────────────────
describe('classifyVerificationMethod', () => {
  test('pending for unverified user', () => {
    expect(classifyVerificationMethod({ verified: false })).toBe('pending');
  });
  test('google for google-verified user', () => {
    expect(classifyVerificationMethod({ verified: true, authProvider: 'google' })).toBe('google');
  });
  test('admin for admin-verified user', () => {
    expect(classifyVerificationMethod({ verified: true, verifiedBy: 'admin' })).toBe('admin');
  });
  test('admin for individual manual-admin verification provenance', () => {
    expect(
      classifyVerificationMethod({
        verified: true,
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'manual_admin',
        verifiedBy: { type: 'admin', userId: 'admin-1' },
        verificationToken: null,
      })
    ).toBe('admin');
  });
  test('admin for bulk manual-admin verification provenance', () => {
    expect(
      classifyVerificationMethod({
        verified: true,
        emailVerified: true,
        verifiedAt: new Date().toISOString(),
        verificationMethod: 'manual_admin',
        verifiedByAdmin: true,
        emailVerificationToken: null,
      })
    ).toBe('admin');
  });
  test('email_link for email-verified user with verifiedAt', () => {
    expect(
      classifyVerificationMethod({ verified: true, verifiedAt: new Date().toISOString() })
    ).toBe('email_link');
  });
  test('legacy for verified user with no verifiedAt', () => {
    expect(classifyVerificationMethod({ verified: true })).toBe('legacy');
  });
});

// ── projectUser — secret stripping ──────────────────────────────────────────
describe('projectUser — secret stripping', () => {
  test('does not include passwordHash', () => {
    const p = projectUser(makeUser({ passwordHash: 'hashed' }), null);
    expect(p).not.toHaveProperty('passwordHash');
    expect(p).not.toHaveProperty('password');
  });
  test('does not include googleSub', () => {
    const p = projectUser(makeUser({ googleSub: 'g123', authProvider: 'google' }), null);
    expect(p).not.toHaveProperty('googleSub');
  });
  test('does not include resetToken', () => {
    const p = projectUser(makeUser({ resetToken: 'tok123' }), null);
    expect(p).not.toHaveProperty('resetToken');
    expect(p).not.toHaveProperty('resetTokenExpiresAt');
  });
  test('does not include verificationToken', () => {
    const p = projectUser(makeUser({ verificationToken: 'vt' }), null);
    expect(p).not.toHaveProperty('verificationToken');
    expect(p).not.toHaveProperty('emailVerificationToken');
  });
  test('does not include authProviderIds', () => {
    const p = projectUser(makeUser({ authProviderIds: { google: 'g123' } }), null);
    expect(p).not.toHaveProperty('authProviderIds');
  });
  test('includes safe fields', () => {
    const p = projectUser(makeUser(), null);
    expect(p).toHaveProperty('id', 'u1');
    expect(p).toHaveProperty('email', 'test@example.com');
    expect(p).toHaveProperty('name', 'Test User');
    expect(p).toHaveProperty('role', 'customer');
    expect(p).toHaveProperty('signupMethod');
    expect(p).toHaveProperty('verificationMethod');
    expect(p).toHaveProperty('accountIssues');
  });
  test('includes Google link indicator without exposing googleSub', () => {
    const p = projectUser(makeUser({ googleSub: 'g123', authProvider: 'google' }), null);
    expect(p.hasGoogleLink).toBe(true);
    expect(p).not.toHaveProperty('googleSub');
  });
});

// ── buildAccountIssues ───────────────────────────────────────────────────────
describe('buildAccountIssues', () => {
  test('flags unknown_verification_source', () => {
    const u = makeUser({ verified: true });
    const issues = buildAccountIssues(u, null, 'email_password', 'unknown');
    expect(issues).toContain('unknown_verification_source');
  });
  test('flags email_unverified for pending email/password user', () => {
    const u = makeUser({ verified: false });
    const issues = buildAccountIssues(u, null, 'email_password', 'pending');
    expect(issues).toContain('email_unverified');
  });
  test('flags supplier_profile_missing when role=supplier but no supplier', () => {
    const u = makeUser({ role: 'supplier' });
    const issues = buildAccountIssues(u, null, 'email_password', 'email_link');
    expect(issues).toContain('supplier_profile_missing');
  });
  test('no issues for clean verified customer', () => {
    const u = makeUser({ verified: true, role: 'customer' });
    const issues = buildAccountIssues(u, null, 'email_password', 'email_link');
    expect(issues).toHaveLength(0);
  });
  test('flags suspended accounts', () => {
    const u = makeUser({ suspended: true });
    const issues = buildAccountIssues(u, null, 'email_password', 'email_link');
    expect(issues).toContain('suspended');
  });
});

// ── projectUser — supplier linkage ────────────────────────────────────────────
describe('projectUser — supplier linkage', () => {
  test('includes supplier profile summary when linked', () => {
    const u = makeUser({ role: 'supplier' });
    const s = makeSupplier({ ownerUserId: 'u1' });
    const p = projectUser(u, s);
    expect(p.supplierProfile).not.toBeNull();
    expect(p.supplierProfile.id).toBe('sup1');
    expect(p.supplierProfile.approved).toBe(true);
    expect(p.supplierProfile.profileUrl).toBe('/admin-supplier-detail?id=sup1');
  });
  test('supplierProfile is null when no supplier linked', () => {
    const p = projectUser(makeUser(), null);
    expect(p.supplierProfile).toBeNull();
  });
  test('flags supplier_profile_missing when role=supplier and no profile', () => {
    const u = makeUser({ role: 'supplier' });
    const p = projectUser(u, null);
    expect(p.accountIssues).toContain('supplier_profile_missing');
  });
});

// ── buildUserSummary ──────────────────────────────────────────────────────────
describe('buildUserSummary', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [
          makeUser({ id: 'u1', role: 'customer', verified: true, passwordHash: '$2b$10$x' }),
          makeUser({ id: 'u2', role: 'supplier', verified: false, passwordHash: '$2b$10$x' }),
          makeUser({ id: 'u3', role: 'admin', verified: true }),
          makeUser({
            id: 'u4',
            role: 'customer',
            verified: true,
            authProvider: 'google',
            googleSub: 'g1',
          }),
        ];
      }
      if (col === 'suppliers') {
        return [
          makeSupplier({
            id: 'sup1',
            ownerUserId: 'u2',
            approved: false,
            approvalStatus: 'pending',
          }),
        ];
      }
      return [];
    });
  });

  test('returns correct total user count', async () => {
    const s = await buildUserSummary();
    expect(s.total).toBe(4);
  });

  test('returns correct role counts', async () => {
    const s = await buildUserSummary();
    expect(s.byRole.customer).toBe(2);
    expect(s.byRole.supplier).toBe(1);
    expect(s.byRole.admin).toBe(1);
  });

  test('returns correct google signup count', async () => {
    const s = await buildUserSummary();
    expect(s.bySignup.google).toBe(1);
  });

  test('returns correct pending supplier count', async () => {
    const s = await buildUserSummary();
    expect(s.suppliers.pending).toBe(1);
  });

  test('returns suppliersWithoutProfile count', async () => {
    // u2 is a supplier user but their supplier profile exists (ownerUserId matches)
    const s = await buildUserSummary();
    expect(s.suppliers.suppliersWithoutProfile).toBe(0);
  });

  test('handles empty collections gracefully', async () => {
    mockDb.read.mockResolvedValue([]);
    const s = await buildUserSummary();
    expect(s.total).toBe(0);
    expect(s.suppliers.total).toBe(0);
  });

  test('returns dashboard account-health response shape', async () => {
    const s = await buildUserSummary();
    expect(s.summary).toEqual(
      expect.objectContaining({
        totalUsers: 4,
        customers: 2,
        suppliers: 1,
        admins: 1,
        pendingSupplierApprovals: 1,
        supplierLinkIssues: 0,
      })
    );
    expect(s.health).toEqual(
      expect.objectContaining({
        emailPasswordPending: 1,
        googleVerified: 1,
        eventflowEmailVerified: expect.any(Number),
        lastNewSignupAt: expect.any(String),
      })
    );
    expect(s.supplierHealth).toEqual(
      expect.objectContaining({
        totalSupplierUsers: 1,
        totalSupplierProfiles: 1,
        pendingSuppliers: 1,
      })
    );
    expect(Array.isArray(s.actions)).toBe(true);
    expect(s.generatedAt).toEqual(expect.any(String));
  });

  test('handles legacy users missing optional fields and _id-only ids', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [{ _id: { toString: () => 'legacy-1' }, role: 'supplier' }, { email: null }];
      }
      if (col === 'suppliers') {
        return [];
      }
      return [];
    });
    await expect(buildUserSummary()).resolves.toEqual(expect.objectContaining({ total: 2 }));
    const listed = await listUsers({});
    expect(listed.items[0]).not.toHaveProperty('passwordHash');
  });

  test('handles supplier users without profiles and profiles without linked users', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [makeUser({ id: 'supplier-user', role: 'supplier' })];
      }
      if (col === 'suppliers') {
        return [makeSupplier({ id: 'orphan-supplier', ownerUserId: 'missing-user' })];
      }
      return [];
    });
    const s = await buildUserSummary();
    expect(s.suppliers.suppliersWithoutProfile).toBe(1);
    expect(s.suppliers.orphanedSuppliers).toBe(1);
    expect(s.supplierHealth.linkIssues).toBe(2);
  });

  test('includes verification email provenance counts without exposing secrets', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [
          makeUser({
            id: 'u-google',
            authProvider: 'google',
            googleSub: 'raw-google-sub',
            verified: true,
          }),
          makeUser({
            id: 'u-email',
            email: 'email@test.com',
            verified: false,
            passwordHash: 'hash',
            verificationToken: 'secret-token',
            resetToken: 'reset-secret',
          }),
        ];
      }
      if (col === 'email_logs') {
        return [
          {
            template: 'verification',
            to: 'email@test.com',
            status: 'failed',
            createdAt: new Date().toISOString(),
          },
          {
            template: 'verification',
            to: 'email@test.com',
            status: 'bounced',
            provider: 'outbox',
            createdAt: new Date().toISOString(),
          },
        ];
      }
      return [];
    });
    const s = await buildUserSummary();
    expect(s.health.googleVerified).toBe(1);
    expect(s.health.verificationEmailFailures).toBe(1);
    expect(s.health.verificationBounces).toBe(1);
    expect(s.health.verificationOutboxFallbacks).toBe(1);
    expect(JSON.stringify(s)).not.toContain('raw-google-sub');
    expect(JSON.stringify(s)).not.toContain('secret-token');
    expect(JSON.stringify(s)).not.toContain('reset-secret');
  });

  test('throws when the required users collection cannot be read', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        throw new Error('users unavailable');
      }
      return [];
    });
    await expect(buildUserSummary()).rejects.toThrow('users unavailable');
    await expect(listUsers({})).rejects.toThrow('users unavailable');
  });

  test('does not throw when suppliers collection is missing', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [makeUser({ id: 'u1' })];
      }
      if (col === 'suppliers') {
        throw new Error('collection missing');
      }
      return [];
    });
    await expect(buildUserSummary()).resolves.toEqual(expect.objectContaining({ total: 1 }));
  });

  test('uses packages collection when counting supplier profiles without packages', async () => {
    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return [makeUser({ id: 'u1', role: 'supplier' })];
      }
      if (col === 'suppliers') {
        return [makeSupplier({ id: 'sup-with-package', ownerUserId: 'u1', packages: [] })];
      }
      if (col === 'packages') {
        return [{ id: 'pkg1', supplierId: 'sup-with-package' }];
      }
      return [];
    });
    const s = await buildUserSummary();
    expect(s.supplierHealth.withoutPackages).toBe(0);
  });
});

// ── listUsers ─────────────────────────────────────────────────────────────────
describe('listUsers — filtering', () => {
  const users = [
    makeUser({
      id: 'u1',
      role: 'customer',
      name: 'Alice',
      email: 'alice@test.com',
      verified: true,
      passwordHash: '$2b$',
    }),
    makeUser({
      id: 'u2',
      role: 'supplier',
      name: 'Bob',
      email: 'bob@test.com',
      verified: false,
      passwordHash: '$2b$',
    }),
    makeUser({ id: 'u3', role: 'admin', name: 'Carol', email: 'carol@test.com', verified: true }),
    makeUser({
      id: 'u-missing',
      role: 'supplier',
      name: 'Missing',
      email: 'missing@test.com',
      verified: true,
    }),
    makeUser({
      id: 'u4',
      role: 'customer',
      name: 'Dave',
      email: 'dave@test.com',
      verified: true,
      authProvider: 'google',
      googleSub: 'g1',
    }),
  ];
  const suppliers = [makeSupplier({ ownerUserId: 'u2' })];

  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.read.mockImplementation(async col =>
      col === 'users' ? users : col === 'suppliers' ? suppliers : []
    );
  });

  test('filters by role', async () => {
    const result = await listUsers({ role: 'customer' });
    expect(result.items.every(u => u.role === 'customer')).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  test('filters by signupMethod', async () => {
    const result = await listUsers({ signupMethod: 'google' });
    expect(result.items).toHaveLength(1);
    expect(result.items.every(u => u.signupMethod === 'google')).toBe(true);
  });

  test('filters by verificationMethod pending', async () => {
    const result = await listUsers({ verificationMethod: 'pending' });
    expect(result.items).toHaveLength(1);
    expect(result.items.every(u => u.verificationMethod === 'pending')).toBe(true);
  });

  test('searches by name (case-insensitive)', async () => {
    const result = await listUsers({ search: 'alice' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Alice');
  });

  test('searches by email', async () => {
    const result = await listUsers({ search: 'bob@' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].email).toBe('bob@test.com');
  });

  test('filters by account issue', async () => {
    const result = await listUsers({ issue: 'supplier_profile_missing' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('u-missing');
    expect(result.items.every(u => u.accountIssues.includes('supplier_profile_missing'))).toBe(
      true
    );
  });

  test('does not expose secrets in list output', async () => {
    const result = await listUsers({});
    result.items.forEach(u => {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('password');
      expect(u).not.toHaveProperty('googleSub');
      expect(u).not.toHaveProperty('resetToken');
      expect(u).not.toHaveProperty('verificationToken');
      expect(u).not.toHaveProperty('authProviderIds');
    });
  });

  test('paginates correctly', async () => {
    const result = await listUsers({ page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.pages).toBe(3);
    expect(result.total).toBe(5);
  });

  test('clamps out-of-range page and invalid limit safely', async () => {
    const result = await listUsers({ page: 99, limit: -5 });
    expect(result.page).toBe(5);
    expect(result.limit).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(5);
  });
});

// ── getUserDetail ─────────────────────────────────────────────────────────────
describe('getUserDetail', () => {
  const user = makeUser({
    id: 'u1',
    role: 'supplier',
    passwordHash: '$2b$10$x',
    googleSub: 'g123',
    resetToken: 'rt',
  });
  const supplier = makeSupplier({ ownerUserId: 'u1' });

  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.findOne.mockResolvedValue(user);
    mockDb.find.mockResolvedValue([supplier]);
    mockDb.read.mockImplementation(async col => (col === 'suppliers' ? [supplier] : []));
  });

  test('returns null for non-existent user', async () => {
    mockDb.findOne.mockResolvedValue(null);
    const result = await getUserDetail('nonexistent');
    expect(result).toBeNull();
  });

  test('returns safe user projection', async () => {
    const result = await getUserDetail('u1');
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('googleSub');
    expect(result).not.toHaveProperty('resetToken');
  });

  test('includes supplier linkage', async () => {
    const result = await getUserDetail('u1');
    expect(result.supplierProfile).not.toBeNull();
    expect(result.supplierProfile.id).toBe('sup1');
  });

  test.each(['ownerUserId', 'userId', 'ownerId', 'user_id'])(
    'includes supplier linkage via %s',
    async field => {
      const linkedSupplier = makeSupplier({ ownerUserId: undefined, [field]: 'u1' });
      mockDb.find.mockResolvedValue([]);
      mockDb.read.mockImplementation(async col => (col === 'suppliers' ? [linkedSupplier] : []));
      const result = await getUserDetail('u1');
      expect(result.supplierProfile).not.toBeNull();
      expect(result.supplierProfile.id).toBe('sup1');
    }
  );

  test('includes Google link indicator without googleSub', async () => {
    const result = await getUserDetail('u1');
    expect(result.hasGoogleLink).toBe(true);
    expect(result).not.toHaveProperty('googleSub');
  });
});

// ── Admin user summary API route ─────────────────────────────────────────────
describe('admin user summary route', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.read.mockResolvedValue([]);
  });

  test('GET /api/admin/users/list applies server-side filters and pagination', async () => {
    const express = require('express');
    const request = require('supertest');
    const routes = require('../../routes/admin-user-management');
    const app = express();
    app.use('/api/admin', routes);

    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        return Array.from({ length: 75 }, (_v, i) =>
          makeUser({
            id: `u${i + 1}`,
            role: i % 2 === 0 ? 'customer' : 'supplier',
            name: `User ${i + 1}`,
            email: `user${i + 1}@example.com`,
            verified: i % 3 !== 0,
            authProvider: i === 60 ? 'google' : undefined,
            googleSub: i === 60 ? 'google-sub' : undefined,
          })
        );
      }
      if (col === 'suppliers') {
        return [];
      }
      return [];
    });

    const res = await request(app)
      .get('/api/admin/users/list')
      .query({ role: 'customer', page: 2, limit: 10 })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.total).toBe(38);
    expect(res.body.page).toBe(2);
    expect(res.body.pages).toBe(4);
    expect(res.body.items.every(user => user.role === 'customer')).toBe(true);
  });

  test('GET /api/admin/users/summary returns controlled error when users read fails', async () => {
    const express = require('express');
    const request = require('supertest');
    const routes = require('../../routes/admin-user-management');
    const app = express();
    app.use('/api/admin', routes);

    mockDb.read.mockImplementation(async col => {
      if (col === 'users') {
        throw new Error('users unavailable');
      }
      return [];
    });

    const res = await request(app).get('/api/admin/users/summary').expect(500);
    expect(res.body).toEqual({ ok: false, error: 'Failed to build user summary' });
  });

  test('GET /api/admin/users/summary returns 200 with an empty database', async () => {
    const express = require('express');
    const request = require('supertest');
    const routes = require('../../routes/admin-user-management');
    const app = express();
    app.use('/api/admin', routes);

    const res = await request(app).get('/api/admin/users/summary').expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.summary.totalUsers).toBe(0);
    expect(res.body.health.emailPasswordPending).toBe(0);
    expect(res.body.supplierHealth.totalSupplierProfiles).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|verificationToken|resetToken|googleSub/
    );
  });
});

// ── Admin registry ─────────────────────────────────────────────────────────────
describe('Admin registry', () => {
  const { REGISTRY, getAdminPagesAllowlist, getNavItems } = require('../../config/adminRegistry');

  test('Users Centre is in registry with updated label', () => {
    const usersPage = REGISTRY.find(p => p.route === '/admin-users');
    expect(usersPage).toBeTruthy();
    expect(usersPage.label).toBe('Users Centre');
  });

  test('Users Centre is in nav', () => {
    const nav = getNavItems();
    const usersPage = nav.find(p => p.route === '/admin-users');
    expect(usersPage).toBeTruthy();
    expect(usersPage.inNav).toBe(true);
  });

  test('user-detail and supplier-detail are NOT in nav (detail pages are hidden)', () => {
    const nav = getNavItems();
    expect(nav.find(p => p.route === '/admin-user-detail')).toBeFalsy();
    expect(nav.find(p => p.route === '/admin-supplier-detail')).toBeFalsy();
  });

  test('getAdminPagesAllowlist includes both /admin-users and /admin-users.html', () => {
    const allowlist = getAdminPagesAllowlist();
    expect(allowlist).toContain('/admin-users');
    expect(allowlist).toContain('/admin-users.html');
  });
});
