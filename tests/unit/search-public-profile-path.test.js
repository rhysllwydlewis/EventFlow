'use strict';

const fs = require('fs');
const path = require('path');
const {
  addPublicProfilePath,
  addPublicProfilePaths,
} = require('../../utils/publicSupplierProfilePath');
const { buildPublicSupplierSlug } = require('../../services/publicSupplierSeo.service');

describe('supplier search canonical profile paths', () => {
  const supplier = {
    id: 'supplier-123',
    name: 'Cŵm Valley Photography',
    approved: true,
  };

  test('adds the clean profile path without removing existing fields', () => {
    const enriched = addPublicProfilePath(supplier);

    expect(enriched).toEqual({
      ...supplier,
      publicProfilePath: `/supplier/${buildPublicSupplierSlug(supplier)}`,
    });
  });

  test('enriches primary and fallback search results', () => {
    const output = addPublicProfilePaths({
      results: [supplier],
      fallback: { suggestions: [{ ...supplier, id: 'supplier-456' }] },
      pagination: { total: 1 },
    });

    expect(output.results[0].publicProfilePath).toMatch(
      /^\/supplier\/cwm-valley-photography--[a-f0-9]{16}$/
    );
    expect(output.fallback.suggestions[0].publicProfilePath).toMatch(
      /^\/supplier\/cwm-valley-photography--[a-f0-9]{16}$/
    );
    expect(output.pagination).toEqual({ total: 1 });
  });

  test('leaves incomplete suppliers unchanged', () => {
    expect(addPublicProfilePath(null)).toBeNull();
    expect(addPublicProfilePath({ id: 'supplier-123' })).toEqual({ id: 'supplier-123' });
  });

  test('enriches v2 results directly without depending on module load order', () => {
    const legacyRoute = fs.readFileSync(path.join(__dirname, '../../routes/search.js'), 'utf8');
    const v2Route = fs.readFileSync(path.join(__dirname, '../../routes/search-v2.js'), 'utf8');

    expect(legacyRoute).not.toContain('__publicProfilePathsEnabled');
    expect(v2Route).toContain('const results = addPublicProfilePaths(rawResults);');
  });
});
