'use strict';

/**
 * Package search by price. Prices are text ("£450", "From £1,200 pp", "POA"); the filter and the
 * sorts used to treat that text as a number, so every comparison was NaN and "cheapest first"
 * returned the order it started in.
 */

const searchService = require('../../services/searchService');
const dbUnified = require('../../db-unified');
const { supplierIsProActive } = require('../../utils/helpers');

jest.mock('../../db-unified');
jest.mock('../../utils/helpers', () => ({ supplierIsProActive: jest.fn() }));
jest.mock('../../services/catalogCache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
  getTtl: jest.fn().mockReturnValue(300),
}));

const base = { approved: true, supplierId: 'sup-1', category: 'Catering' };
const packages = [
  { ...base, id: 'p-dear', title: 'Dear', price: '£3,000', price_display: '£3,000' },
  { ...base, id: 'p-poa', title: 'Poa', price: 'POA', price_display: 'POA' },
  { ...base, id: 'p-cheap', title: 'Cheap', price: '£450', price_display: 'From £450' },
  { ...base, id: 'p-mid', title: 'Mid', price: '£1,200 pp', price_display: '£1,200 pp' },
  { ...base, id: 'p-none', title: 'None' },
];

beforeEach(() => {
  jest.clearAllMocks();
  supplierIsProActive.mockImplementation(async () => false);
  dbUnified.read.mockImplementation(collection => {
    if (collection === 'suppliers') {
      return Promise.resolve([{ id: 'sup-1', name: 'Sup', approved: true, category: 'Catering' }]);
    }
    if (collection === 'packages') {
      return Promise.resolve(packages.map(item => ({ ...item })));
    }
    return Promise.resolve([]);
  });
});

const ids = result => result.results.map(item => item.id);

describe('searchPackages price', () => {
  it('cheapest first, with unpriced packages last', async () => {
    const result = await searchService.searchPackages({ sortBy: 'priceAsc' });
    expect(ids(result)).toEqual([
      'p-cheap',
      'p-mid',
      'p-dear',
      expect.any(String),
      expect.any(String),
    ]);
    expect(ids(result).slice(3).sort()).toEqual(['p-none', 'p-poa']);
  });

  it('dearest first, with unpriced packages last', async () => {
    const result = await searchService.searchPackages({ sortBy: 'priceDesc' });
    expect(ids(result).slice(0, 3)).toEqual(['p-dear', 'p-mid', 'p-cheap']);
  });

  it('a price range keeps only packages whose amount fits, and drops unpriced ones', async () => {
    const result = await searchService.searchPackages({ minPrice: 400, maxPrice: 1500 });
    expect(ids(result).sort()).toEqual(['p-cheap', 'p-mid']);
  });

  it('shows the displayed price, not the typed one, when an admin set another', async () => {
    const result = await searchService.searchPackages({ sortBy: 'priceAsc' });
    const cheap = result.results.find(item => item.id === 'p-cheap');
    expect(cheap.price).toBe('From £450');
  });
});
