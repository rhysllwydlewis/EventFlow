'use strict';

const express = require('express');
const request = require('supertest');
const createPublicListingSeoRouter = require('../../routes/public-listing-seo');

function memoryDb() {
  const supplier = {
    id: 'sup_bot_package_route_1',
    name: 'Unclaimed Marketplace Venue',
    category: 'Venues',
    location: 'Cardiff, South Wales',
    ownershipStatus: 'unclaimed',
    approved: true,
    status: 'active',
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'candidate_package_route_1',
      publicationScope: 'public_unclaimed',
      publishedUnclaimedAt: '2026-08-27T18:00:00.000Z',
    },
  };
  const pkg = {
    id: 'pkg_bot_package_route_1',
    slug: 'wedding-package-route-test',
    supplierId: supplier.id,
    title: 'Wedding Package',
    description:
      'A detailed wedding package description with enough useful information for the normal package page.',
    price: '2500',
    approved: true,
    status: 'active',
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'candidate_package_route_1',
      sourcePackageKey: 'wedding-package:1',
    },
  };
  return {
    supplier,
    pkg,
    async read(name) {
      if (name === 'suppliers') {
        return [supplier];
      }
      if (name === 'packages') {
        return [pkg];
      }
      if (name === 'users' || name === 'public_calendar_events') {
        return [];
      }
      return [];
    },
  };
}

describe('published-unclaimed package page parity', () => {
  it('serves a normal package page with an Unclaimed banner and strict noindex policy', async () => {
    const dbUnified = memoryDb();
    const app = express();
    app.use(
      createPublicListingSeoRouter({
        dbUnified,
        logger: { error: jest.fn(), warn: jest.fn() },
        baseUrl: 'https://event-flow.co.uk',
        cacheTtlMs: 0,
      })
    );

    const response = await request(app).get(`/package/${dbUnified.pkg.slug}`);

    expect(response.status).toBe(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(response.text).toContain('id="supplier-bot-unclaimed-package-banner"');
    expect(response.text).toContain('Unclaimed package');
    expect(response.text).toContain(
      'href="/auth?tab=create&amp;role=supplier&amp;claimSupplierId=sup_bot_package_route_1"'
    );
    expect(response.text).toContain('ef-public-package-id');
    expect(response.text).toContain(dbUnified.pkg.id);
  });
});
