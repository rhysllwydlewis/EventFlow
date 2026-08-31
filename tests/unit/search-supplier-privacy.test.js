'use strict';

// Regression coverage for a data-exposure bug: search.js used to spread raw
// supplier records (`{ ...s, ... }`) straight into API responses, leaking
// internal-only fields (email, phone, adminNotes, moderationNotes,
// stripeCustomerId, password/tokens) to any unauthenticated caller of
// /api/search/suppliers. Every function here must strip those fields the
// same way the other public supplier endpoints already do.

jest.mock('../../db-unified');

const dbUnified = require('../../db-unified');
const search = require('../../search');

const PRIVATE_FIELDS = [
  'email',
  'ownerEmail',
  'contactEmail',
  'phone',
  'password',
  'passwordHash',
  'tokens',
  'resetToken',
  'resetPasswordToken',
  'verificationToken',
  'adminNotes',
  'moderationNotes',
  'stripeCustomerId',
];

function rawSupplier(overrides = {}) {
  return {
    id: 'sup-1',
    name: 'Test Supplier',
    approved: true,
    category: 'catering',
    location: 'Cardiff',
    ownerUserId: 'user-1',
    email: 'owner@example.com',
    ownerEmail: 'owner-alt@example.com',
    contactEmail: 'contact@example.com',
    phone: '01234 567890',
    password: 'hashed',
    passwordHash: 'hashed-hash',
    tokens: ['secret-token'],
    resetToken: 'reset-token',
    resetPasswordToken: 'reset-pw-token',
    verificationToken: 'verify-token',
    adminNotes: 'Internal admin note',
    moderationNotes: 'Internal moderation note',
    stripeCustomerId: 'cus_123',
    ...overrides,
  };
}

function assertNoPrivateFields(supplier) {
  for (const field of PRIVATE_FIELDS) {
    expect(supplier).not.toHaveProperty(field);
  }
}

describe('search.js supplier privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('searchSuppliers() strips private fields from every result', async () => {
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([rawSupplier()]);
      }
      if (collection === 'reviews') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { results } = await search.searchSuppliers({});
    expect(results).toHaveLength(1);
    assertNoPrivateFields(results[0]);
    // Non-sensitive fields still come through.
    expect(results[0].id).toBe('sup-1');
    expect(results[0].name).toBe('Test Supplier');
  });

  test('getTrendingSuppliers() strips private fields', async () => {
    dbUnified.read.mockResolvedValue([rawSupplier()]);
    const trending = await search.getTrendingSuppliers(10);
    expect(trending).toHaveLength(1);
    assertNoPrivateFields(trending[0]);
  });

  test('getNewArrivals() strips private fields', async () => {
    dbUnified.read.mockResolvedValue([rawSupplier()]);
    const arrivals = await search.getNewArrivals(10);
    expect(arrivals).toHaveLength(1);
    assertNoPrivateFields(arrivals[0]);
  });

  test('getRecommendations() strips private fields for scored suppliers', async () => {
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'suppliers') {
        return Promise.resolve([rawSupplier({ category: 'catering', featured: true })]);
      }
      if (collection === 'searchHistory') {
        return Promise.resolve([
          { userId: 'user-42', category: 'catering', timestamp: new Date().toISOString() },
        ]);
      }
      return Promise.resolve([]);
    });

    const recommendations = await search.getRecommendations('user-42', 10);
    expect(recommendations).toHaveLength(1);
    assertNoPrivateFields(recommendations[0]);
  });
});
