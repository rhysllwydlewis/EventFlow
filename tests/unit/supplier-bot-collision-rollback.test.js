'use strict';

function botSupplier() {
  return {
    id: 'sup_bot_existing',
    ownershipStatus: 'unclaimed',
    name: 'Example Venue',
    category: 'Venues',
    website: 'https://example-venue.test/',
    email: 'hello@example-venue.test',
    status: 'draft',
    approved: false,
    acquisition: { source: 'supplier_bot', candidateId: 'cand_1' },
  };
}

describe('supplier signup collision rollback', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
  });

  it('removes a newly created collision claim when owned profile creation fails', async () => {
    const data = {
      settings: [{}],
      suppliers: [botSupplier()],
      supplierClaims: [],
    };
    const dbUnified = {
      read: jest.fn(async collection => data[collection] || []),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'suppliers' && filter.ownerUserId) return null;
        if (collection === 'supplierClaims' && filter.id) {
          return data.supplierClaims.find(item => item.id === filter.id) || null;
        }
        return null;
      }),
      insertOne: jest.fn(async (collection, doc) => {
        if (collection === 'supplierClaims') {
          data.supplierClaims.push(doc);
          return doc;
        }
        if (collection === 'suppliers') return null;
        return doc;
      }),
      deleteOne: jest.fn(async (collection, filter) => {
        if (collection !== 'supplierClaims') return false;
        const index = data.supplierClaims.findIndex(item => item.id === filter.id);
        if (index === -1) return false;
        data.supplierClaims.splice(index, 1);
        return true;
      }),
      uid: jest.fn(() => 'sup_signup'),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');

    await expect(
      ensureSupplierProfileForUser({
        id: 'usr_signup',
        role: 'supplier',
        verified: false,
        email: 'hello@example-venue.test',
        website: 'https://example-venue.test',
        company: 'Example Venue',
        location: 'Cardiff',
      })
    ).rejects.toThrow('Failed to provision supplier profile for user usr_signup');

    expect(dbUnified.deleteOne).toHaveBeenCalledWith(
      'supplierClaims',
      expect.objectContaining({ id: expect.stringMatching(/^clm_bot_/) })
    );
    expect(data.supplierClaims).toHaveLength(0);
  });

  it('does not delete an idempotent pre-existing claim when profile creation fails', async () => {
    const existingClaim = {
      id: 'clm_bot_existing',
      supplierId: 'sup_bot_existing',
      requesterUserId: 'usr_signup',
      status: 'pending_email_verification',
    };
    const data = {
      settings: [{}],
      suppliers: [botSupplier()],
      supplierClaims: [existingClaim],
    };
    const claimService = jest.requireActual('../../services/supplierBotClaim.service');
    const deterministicId = claimService.claimIdFor('sup_bot_existing', 'usr_signup');
    existingClaim.id = deterministicId;

    const dbUnified = {
      read: jest.fn(async collection => data[collection] || []),
      findOne: jest.fn(async (collection, filter) => {
        if (collection === 'suppliers' && filter.ownerUserId) return null;
        if (collection === 'supplierClaims' && filter.id) {
          return data.supplierClaims.find(item => item.id === filter.id) || null;
        }
        return null;
      }),
      insertOne: jest.fn(async (collection, doc) => (collection === 'suppliers' ? null : doc)),
      deleteOne: jest.fn(async () => true),
      uid: jest.fn(() => 'sup_signup'),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    const {
      ensureSupplierProfileForUser,
    } = require('../../services/supplierProfileProvisioning.service');

    await expect(
      ensureSupplierProfileForUser({
        id: 'usr_signup',
        role: 'supplier',
        email: 'hello@example-venue.test',
        website: 'https://example-venue.test',
      })
    ).rejects.toThrow();

    expect(dbUnified.deleteOne).not.toHaveBeenCalled();
    expect(data.supplierClaims).toHaveLength(1);
  });
});
