'use strict';

/**
 * Integration tests — GET /api/suppliers/:id avatar resolution
 *
 * Simulates supplier-profile.js calling /api/suppliers/sup_wtlrt6uiftxg2y
 * via supplier-profile-safe.js with a mocked dbUnified.
 *
 * Covers the root-cause scenario:
 *   Supplier record has no logo/profileImage
 *   Owner user record has avatarUrl
 *   → API must return non-empty avatarUrl / profilePhotoUrl / displayAvatarUrl
 *
 * Also covers:
 *   - All legacy owner-link fields (userId, ownerId, accountId, createdByUserId, createdBy, createdById)
 *   - All user avatar field names (avatarUrl, profilePhotoUrl, displayAvatarUrl, photoUrl, profileImage, image)
 *   - Nested profile.avatarUrl on user record
 *   - No photo at all → empty strings
 *   - Private fields NOT leaked
 *   - 404 for unapproved / missing suppliers
 */

const express = require('express');
const request = require('supertest');

const supplierProfileSafe = require('../../routes/supplier-profile-safe');

const PHOTO = 'https://res.cloudinary.com/test/image/upload/v1/avatar.jpg';
const LOGO  = 'https://example.com/logo.png';

// ─── Test app factory ─────────────────────────────────────────────────────────

function buildApp(supplierRecord, userRecord = null) {
  const app = express();
  app.use(express.json());

  const dbUnified = {
    findOne: async (collection, query) => {
      if (collection === 'suppliers') {
        return query.id === supplierRecord.id ? supplierRecord : null;
      }
      if (collection === 'users' && userRecord) {
        return query.id === userRecord.id ? userRecord : null;
      }
      return null;
    },
    read: async () => [],
  };

  supplierProfileSafe.initializeDependencies({
    dbUnified,
    getUserFromCookie: () => null,
    supplierIsProActive: async () => false,
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  });

  app.use('/api', supplierProfileSafe);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/suppliers/:id — profile photo resolution', () => {

  // Root-cause scenario for sup_wtlrt6uiftxg2y
  test('returns non-empty avatarUrl when owner user has avatarUrl and supplier has no logo', async () => {
    const supplier = {
      id: 'sup_wtlrt6uiftxg2y',
      name: 'Romeo Test',
      approved: true,
      ownerUserId: 'user_romeo',
      logo: '',
      profileImage: '',
    };
    const user = { id: 'user_romeo', avatarUrl: PHOTO };

    const { status, body } = await request(buildApp(supplier, user))
      .get('/api/suppliers/sup_wtlrt6uiftxg2y');

    expect(status).toBe(200);
    expect(body.avatarUrl).toBe(PHOTO);
    expect(body.profilePhotoUrl).toBe(PHOTO);
    expect(body.displayAvatarUrl).toBe(PHOTO);
  });

  test('all three canonical photo fields agree', async () => {
    const supplier = { id: 's1', name: 'Test', approved: true, ownerUserId: 'u1' };
    const user = { id: 'u1', avatarUrl: PHOTO };

    const { body } = await request(buildApp(supplier, user)).get('/api/suppliers/s1');

    expect(body.avatarUrl).toBe(body.profilePhotoUrl);
    expect(body.avatarUrl).toBe(body.displayAvatarUrl);
    expect(body.avatarUrl).toBe(PHOTO);
  });

  // Legacy owner-link fields
  const LINK_FIELDS = [
    { field: 'ownerUserId',      userId: 'u_a' },
    { field: 'userId',           userId: 'u_b' },
    { field: 'ownerId',          userId: 'u_c' },
    { field: 'accountId',        userId: 'u_d' },
    { field: 'createdByUserId',  userId: 'u_e' },
    { field: 'createdBy',        userId: 'u_f' },
    { field: 'createdById',      userId: 'u_g' },
  ];

  LINK_FIELDS.forEach(({ field, userId }) => {
    test(`resolves owner photo via supplier.${field}`, async () => {
      const supplier = { id: 's_' + field, name: 'Test', approved: true, [field]: userId };
      const user = { id: userId, avatarUrl: PHOTO };

      const { body } = await request(buildApp(supplier, user))
        .get('/api/suppliers/s_' + field);

      expect(body.avatarUrl).toBe(PHOTO);
    });
  });

  // User avatar field variants
  const USER_AVATAR_FIELDS = [
    'avatarUrl', 'profilePhotoUrl', 'displayAvatarUrl',
    'photoUrl', 'profileImage', 'image',
  ];

  USER_AVATAR_FIELDS.forEach(field => {
    test(`resolves photo from user.${field}`, async () => {
      const supplier = { id: 's_u_' + field, name: 'Test', approved: true, ownerUserId: 'u_' + field };
      const user = { id: 'u_' + field, [field]: PHOTO };

      const { body } = await request(buildApp(supplier, user))
        .get('/api/suppliers/s_u_' + field);

      expect(body.avatarUrl).toBe(PHOTO);
    });
  });

  // Nested profile.avatarUrl on user record
  test('resolves photo from user.profile.avatarUrl when top-level fields absent', async () => {
    const supplier = { id: 's_nested', name: 'Test', approved: true, ownerUserId: 'u_nested' };
    const user = { id: 'u_nested', profile: { avatarUrl: PHOTO } };

    const { body } = await request(buildApp(supplier, user)).get('/api/suppliers/s_nested');
    expect(body.avatarUrl).toBe(PHOTO);
  });

  // Supplier has its own logo — no user lookup needed
  test('returns supplier logo as avatarUrl when supplier has direct logo', async () => {
    const supplier = { id: 's_logo', name: 'Test', approved: true, logo: LOGO };

    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s_logo');
    expect(body.avatarUrl).toBe(LOGO);
    expect(body.profilePhotoUrl).toBe(LOGO);
    expect(body.displayAvatarUrl).toBe(LOGO);
  });

  // Owner photo beats supplier logo
  test('owner avatarUrl takes precedence over supplier logo', async () => {
    const supplier = { id: 's_both', name: 'Test', approved: true, ownerUserId: 'u_both', logo: LOGO };
    const user = { id: 'u_both', avatarUrl: PHOTO };

    const { body } = await request(buildApp(supplier, user)).get('/api/suppliers/s_both');
    expect(body.avatarUrl).toBe(PHOTO);
  });

  // No photo at all
  test('returns empty strings for photo fields when neither supplier nor user has a photo', async () => {
    const supplier = { id: 's_none', name: 'Test', approved: true, ownerUserId: 'u_none' };
    const user = { id: 'u_none' };

    const { body } = await request(buildApp(supplier, user)).get('/api/suppliers/s_none');
    expect(body.avatarUrl).toBe('');
    expect(body.profilePhotoUrl).toBe('');
    expect(body.displayAvatarUrl).toBe('');
  });

  test('photo fields are empty strings (not undefined) when no photo set', async () => {
    const { body } = await request(buildApp({ id: 's_empty', name: 'Test', approved: true }))
      .get('/api/suppliers/s_empty');

    expect(body).toHaveProperty('avatarUrl', '');
    expect(body).toHaveProperty('profilePhotoUrl', '');
    expect(body).toHaveProperty('displayAvatarUrl', '');
  });

  // Private field isolation
  test('ownerUserId not in public response', async () => {
    const supplier = { id: 's_priv', name: 'Test', approved: true, ownerUserId: 'private_uid' };
    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s_priv');
    expect(body.ownerUserId).toBeUndefined();
  });

  test('owner user email not in public response', async () => {
    const supplier = { id: 's_email', name: 'Test', approved: true, ownerUserId: 'u_email' };
    const user = { id: 'u_email', email: 'private@test.com', avatarUrl: PHOTO };

    const { body } = await request(buildApp(supplier, user)).get('/api/suppliers/s_email');
    expect(body.email).toBeUndefined();
    expect(body.avatarUrl).toBe(PHOTO); // photo still resolves
  });

  test('adminNotes not in public response', async () => {
    const supplier = { id: 's_admin', name: 'Test', approved: true, adminNotes: 'internal' };
    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s_admin');
    expect(body.adminNotes).toBeUndefined();
  });

  // Gating
  test('returns 404 for unapproved supplier', async () => {
    const { status } = await request(buildApp({ id: 's_pend', name: 'Pending', approved: false }))
      .get('/api/suppliers/s_pend');
    expect(status).toBe(404);
  });

  test('returns 404 when supplier not found', async () => {
    const { status } = await request(buildApp({ id: 'other', name: 'Other', approved: true }))
      .get('/api/suppliers/nonexistent');
    expect(status).toBe(404);
  });
});
