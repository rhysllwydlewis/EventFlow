/**
 * GET /api/admin/suppliers/:id/action-prompts/diagnostics — missingProfileFields
 *
 * Exercises the real route handler (not just static source assertions) to
 * confirm it now delegates postcode detection to actionPromptService's
 * missingProfileFields() helper instead of the old inline
 * `!supplier.postcode` check, which would always have reported postcode as
 * missing since no supplier-facing form writes a literal `postcode` field
 * (only basePostcode/venuePostcode).
 */

'use strict';

const express = require('express');
const request = require('supertest');

function buildApp(supplier) {
  const router = require('../../routes/supplier-admin');

  router.initializeDependencies({
    dbUnified: {
      read: async collection => {
        if (collection === 'suppliers') {
          return [supplier];
        }
        if (collection === 'users') {
          return [];
        }
        if (collection === 'packages') {
          return [{ id: 'p1', supplierId: supplier.id }];
        }
        if (collection === 'settings') {
          return {};
        }
        return [];
      },
    },
    authRequired: (req, res, next) => {
      req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
      next();
    },
    roleRequired: () => (req, res, next) => next(),
    csrfProtection: (req, res, next) => next(),
    supplierIsProActive: async () => false,
    AI_ENABLED: false,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return app;
}

const BASE_SUPPLIER = {
  id: 'sup-1',
  ownerUserId: 'user-1',
  name: 'Test Supplier',
  description_short: 'A great supplier',
  location: 'Cardiff',
  photosGallery: [{ url: '/img/1.jpg' }],
};

describe('GET /api/admin/suppliers/:id/action-prompts/diagnostics — missingProfileFields', () => {
  it('does not report postcode missing when basePostcode is set', async () => {
    const supplier = { ...BASE_SUPPLIER, basePostcode: 'CF10 1AA' };
    const res = await request(buildApp(supplier)).get(
      `/api/admin/suppliers/${supplier.id}/action-prompts/diagnostics`
    );

    expect(res.status).toBe(200);
    expect(res.body.actions.missingProfileFields).not.toContain('postcode');
  });

  it('does not report postcode missing when venuePostcode is set', async () => {
    const supplier = { ...BASE_SUPPLIER, venuePostcode: 'CF10 1AA' };
    const res = await request(buildApp(supplier)).get(
      `/api/admin/suppliers/${supplier.id}/action-prompts/diagnostics`
    );

    expect(res.status).toBe(200);
    expect(res.body.actions.missingProfileFields).not.toContain('postcode');
  });

  it('reports postcode missing when neither basePostcode nor venuePostcode is set', async () => {
    const supplier = { ...BASE_SUPPLIER };
    const res = await request(buildApp(supplier)).get(
      `/api/admin/suppliers/${supplier.id}/action-prompts/diagnostics`
    );

    expect(res.status).toBe(200);
    expect(res.body.actions.missingProfileFields).toContain('postcode');
  });

  it('does not credit a bare `postcode` field, since no supplier-facing form ever writes one', async () => {
    const supplier = { ...BASE_SUPPLIER, postcode: 'CF10 1AA' };
    const res = await request(buildApp(supplier)).get(
      `/api/admin/suppliers/${supplier.id}/action-prompts/diagnostics`
    );

    expect(res.status).toBe(200);
    expect(res.body.actions.missingProfileFields).toContain('postcode');
  });
});
