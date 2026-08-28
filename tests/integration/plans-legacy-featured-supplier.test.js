'use strict';

const express = require('express');
const request = require('supertest');

describe('GET /api/v1/plan enriches suppliers with featuredSupplier', () => {
  test('joins the packages collection the same way routes/suppliers.js does', async () => {
    const plansLegacy = require('../../routes/plans-legacy');

    const suppliers = [
      { id: 'sup_featured', name: 'Featured Co', approved: true, subscriptionTier: 'pro' },
      { id: 'sup_plain', name: 'Plain Co', approved: true, subscriptionTier: 'pro' },
    ];
    const packages = [
      { id: 'pkg_1', supplierId: 'sup_featured', featured: true },
      { id: 'pkg_2', supplierId: 'sup_plain', featured: false },
    ];
    const plans = [
      { id: 'plan_1', userId: 'user_1', supplierId: 'sup_featured' },
      { id: 'plan_2', userId: 'user_1', supplierId: 'sup_plain' },
    ];

    const dbUnified = {
      find: jest.fn(async (collection, query) => {
        if (collection === 'plans') {
          return plans.filter(p => p.userId === query.userId);
        }
        return [];
      }),
      read: jest.fn(async collection => {
        if (collection === 'suppliers') {
          return suppliers;
        }
        if (collection === 'packages') {
          return packages;
        }
        return [];
      }),
    };

    plansLegacy.initializeDependencies({
      dbUnified,
      authRequired: (req, res, next) => {
        req.user = { id: 'user_1', role: 'customer' };
        next();
      },
      csrfProtection: (req, res, next) => next(),
      roleRequired: () => (req, res, next) => next(),
      uid: () => 'generated_id',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/v1', plansLegacy);

    const res = await request(app).get('/api/v1/plan');

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.items.map(s => [s.id, s]));
    expect(byId.sup_featured.featuredSupplier).toBe(true);
    expect(byId.sup_plain.featuredSupplier).toBe(false);
  });
});
