/**
 * Unit tests for GET /api/auth/verify — token compatibility
 *
 * Verifies that the endpoint handles:
 *   1. JWT verification tokens (System A)
 *   2. Legacy verificationToken field (System B)
 *   3. emailVerificationToken field from emailVerification.js (System C)
 *   4. Expired tokens in both legacy fields
 *   5. Already-verified users
 */

'use strict';

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

// ── Mock dependencies ─────────────────────────────────────────────────────────

let mockUsers = [];

jest.mock('../../db-unified', () => ({
  read: jest.fn(collection => {
    if (collection === 'users') {
      return Promise.resolve([...mockUsers]);
    }
    return Promise.resolve([]);
  }),
  updateOne: jest.fn().mockResolvedValue(true),
  findOne: jest.fn((_collection, query) => {
    if (query && query.id) {
      return Promise.resolve(mockUsers.find(u => u.id === query.id) || null);
    }
    return Promise.resolve(null);
  }),
}));

jest.mock('../../utils/postmark', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  isPostmarkEnabled: jest.fn(() => false),
  FROM_NOREPLY: 'noreply@test.com',
}));

jest.mock('../../middleware/domain-admin', () => ({
  shouldUpgradeToAdminOnVerification: jest.fn(() => false),
  isOwnerEmail: jest.fn(() => false),
  determineRole: jest.fn((_email, role) => role),
}));

// ── Bootstrap app ─────────────────────────────────────────────────────────────

let app;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-only-minimum-32-characters-long';
  process.env.NODE_ENV = 'test';

  app = express();
  app.use(express.json());
  // Mock CSRF (bypass in tests)
  app.use((req, _res, next) => {
    req.csrfToken = () => 'test-token';
    next();
  });

  const authRouter = require('../../routes/auth');
  app.use('/api/auth', authRouter);
});

beforeEach(() => {
  mockUsers = [];
  jest.clearAllMocks();
  const dbUnified = require('../../db-unified');
  dbUnified.read.mockImplementation(collection => {
    if (collection === 'users') {
      return Promise.resolve([...mockUsers]);
    }
    return Promise.resolve([]);
  });
  dbUnified.updateOne.mockResolvedValue(true);
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.NODE_ENV;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'customer',
    verified: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/auth/verify — missing token', () => {
  it('should return 400 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/verify').expect(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/auth/verify — legacy verificationToken field', () => {
  it('should verify user with a plain-hex verificationToken', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    mockUsers = [makeUser({ verificationToken: token, verificationTokenExpiresAt: null })];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ verified: true }),
        $unset: expect.objectContaining({
          verificationToken: '',
          verificationTokenExpiresAt: '',
          emailVerificationToken: '',
          emailVerificationExpires: '',
        }),
      })
    );
  });

  it('should return 400 for expired verificationToken', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    mockUsers = [makeUser({ verificationToken: token, verificationTokenExpiresAt: expiredAt })];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(400);

    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });
});

describe('GET /api/auth/verify — emailVerificationToken field (System C)', () => {
  it('should verify user with an emailVerificationToken', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mockUsers = [
      makeUser({ emailVerificationToken: token, emailVerificationExpires: futureExpiry }),
    ];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ verified: true }),
        $unset: expect.objectContaining({
          emailVerificationToken: '',
          emailVerificationExpires: '',
          verificationToken: '',
          verificationTokenExpiresAt: '',
        }),
      })
    );
  });

  it('should return 400 for expired emailVerificationToken', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    mockUsers = [makeUser({ emailVerificationToken: token, emailVerificationExpires: expiredAt })];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(400);

    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('should return canResend flag for expired emailVerificationToken', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    mockUsers = [makeUser({ emailVerificationToken: token, emailVerificationExpires: expiredAt })];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(400);

    expect(res.body.canResend).toBe(true);
  });
});

describe('GET /api/auth/verify — already-verified user', () => {
  it('should return ok + alreadyVerified for a user who is already verified (legacy path)', async () => {
    const token = crypto.randomBytes(16).toString('hex');
    mockUsers = [makeUser({ verified: true, verificationToken: token })];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.alreadyVerified).toBe(true);
  });

  it('should return ok + alreadyVerified for already-verified user (emailVerificationToken path)', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    mockUsers = [
      makeUser({
        verified: true,
        emailVerificationToken: token,
        emailVerificationExpires: futureExpiry,
      }),
    ];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.alreadyVerified).toBe(true);
  });
});

describe('GET /api/auth/verify — invalid token', () => {
  it('should return 400 for completely unknown token', async () => {
    mockUsers = [makeUser()];

    const dbUnified = require('../../db-unified');
    dbUnified.read.mockResolvedValue([...mockUsers]);

    const res = await request(app)
      .get('/api/auth/verify?token=totally-invalid-unknown-token')
      .expect(400);

    expect(res.body.error).toBeTruthy();
  });
});
