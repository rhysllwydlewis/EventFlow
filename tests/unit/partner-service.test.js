/**
 * Unit tests for the Partner Service
 * Tests credit awarding idempotency, package bonus, subscription bonus,
 * referral attribution, and partner CRUD operations.
 */

'use strict';

// ── Mock db-unified ───────────────────────────────────────────────────────────

const mockStore = {
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
};

jest.mock('../../db-unified', () => ({
  read: jest.fn(collection => Promise.resolve([...(mockStore[collection] || [])])),
  insertOne: jest.fn((collection, doc) => {
    if (!mockStore[collection]) {
      mockStore[collection] = [];
    }
    mockStore[collection].push(doc);
    return Promise.resolve(doc);
  }),
  findOne: jest.fn((collection, query) => {
    const items = mockStore[collection] || [];
    const result = items.find(item => Object.entries(query).every(([k, v]) => item[k] === v));
    return Promise.resolve(result || null);
  }),
  updateOne: jest.fn((collection, query, update) => {
    const items = mockStore[collection] || [];
    const idx = items.findIndex(item => Object.entries(query).every(([k, v]) => item[k] === v));
    if (idx !== -1 && update.$set) {
      Object.assign(items[idx], update.$set);
    }
    return Promise.resolve({ modified: idx !== -1 ? 1 : 0 });
  }),
}));

jest.mock('../../store', () => ({
  uid: (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`,
  DATA_DIR: '/tmp/test-data',
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  mockStore.partners = [];
  mockStore.partner_referrals = [];
  mockStore.partner_credit_transactions = [];
}

// ── Import service AFTER mocks are set up ─────────────────────────────────────

const partnerService = require('../../services/partnerService');
const dbUnified = require('../../db-unified');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PartnerService', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    // Re-bind mocks to the fresh store after reset
    dbUnified.read.mockImplementation(collection =>
      Promise.resolve([...(mockStore[collection] || [])])
    );
    dbUnified.insertOne.mockImplementation((collection, doc) => {
      if (!mockStore[collection]) {
        mockStore[collection] = [];
      }
      mockStore[collection].push(doc);
      return Promise.resolve(doc);
    });
    dbUnified.findOne.mockImplementation((collection, query) => {
      const items = mockStore[collection] || [];
      const result = items.find(item => Object.entries(query).every(([k, v]) => item[k] === v));
      return Promise.resolve(result || null);
    });
    dbUnified.updateOne.mockImplementation((collection, query, update) => {
      const items = mockStore[collection] || [];
      const idx = items.findIndex(item => Object.entries(query).every(([k, v]) => item[k] === v));
      if (idx !== -1 && update.$set) {
        Object.assign(items[idx], update.$set);
      }
      return Promise.resolve({ modified: idx !== -1 ? 1 : 0 });
    });
  });

  // ── createPartner ───────────────────────────────────────────────────────────

  describe('createPartner()', () => {
    it('creates a partner with a refCode for a new userId', async () => {
      const partner = await partnerService.createPartner('usr_001');
      expect(partner.userId).toBe('usr_001');
      expect(partner.refCode).toMatch(/^p_/);
      expect(partner.status).toBe('active');
      expect(mockStore.partners).toHaveLength(1);
    });

    it('returns existing partner if userId already has one', async () => {
      const first = await partnerService.createPartner('usr_001');
      const second = await partnerService.createPartner('usr_001');
      expect(second.id).toBe(first.id);
      expect(mockStore.partners).toHaveLength(1);
    });

    it('generates unique ref codes for different users', async () => {
      const p1 = await partnerService.createPartner('usr_001');
      const p2 = await partnerService.createPartner('usr_002');
      expect(p1.refCode).not.toBe(p2.refCode);
    });
  });

  // ── recordReferral ──────────────────────────────────────────────────────────

  describe('recordReferral()', () => {
    it('creates a referral for a supplier', async () => {
      const referral = await partnerService.recordReferral({
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: new Date().toISOString(),
      });

      expect(referral.partnerId).toBe('prt_001');
      expect(referral.supplierUserId).toBe('usr_supplier_001');
      expect(referral.packageQualified).toBe(false);
      expect(referral.subscriptionQualified).toBe(false);
      expect(mockStore.partner_referrals).toHaveLength(1);
    });

    it('does not create duplicate referral for same supplier', async () => {
      const now = new Date().toISOString();
      await partnerService.recordReferral({
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: now,
      });
      const second = await partnerService.recordReferral({
        partnerId: 'prt_002',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: now,
      });

      // Should return existing referral, not create new one
      expect(second.partnerId).toBe('prt_001');
      expect(mockStore.partner_referrals).toHaveLength(1);
    });

    it('sets attributionExpiresAt to 30 days after signup', async () => {
      const signupDate = new Date('2026-01-01T00:00:00Z');
      const referral = await partnerService.recordReferral({
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: signupDate.toISOString(),
      });

      const expires = new Date(referral.attributionExpiresAt);
      const expectedExpiry = new Date(signupDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(expires.getTime()).toBe(expectedExpiry.getTime());
    });
  });

  // ── isWithinAttributionWindow ───────────────────────────────────────────────

  describe('isWithinAttributionWindow()', () => {
    it('returns true for a signup from today', () => {
      const now = new Date().toISOString();
      expect(partnerService.isWithinAttributionWindow(now)).toBe(true);
    });

    it('returns true for a signup 29 days ago', () => {
      const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
      expect(partnerService.isWithinAttributionWindow(twentyNineDaysAgo)).toBe(true);
    });

    it('returns false for a signup 31 days ago', () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      expect(partnerService.isWithinAttributionWindow(thirtyOneDaysAgo)).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(partnerService.isWithinAttributionWindow(null)).toBe(false);
      expect(partnerService.isWithinAttributionWindow(undefined)).toBe(false);
    });
  });

  // ── awardPackageBonus ───────────────────────────────────────────────────────

  describe('awardPackageBonus()', () => {
    async function setupActivePartnerWithReferral(signupDate = null) {
      // Create active partner
      const partner = {
        id: 'prt_001',
        userId: 'usr_partner',
        refCode: 'p_TEST01',
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      mockStore.partners.push(partner);

      // Create referral within attribution window
      const referral = {
        id: 'ref_001',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: signupDate || new Date().toISOString(),
        attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        packageQualified: false,
        subscriptionQualified: false,
      };
      mockStore.partner_referrals.push(referral);

      return { partner, referral };
    }

    it('awards +10 credits for supplier first package (within window)', async () => {
      await setupActivePartnerWithReferral();

      const txn = await partnerService.awardPackageBonus('usr_supplier_001');
      expect(txn).not.toBeNull();
      expect(txn.amount).toBe(10);
      expect(txn.type).toBe('PACKAGE_BONUS');
      expect(txn.partnerId).toBe('prt_001');
    });

    it('does not award if supplier has no referral', async () => {
      const txn = await partnerService.awardPackageBonus('usr_no_referral');
      expect(txn).toBeNull();
    });

    it('does not double-award package bonus (idempotency)', async () => {
      await setupActivePartnerWithReferral();

      const first = await partnerService.awardPackageBonus('usr_supplier_001');
      expect(first).not.toBeNull();
      expect(first.amount).toBe(10);

      const second = await partnerService.awardPackageBonus('usr_supplier_001');
      expect(second).toBeNull(); // Already awarded

      // Only one transaction should exist
      const txns = mockStore.partner_credit_transactions.filter(
        t => t.type === 'PACKAGE_BONUS' && t.supplierUserId === 'usr_supplier_001'
      );
      expect(txns).toHaveLength(1);
    });

    it('does not award if attribution window has expired', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      await setupActivePartnerWithReferral(oldDate);

      const txn = await partnerService.awardPackageBonus('usr_supplier_001');
      expect(txn).toBeNull();
    });

    it('does not award if partner is disabled', async () => {
      const partner = {
        id: 'prt_001',
        userId: 'usr_partner',
        refCode: 'p_TEST01',
        status: 'disabled',
        createdAt: new Date().toISOString(),
      };
      mockStore.partners.push(partner);
      mockStore.partner_referrals.push({
        id: 'ref_001',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: new Date().toISOString(),
        packageQualified: false,
        subscriptionQualified: false,
      });

      const txn = await partnerService.awardPackageBonus('usr_supplier_001');
      expect(txn).toBeNull();
    });

    it('marks referral as packageQualified after award', async () => {
      await setupActivePartnerWithReferral();
      await partnerService.awardPackageBonus('usr_supplier_001');

      const referral = mockStore.partner_referrals.find(
        r => r.supplierUserId === 'usr_supplier_001'
      );
      expect(referral.packageQualified).toBe(true);
    });
  });

  // ── awardSubscriptionBonus ──────────────────────────────────────────────────

  describe('awardSubscriptionBonus()', () => {
    async function setupForSubscriptionBonus(signupDate = null) {
      const partner = {
        id: 'prt_001',
        userId: 'usr_partner',
        refCode: 'p_TEST01',
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      mockStore.partners.push(partner);

      const referral = {
        id: 'ref_001',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: signupDate || new Date().toISOString(),
        attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        packageQualified: false,
        subscriptionQualified: false,
      };
      mockStore.partner_referrals.push(referral);

      return { partner, referral };
    }

    it('awards +100 credits for first subscription payment', async () => {
      await setupForSubscriptionBonus();

      const txn = await partnerService.awardSubscriptionBonus('usr_supplier_001');
      expect(txn).not.toBeNull();
      expect(txn.amount).toBe(100);
      expect(txn.type).toBe('SUBSCRIPTION_BONUS');
      expect(txn.partnerId).toBe('prt_001');
    });

    it('does not award if supplier has no referral', async () => {
      const txn = await partnerService.awardSubscriptionBonus('usr_no_referral');
      expect(txn).toBeNull();
    });

    it('does not double-award subscription bonus (idempotency)', async () => {
      await setupForSubscriptionBonus();

      const first = await partnerService.awardSubscriptionBonus('usr_supplier_001');
      expect(first).not.toBeNull();

      const second = await partnerService.awardSubscriptionBonus('usr_supplier_001');
      expect(second).toBeNull();

      const txns = mockStore.partner_credit_transactions.filter(
        t => t.type === 'SUBSCRIPTION_BONUS' && t.supplierUserId === 'usr_supplier_001'
      );
      expect(txns).toHaveLength(1);
    });

    it('does not award if attribution window expired', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      await setupForSubscriptionBonus(oldDate);

      const txn = await partnerService.awardSubscriptionBonus('usr_supplier_001');
      expect(txn).toBeNull();
    });

    it('marks referral as subscriptionQualified after award', async () => {
      await setupForSubscriptionBonus();
      await partnerService.awardSubscriptionBonus('usr_supplier_001');

      const referral = mockStore.partner_referrals.find(
        r => r.supplierUserId === 'usr_supplier_001'
      );
      expect(referral.subscriptionQualified).toBe(true);
    });
  });

  // ── Stacking bonuses ────────────────────────────────────────────────────────

  describe('Stacking: both bonuses for same supplier', () => {
    it('allows both PACKAGE_BONUS and SUBSCRIPTION_BONUS for same supplier', async () => {
      const partner = {
        id: 'prt_001',
        userId: 'usr_partner',
        refCode: 'p_STACK01',
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      mockStore.partners.push(partner);
      mockStore.partner_referrals.push({
        id: 'ref_001',
        partnerId: 'prt_001',
        supplierUserId: 'usr_supplier_001',
        supplierCreatedAt: new Date().toISOString(),
        packageQualified: false,
        subscriptionQualified: false,
      });

      const pkgTxn = await partnerService.awardPackageBonus('usr_supplier_001');
      const subTxn = await partnerService.awardSubscriptionBonus('usr_supplier_001');

      expect(pkgTxn).not.toBeNull();
      expect(subTxn).not.toBeNull();
      expect(pkgTxn.amount).toBe(10);
      expect(subTxn.amount).toBe(100);

      const balance = await partnerService.getBalance('prt_001');
      expect(balance.balance).toBe(110);
      expect(balance.packageBonusTotal).toBe(10);
      expect(balance.subscriptionBonusTotal).toBe(100);
    });
  });

  // ── getBalance ──────────────────────────────────────────────────────────────

  describe('getBalance()', () => {
    it('returns zero balance for new partner', async () => {
      const balance = await partnerService.getBalance('prt_new');
      expect(balance.balance).toBe(0);
      expect(balance.totalEarned).toBe(0);
    });

    it('correctly sums credits from multiple transactions', async () => {
      mockStore.partner_credit_transactions.push(
        {
          id: 'ptx1',
          partnerId: 'prt_001',
          type: 'PACKAGE_BONUS',
          amount: 10,
          supplierUserId: 'usr_001',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'ptx2',
          partnerId: 'prt_001',
          type: 'SUBSCRIPTION_BONUS',
          amount: 100,
          supplierUserId: 'usr_001',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'ptx3',
          partnerId: 'prt_001',
          type: 'PACKAGE_BONUS',
          amount: 10,
          supplierUserId: 'usr_002',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'ptx4',
          partnerId: 'prt_001',
          type: 'ADJUSTMENT',
          amount: -5,
          supplierUserId: null,
          createdAt: new Date().toISOString(),
        }
      );

      const balance = await partnerService.getBalance('prt_001');
      expect(balance.balance).toBe(115); // 10 + 100 + 10 - 5
      expect(balance.packageBonusTotal).toBe(20);
      expect(balance.subscriptionBonusTotal).toBe(100);
    });
  });

  // ── Admin adjustment ─────────────────────────────────────────────────────────

  describe('applyAdminAdjustment()', () => {
    it('records a credit adjustment transaction', async () => {
      const txn = await partnerService.applyAdminAdjustment({
        partnerId: 'prt_001',
        amount: 50,
        notes: 'Bonus for recruitment drive',
        adminUserId: 'usr_admin',
      });

      expect(txn.type).toBe('ADJUSTMENT');
      expect(txn.amount).toBe(50);
      expect(txn.notes).toBe('Bonus for recruitment drive');
      expect(txn.adminUserId).toBe('usr_admin');
    });

    it('supports negative adjustments (deductions)', async () => {
      const txn = await partnerService.applyAdminAdjustment({
        partnerId: 'prt_001',
        amount: -25,
        notes: 'Fraudulent referral reversal',
        adminUserId: 'usr_admin',
      });

      expect(txn.amount).toBe(-25);
    });
  });

  // ── setPartnerStatus ─────────────────────────────────────────────────────────

  describe('setPartnerStatus()', () => {
    it('updates partner status to disabled', async () => {
      mockStore.partners.push({
        id: 'prt_001',
        userId: 'usr_p',
        refCode: 'p_XX',
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      await partnerService.setPartnerStatus('prt_001', 'disabled');
      const updated = mockStore.partners.find(p => p.id === 'prt_001');
      expect(updated.status).toBe('disabled');
    });
  });

  // ── Disabled partner enforcement ─────────────────────────────────────────────

  describe('Disabled partner: no new awards', () => {
    async function setupDisabledPartnerWithReferral() {
      const partner = {
        id: 'prt_disabled',
        userId: 'usr_partner_d',
        refCode: 'p_DISABLED',
        status: 'disabled',
        createdAt: new Date().toISOString(),
      };
      mockStore.partners.push(partner);
      mockStore.partner_referrals.push({
        id: 'ref_disabled',
        partnerId: 'prt_disabled',
        supplierUserId: 'usr_supplier_d',
        supplierCreatedAt: new Date().toISOString(),
        attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        packageQualified: false,
        subscriptionQualified: false,
      });
      return { partner };
    }

    it('does not award package bonus for disabled partner', async () => {
      await setupDisabledPartnerWithReferral();
      const txn = await partnerService.awardPackageBonus('usr_supplier_d');
      expect(txn).toBeNull();
      expect(mockStore.partner_credit_transactions).toHaveLength(0);
    });

    it('does not award subscription bonus for disabled partner', async () => {
      await setupDisabledPartnerWithReferral();
      const txn = await partnerService.awardSubscriptionBonus('usr_supplier_d');
      expect(txn).toBeNull();
      expect(mockStore.partner_credit_transactions).toHaveLength(0);
    });

    it('re-enables awards when partner is re-activated', async () => {
      await setupDisabledPartnerWithReferral();

      // First attempt while disabled
      const txnDisabled = await partnerService.awardPackageBonus('usr_supplier_d');
      expect(txnDisabled).toBeNull();

      // Re-enable partner
      await partnerService.setPartnerStatus('prt_disabled', 'active');

      // Now award should succeed
      const txnEnabled = await partnerService.awardPackageBonus('usr_supplier_d');
      expect(txnEnabled).not.toBeNull();
      expect(txnEnabled.amount).toBe(10);
    });
  });
});
