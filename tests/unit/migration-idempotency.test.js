'use strict';

let mockDocuments = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const mockCollection = {
  find: jest.fn(() => ({
    toArray: jest.fn(async () => clone(mockDocuments)),
  })),
  deleteMany: jest.fn(async () => {
    mockDocuments = [];
    return { acknowledged: true };
  }),
  insertMany: jest.fn(async documents => {
    mockDocuments = clone(documents);
    return { acknowledged: true, insertedCount: documents.length };
  }),
};

jest.mock('../../db', () => ({
  getCollection: jest.fn(async () => mockCollection),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../services/supplier.service', () => ({
  generateSlug: name =>
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
}));

const { migrateSuppliers_AddNewFields } = require('../../db-utils');

describe('supplier migration safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocuments = [
      {
        id: 'supplier_existing',
        name: 'Existing Venue',
        slug: 'existing-venue',
        description: 'Already complete',
        location: 'Cardiff',
        email: 'existing@example.test',
        status: 'published',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-02-01T00:00:00.000Z',
        tags: ['venue'],
        approved: false,
      },
      {
        id: 'supplier_legacy',
        name: 'Legacy Photographer',
        description: 'Legacy profile',
        location: 'Pontypridd',
        phone: '01000000000',
      },
    ];
  });

  test('can run twice without changing the migrated records or losing explicit values', async () => {
    const firstResult = await migrateSuppliers_AddNewFields();
    const firstPass = clone(mockDocuments);
    const secondResult = await migrateSuppliers_AddNewFields();

    expect(firstResult).toEqual(expect.objectContaining({ success: true, migrated: 2 }));
    expect(secondResult).toEqual(expect.objectContaining({ success: true, migrated: 2 }));
    expect(mockDocuments).toEqual(firstPass);
    expect(mockDocuments).toHaveLength(2);

    const existing = mockDocuments.find(document => document.id === 'supplier_existing');
    expect(existing).toEqual(
      expect.objectContaining({
        slug: 'existing-venue',
        status: 'published',
        updatedAt: '2025-02-01T00:00:00.000Z',
        approved: false,
        tags: ['venue'],
      })
    );

    const legacy = mockDocuments.find(document => document.id === 'supplier_legacy');
    expect(legacy).toEqual(
      expect.objectContaining({
        slug: 'legacy-photographer',
        status: 'published',
        approved: true,
        tags: [],
        amenities: [],
      })
    );
  });

  test('does not write when no supplier records exist', async () => {
    mockDocuments = [];

    const result = await migrateSuppliers_AddNewFields();

    expect(result).toEqual(
      expect.objectContaining({ success: true, migrated: 0, message: 'No suppliers to migrate' })
    );
    expect(mockCollection.deleteMany).not.toHaveBeenCalled();
    expect(mockCollection.insertMany).not.toHaveBeenCalled();
  });
});
