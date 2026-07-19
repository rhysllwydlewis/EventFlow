'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const dbUnified = require('../db-unified');
const { buildPublicSupplierSlug } = require('../services/publicSupplierSeo.service');
const { buildPublicPackageSlug } = require('../services/publicListingSeo.service');

const router = express.Router();
const HEADER_NAME = 'x-eventflow-e2e';
const HEADER_VALUE = 'backend-suite';
const TEST_PASSWORD = 'E2ePassword123!';
const COLLECTIONS = [
  'users',
  'suppliers',
  'packages',
  'reviews',
  'threads',
  'marketplace_listings',
  'audit_logs',
  'analyticsEvents',
];

function normaliseRunId(value) {
  const runId = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(runId)) {
    return null;
  }
  return runId;
}

async function removeRun(runId) {
  await Promise.all(COLLECTIONS.map(name => dbUnified.deleteMany(name, { e2eRunId: runId })));
}

async function insert(collection, document) {
  const result = await dbUnified.insertOne(collection, document);
  if (!result) {
    throw new Error(`Failed to insert ${collection} fixture ${document.id || document._id || ''}`);
  }
  return result;
}

router.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).end();
  }
  if (req.get(HEADER_NAME) !== HEADER_VALUE) {
    return res.status(403).json({ error: 'E2E fixture header required' });
  }
  return next();
});

router.post('/seed', async (req, res, next) => {
  const runId = normaliseRunId(req.body && req.body.runId);
  if (!runId) {
    return res.status(400).json({ error: 'runId must contain 3-64 lowercase letters, numbers or hyphens' });
  }

  try {
    await removeRun(runId);
    const now = new Date().toISOString();
    const prefix = `e2e-${runId}`;
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

    const users = {
      admin: {
        id: `${prefix}-admin-user`,
        name: `E2E Admin ${runId}`,
        firstName: 'E2E',
        lastName: 'Admin',
        email: `${prefix}-admin@example.test`,
        role: 'admin',
        passwordHash,
        location: 'Cardiff',
        verified: true,
        createdAt: now,
        e2eRunId: runId,
      },
      customer: {
        id: `${prefix}-customer-user`,
        name: `E2E Customer ${runId}`,
        firstName: 'E2E',
        lastName: 'Customer',
        email: `${prefix}-customer@example.test`,
        role: 'customer',
        passwordHash,
        location: 'Cardiff',
        verified: true,
        createdAt: now,
        e2eRunId: runId,
      },
      supplier: {
        id: `${prefix}-supplier-user`,
        name: `E2E Supplier ${runId}`,
        firstName: 'E2E',
        lastName: 'Supplier',
        email: `${prefix}-supplier@example.test`,
        role: 'supplier',
        passwordHash,
        location: 'Cardiff',
        company: `E2E Valley Events ${runId}`,
        verified: true,
        createdAt: now,
        e2eRunId: runId,
      },
      pendingSupplier: {
        id: `${prefix}-pending-supplier-user`,
        name: `E2E Pending Supplier ${runId}`,
        firstName: 'E2E',
        lastName: 'Pending Supplier',
        email: `${prefix}-pending-supplier@example.test`,
        role: 'supplier',
        passwordHash,
        location: 'Swansea',
        company: `E2E Pending Events ${runId}`,
        verified: true,
        createdAt: now,
        e2eRunId: runId,
      },
      unverifiedEmail: {
        id: `${prefix}-unverified-user`,
        name: `E2E Unverified ${runId}`,
        firstName: 'E2E',
        lastName: 'Unverified',
        email: `${prefix}-unverified@example.test`,
        role: 'supplier',
        passwordHash,
        location: 'Newport',
        company: `E2E Unverified Events ${runId}`,
        verified: false,
        createdAt: now,
        e2eRunId: runId,
      },
    };

    await Promise.all(Object.values(users).map(user => insert('users', user)));

    const approvedSupplier = {
      id: `${prefix}-supplier`,
      ownerUserId: users.supplier.id,
      name: `E2E Valley Events ${runId}`,
      businessName: `E2E Valley Events ${runId}`,
      category: 'Photography',
      categories: ['Photography'],
      location: 'Cardiff, Wales',
      postcode: 'CF10 1AA',
      email: users.supplier.email,
      phone: '02920000001',
      description: `Deterministic approved supplier fixture for ${runId}.`,
      description_short: 'Trusted event photography and planning services.',
      tagline: 'Documenting celebrations across Wales',
      approved: true,
      verified: true,
      verificationStatus: 'approved',
      createdAt: now,
      updatedAt: now,
      e2eRunId: runId,
    };

    const pendingSupplier = {
      id: `${prefix}-pending-supplier`,
      ownerUserId: users.pendingSupplier.id,
      name: `E2E Pending Events ${runId}`,
      businessName: `E2E Pending Events ${runId}`,
      category: 'Venues',
      categories: ['Venues'],
      location: 'Swansea, Wales',
      postcode: 'SA1 1AA',
      email: users.pendingSupplier.email,
      phone: '01792000001',
      description: `Complete supplier profile awaiting verification for ${runId}.`,
      approved: false,
      verified: false,
      verificationStatus: 'unverified',
      verificationSubmittedAt: null,
      createdAt: now,
      updatedAt: now,
      e2eRunId: runId,
    };

    await insert('suppliers', approvedSupplier);
    await insert('suppliers', pendingSupplier);

    const approvedPackage = {
      id: `${prefix}-package`,
      supplierId: approvedSupplier.id,
      title: `E2E Celebration Photography ${runId}`,
      slug: `e2e-celebration-photography-${runId}`,
      description: 'A full-day photography package with an edited online gallery.',
      price: 750,
      primaryCategoryKey: 'photography',
      categories: ['photography'],
      eventTypes: ['wedding', 'birthday'],
      tags: ['full day', 'online gallery'],
      approved: true,
      paused: false,
      featured: true,
      createdAt: now,
      updatedAt: now,
      e2eRunId: runId,
    };
    const pausedPackage = {
      ...approvedPackage,
      id: `${prefix}-paused-package`,
      title: `E2E Paused Package ${runId}`,
      slug: `e2e-paused-package-${runId}`,
      paused: true,
      featured: false,
    };
    const unapprovedPackage = {
      ...approvedPackage,
      id: `${prefix}-unapproved-package`,
      title: `E2E Unapproved Package ${runId}`,
      slug: `e2e-unapproved-package-${runId}`,
      approved: false,
      featured: false,
    };
    await insert('packages', approvedPackage);
    await insert('packages', pausedPackage);
    await insert('packages', unapprovedPackage);

    const approvedReview = {
      _id: `${prefix}-approved-review`,
      id: `${prefix}-approved-review`,
      supplierId: approvedSupplier.id,
      authorId: users.customer.id,
      authorName: users.customer.name,
      rating: 5,
      title: 'Excellent and reliable',
      text: `A genuinely excellent service for ${runId}.`,
      createdAt: now,
      updatedAt: now,
      verification: { status: 'verified_booking', verifiedAt: now },
      moderation: { state: 'approved', autoApproved: false, moderatedAt: now },
      votes: { helpful: 2, unhelpful: 0 },
      e2eRunId: runId,
    };
    const pendingReview = {
      _id: `${prefix}-pending-review`,
      id: `${prefix}-pending-review`,
      supplierId: approvedSupplier.id,
      authorId: users.pendingSupplier.id,
      authorName: users.pendingSupplier.name,
      rating: 1,
      title: 'Pending moderation fixture',
      text: `This review must remain hidden for ${runId}.`,
      createdAt: now,
      updatedAt: now,
      verification: { status: 'unverified', verifiedAt: null },
      moderation: { state: 'pending', autoApproved: false, moderatedAt: null },
      votes: { helpful: 0, unhelpful: 0 },
      e2eRunId: runId,
    };
    await insert('reviews', approvedReview);
    await insert('reviews', pendingReview);

    const thread = {
      id: `${prefix}-thread`,
      customerId: users.customer.id,
      supplierId: approvedSupplier.id,
      participants: [users.customer.id, users.supplier.id],
      subject: `E2E enquiry ${runId}`,
      createdAt: now,
      updatedAt: now,
      e2eRunId: runId,
    };
    await insert('threads', thread);

    const marketplaceListing = {
      id: `${prefix}-listing`,
      userId: users.supplier.id,
      ownerUserId: users.supplier.id,
      title: `E2E Wedding Arch ${runId}`,
      description: 'A reusable decorative wedding arch in excellent condition.',
      category: 'Decor',
      condition: 'used-good',
      price: 120,
      location: 'Cardiff',
      postcode: 'CF10 1AA',
      approved: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      e2eRunId: runId,
    };
    await insert('marketplace_listings', marketplaceListing);

    const supplierPath = `/supplier/${buildPublicSupplierSlug(approvedSupplier)}`;
    const packagePath = `/package/${buildPublicPackageSlug(approvedPackage)}`;

    return res.status(201).json({
      runId,
      password: TEST_PASSWORD,
      users: Object.fromEntries(
        Object.entries(users).map(([key, user]) => [
          key,
          { id: user.id, email: user.email, role: user.role, password: TEST_PASSWORD },
        ])
      ),
      supplier: {
        id: approvedSupplier.id,
        name: approvedSupplier.name,
        path: supplierPath,
      },
      pendingSupplier: {
        id: pendingSupplier.id,
        name: pendingSupplier.name,
      },
      package: {
        id: approvedPackage.id,
        title: approvedPackage.title,
        slug: approvedPackage.slug,
        path: packagePath,
      },
      pausedPackage: { id: pausedPackage.id, slug: pausedPackage.slug },
      unapprovedPackage: { id: unapprovedPackage.id, slug: unapprovedPackage.slug },
      reviews: { approvedId: approvedReview._id, pendingId: pendingReview._id },
      marketplaceListing: { id: marketplaceListing.id, title: marketplaceListing.title },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/cleanup', async (req, res, next) => {
  const runId = normaliseRunId(req.body && req.body.runId);
  if (!runId) {
    return res.status(400).json({ error: 'Invalid runId' });
  }
  try {
    await removeRun(runId);
    return res.json({ ok: true, runId });
  } catch (error) {
    return next(error);
  }
});

router.get('/inspect', async (req, res, next) => {
  const runId = normaliseRunId(req.query.runId);
  if (!runId) {
    return res.status(400).json({ error: 'Invalid runId' });
  }
  try {
    const entries = await Promise.all(
      COLLECTIONS.map(async name => [name, await dbUnified.find(name, { e2eRunId: runId })])
    );
    return res.json({ runId, collections: Object.fromEntries(entries) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports._private = { normaliseRunId, removeRun, HEADER_NAME, HEADER_VALUE, TEST_PASSWORD };
