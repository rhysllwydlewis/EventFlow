'use strict';

const mockCollections = { users: [], suppliers: [], threads: [], messages: [] };
function mockMatches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}
const mockDb = {
  findOne: jest.fn(
    async (collection, query) =>
      (mockCollections[collection] || []).find(item => mockMatches(item, query)) || null
  ),
  find: jest.fn(async (collection, query) =>
    (mockCollections[collection] || []).filter(item => mockMatches(item, query))
  ),
  read: jest.fn(async collection => mockCollections[collection] || []),
};

jest.mock('../../db-unified', () => mockDb);
const service = require('../../services/partnerRewardSupplierEvidenceService');

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  delete process.env.PARTNER_REWARD_SUPPLIER_MIN_DESCRIPTION_LENGTH;
  delete process.env.PARTNER_REWARD_PACKAGE_REQUIRE_CUSTOMER_INTERACTION;
});

function seedCompleteProfile() {
  mockCollections.users.push({ id: 'supplier_1', company: 'Example Events Ltd' });
  mockCollections.suppliers.push({
    id: 'sup_1',
    ownerUserId: 'supplier_1',
    approved: true,
    status: 'published',
    name: 'Example Events',
    category: 'Event Planner',
    description:
      'Professional event planning for weddings, corporate events and private celebrations.',
    location: 'Cardiff',
    website: 'https://example-events.co.uk',
  });
}

test('accepts an approved profile with meaningful business and contact evidence', async () => {
  seedCompleteProfile();
  await expect(service.supplierProfileEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
    supplierId: 'sup_1',
  });
});

test('rejects placeholder or incomplete supplier profiles even when approved', async () => {
  mockCollections.users.push({ id: 'supplier_1', company: 'Test' });
  mockCollections.suppliers.push({
    id: 'sup_1',
    ownerUserId: 'supplier_1',
    approved: true,
    name: 'Test',
    category: 'Other',
    description: 'Coming soon',
    location: 'TBC',
  });
  await expect(service.supplierProfileEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'SUPPLIER_PROFILE_EVIDENCE_INCOMPLETE',
  });
});

test('a suspended profile cannot qualify rewards', async () => {
  seedCompleteProfile();
  mockCollections.suppliers[0].status = 'suspended';
  await expect(service.supplierProfileEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'SUPPLIER_PROFILE_NOT_APPROVED',
  });
});

test('social link can provide contact evidence when website and phone are absent', async () => {
  seedCompleteProfile();
  delete mockCollections.suppliers[0].website;
  mockCollections.suppliers[0].socials = { instagram: 'https://instagram.com/exampleevents' };
  await expect(service.supplierProfileEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
  });
});

test('package-customer interaction is optional by default', async () => {
  seedCompleteProfile();
  await expect(service.packageInteractionEvidence('supplier_1')).resolves.toEqual({
    eligible: true,
  });
});

test('when enabled, package reward requires a genuine inbound customer message', async () => {
  process.env.PARTNER_REWARD_PACKAGE_REQUIRE_CUSTOMER_INTERACTION = 'true';
  seedCompleteProfile();
  mockCollections.threads.push({ id: 'thread_1', supplierId: 'sup_1', customerId: 'customer_1' });

  await expect(service.packageInteractionEvidence('supplier_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'PACKAGE_CUSTOMER_INTERACTION_MISSING',
  });

  mockCollections.messages.push({
    id: 'msg_1',
    threadId: 'thread_1',
    senderId: 'customer_1',
    isDraft: false,
  });
  await expect(service.packageInteractionEvidence('supplier_1')).resolves.toMatchObject({
    eligible: true,
    interactionMessageId: 'msg_1',
  });
});
