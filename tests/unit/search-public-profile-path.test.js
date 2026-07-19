'use strict';

const { addPublicProfilePath, addPublicProfilePaths } = require('../../routes/search');
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
});
