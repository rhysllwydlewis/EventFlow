'use strict';

const fs = require('fs');
const path = require('path');
const {
  CATEGORY_DEFINITIONS,
  canonicalCategoryValue,
} = require('../../public/assets/js/utils/category-link.js');
const { applySupplierFilters } = require('../../services/searchService');
const { VALID_CATEGORIES } = require('../../models/Supplier');

const ROOT = path.join(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('supplier category canonical flow', () => {
  const suppliers = ['Venues', 'Catering', 'Entertainment', 'Photography'].map((category, index) => ({
    id: `supplier-${index}`,
    category,
  }));

  test('the canonical registry exactly matches the supplier validation model', () => {
    expect(CATEGORY_DEFINITIONS.map(category => category.name)).toEqual(VALID_CATEGORIES);
  });

  test.each([
    ['venues', 'Venues'],
    ['CATERING', 'Catering'],
    ['entertainment', 'Entertainment'],
    ['Photography', 'Photography'],
  ])('%s resolves consistently for URL/API/results as %s', (input, expected) => {
    expect(canonicalCategoryValue(input)).toBe(expected);
    expect(applySupplierFilters(suppliers, { category: input })).toEqual([
      expect.objectContaining({ category: expected }),
    ]);
  });

  test('unknown categories produce the neutral, zero-result state', () => {
    expect(canonicalCategoryValue('not-a-category')).toBe('');
    expect(applySupplierFilters(suppliers, { category: 'not-a-category' })).toEqual([]);
  });

  test('the shipped page uses the registry before URL load, URL update, UI, API and analytics', () => {
    const html = source('public/suppliers.html');
    const urlState = source('public/assets/js/utils/url-state.js');
    const page = source('public/assets/js/pages/suppliers-init.js');
    expect(html.indexOf('/utils/category-link.js')).toBeLessThan(
      html.indexOf('/pages/suppliers-init.js')
    );
    expect(urlState.match(/canonicalCategoryValue/g)).toHaveLength(2);
    expect(page).toContain("params.set('category', filters.category)");
    expect(page).toContain('filterCategoryEl.value = currentFilters.category');
    expect(page).toContain('parts.push(filters.category)');
    expect(page).toContain('trackSearch(currentFilters.q || \'\', currentFilters');
    expect(page).toContain("trackFilterChange('category', e.target.value)");
  });
});
