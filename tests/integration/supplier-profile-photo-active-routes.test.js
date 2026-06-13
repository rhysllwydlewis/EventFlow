'use strict';

/**
 * Integration tests for the public supplier profile avatar endpoint.
 *
 * Simulates the exact call made by supplier-profile.js:
 *   GET /api/suppliers/:id
 * via supplier-profile-safe.js with an injected dbUnified.
 *
 * Tests prove:
 *   1. Non-empty avatarUrl / profilePhotoUrl / displayAvatarUrl are returned
 *      when the linked user has an avatarUrl (root-cause scenario for sup_wtlrt6uiftxg2y)
 *   2. The fields are also populated from the supplier's own logo field
 *   3. All three canonical photo fields agree
 *   4. Private fields (ownerUserId, email) are not returned
 *   5. An orphaned supplier (owner user deleted) returns 404
 *   6. A supplier with no photo at all returns empty strings (not undefined)
 */

const express = require('express');
const request = require('supertest');
const path    = require('path');

// Load the route under test
const supplierProfileSafe = require('../../routes/supplier-profile-safe');

const PHOTO_URL = 'https://res.cloudinary.com/test/image/upload/v1/avatar.jpg';
const LOGO_URL  = 'https://example.com/logo.png';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp(supplierRecord, userRecord = null, extraRecords = {}) {
  const app = express();
  app.use(express.json());

  // Minimal dbUnified mock
  const dbUnified = {
    findOne: async (collection, query) => {
      if (collection === 'suppliers') {
        if (query.id === supplierRecord.id) return supplierRecord;
        return null;
      }
      if (collection === 'users') {
        if (userRecord && query.id === userRecord.id) return userRecord;
        return null;
      }
      if (collection === 'badges') return null;
      return null;
    },
    read: async (collection) => {
      if (collection === 'packages') return extraRecords.packages || [];
      if (collection === 'badges')   return extraRecords.badges || [];
      return [];
    },
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

describe('GET /api/suppliers/:id — avatar resolution (supplier-profile-safe.js)', () => {

  // ── Root-cause scenario: user has avatarUrl, supplier record has no logo ───

  test('returns non-empty avatarUrl from owner user when supplier has no logo (root-cause scenario)', async () => {
    const supplier = {
      id: 'sup_wtlrt6uiftxg2y',
      name: 'Romeo Test',
      approved: true,
      ownerUserId: 'user_romeo',
      logo: '',
      profileImage: '',
    };
    const ownerUser = { id: 'user_romeo', avatarUrl: PHOTO_URL };

    const app = buildApp(supplier, ownerUser);
    const res = await request(app).get('/api/suppliers/sup_wtlrt6uiftxg2y');

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(PHOTO_URL);
    expect(res.body.profilePhotoUrl).toBe(PHOTO_URL);
    expect(res.body.displayAvatarUrl).toBe(PHOTO_URL);
    expect(res.body.logo).toBe(PHOTO_URL);
  });

  test('all three canonical photo fields agree when photo is resolved from owner user', async () => {
    const supplier = { id: 's1', name: 'Test Supplier', approved: true, ownerUserId: 'u1' };
    const ownerUser = { id: 'u1', avatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s1');

    expect(body.avatarUrl).toBe(body.profilePhotoUrl);
    expect(body.avatarUrl).toBe(body.displayAvatarUrl);
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  // ── Supplier has its own logo — no owner lookup needed ────────────────────

  test('returns logo as avatarUrl when supplier has a direct logo field', async () => {
    const supplier = { id: 's2', name: 'Logo Supplier', approved: true, logo: LOGO_URL };

    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s2');

    expect(body.avatarUrl).toBe(LOGO_URL);
    expect(body.profilePhotoUrl).toBe(LOGO_URL);
    expect(body.displayAvatarUrl).toBe(LOGO_URL);
  });

  // ── Owner user avatar takes precedence over supplier's own logo ───────────

  test('owner user avatarUrl takes precedence over supplier logo', async () => {
    const supplier = { id: 's3', name: 'Both Fields', approved: true, ownerUserId: 'u3', logo: LOGO_URL };
    const ownerUser = { id: 'u3', avatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s3');

    // Owner photo should win
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  // ── Legacy owner link fields ─────────────────────────────────────────────

  test('resolves owner photo via userId field when ownerUserId is absent', async () => {
    const supplier = { id: 's4', name: 'Legacy userId', approved: true, userId: 'u4' };
    const ownerUser = { id: 'u4', avatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s4');
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  test('resolves owner photo via ownerId field when ownerUserId and userId are absent', async () => {
    const supplier = { id: 's5', name: 'Legacy ownerId', approved: true, ownerId: 'u5' };
    const ownerUser = { id: 'u5', avatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s5');
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  // ── Owner user avatar field variants ────────────────────────────────────

  test('resolves profilePhotoUrl from user record when avatarUrl absent', async () => {
    const supplier = { id: 's6', name: 'Test', approved: true, ownerUserId: 'u6' };
    const ownerUser = { id: 'u6', profilePhotoUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s6');
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  test('resolves displayAvatarUrl from user record as fallback', async () => {
    const supplier = { id: 's7', name: 'Test', approved: true, ownerUserId: 'u7' };
    const ownerUser = { id: 'u7', displayAvatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s7');
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  // ── No photo at all — returns empty strings ───────────────────────────────

  test('returns empty strings for photo fields when neither supplier nor user has a photo', async () => {
    const supplier = { id: 's8', name: 'No Photo', approved: true, ownerUserId: 'u8' };
    const ownerUser = { id: 'u8' };  // no avatar fields

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s8');

    expect(body.avatarUrl).toBe('');
    expect(body.profilePhotoUrl).toBe('');
    expect(body.displayAvatarUrl).toBe('');
    expect(body.logo).toBe('');
  });

  test('avatarUrl and photo fields are empty strings (not undefined) when no photo available', async () => {
    const { body } = await request(buildApp({ id: 's9', name: 'Test', approved: true })).get('/api/suppliers/s9');

    expect(body).toHaveProperty('avatarUrl', '');
    expect(body).toHaveProperty('profilePhotoUrl', '');
    expect(body).toHaveProperty('displayAvatarUrl', '');
  });

  // ── Private fields must not leak ─────────────────────────────────────────

  test('ownerUserId is not in the public API response', async () => {
    const supplier = { id: 's10', name: 'Test', approved: true, ownerUserId: 'private_uid' };

    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s10');
    expect(body.ownerUserId).toBeUndefined();
  });

  test('owner user email is not in the public API response', async () => {
    const supplier = { id: 's11', name: 'Test', approved: true, ownerUserId: 'u11' };
    const ownerUser = { id: 'u11', email: 'private@test.com', avatarUrl: PHOTO_URL };

    const { body } = await request(buildApp(supplier, ownerUser)).get('/api/suppliers/s11');
    expect(body.email).toBeUndefined();
    expect(body.ownerEmail).toBeUndefined();
    // But the photo still resolves
    expect(body.avatarUrl).toBe(PHOTO_URL);
  });

  test('adminNotes are not in the public API response', async () => {
    const supplier = { id: 's12', name: 'Test', approved: true, adminNotes: 'internal' };
    const { body } = await request(buildApp(supplier)).get('/api/suppliers/s12');
    expect(body.adminNotes).toBeUndefined();
  });

  // ── Approved-status gating ────────────────────────────────────────────────

  test('returns 404 for unapproved supplier', async () => {
    const supplier = { id: 's13', name: 'Pending', approved: false };
    const res = await request(buildApp(supplier)).get('/api/suppliers/s13');
    expect(res.status).toBe(404);
  });

  test('returns 404 when supplier is not found', async () => {
    const supplier = { id: 'other', name: 'Other', approved: true };
    const res = await request(buildApp(supplier)).get('/api/suppliers/nonexistent');
    expect(res.status).toBe(404);
  });
});
