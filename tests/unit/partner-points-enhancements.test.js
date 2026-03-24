/**
 * Unit tests for partner points enhancements:
 *
 * 1. awardReferralSignupBonus  (+5 credits) — supplier signed up via partner link
 * 2. awardFirstReviewBonus     (+15 credits) — referred supplier received first review
 * 3. awardProfileApprovedBonus (+20 credits) — referred supplier's profile was approved
 * 4. getBalance() — availableBalance vs maturingBalance (30-day maturity)
 * 5. debitPoints / reverseDebit — cashout debit lifecycle
 * 6. Cashout balance enforcement in POST /api/partner/tremendous/orders
 * 7. GET /api/partner/support-tickets endpoint
 */

'use strict';

// ── Mock db-unified ───────────────────────────────────────────────────────────

const mockStore = {
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  partner_code_history: [],
  partner_cashout_orders: [],
  tickets: [],
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
  mockStore.partner_code_history = [];
  mockStore.partner_cashout_orders = [];
  mockStore.tickets = [];
}

const partnerService = require('../../services/partnerService');
const dbUnified = require('../../db-unified');

// ── Test fixtures ─────────────────────────────────────────────────────────────

const ACTIVE_PARTNER = {
  id: 'prt_enh_001',
  userId: 'usr_enh_001',
  refCode: 'p_ENH001',
  status: 'active',
  createdAt: new Date().toISOString(),
};

const SUPPLIER_USER_ID = 'usr_sup_enh_001';

function seedPartnerAndReferral() {
  mockStore.partners.push({ ...ACTIVE_PARTNER });
  mockStore.partner_referrals.push({
    id: 'ref_enh_001',
    partnerId: ACTIVE_PARTNER.id,
    supplierUserId: SUPPLIER_USER_ID,
    supplierCreatedAt: new Date().toISOString(),
    packageQualified: false,
    subscriptionQualified: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PartnerService — points enhancements', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
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

  // ── awardReferralSignupBonus ───────────────────────────────────────────────

  describe('awardReferralSignupBonus()', () => {
    beforeEach(seedPartnerAndReferral);

    it('awards +5 credits when referred supplier signs up', async () => {
      const txn = await partnerService.awardReferralSignupBonus(SUPPLIER_USER_ID);
      expect(txn).not.toBeNull();
      expect(txn.amount).toBe(partnerService.REFERRAL_SIGNUP_BONUS);
      expect(txn.type).toBe('REFERRAL_SIGNUP_BONUS');
      expect(txn.partnerId).toBe(ACTIVE_PARTNER.id);
    });

    it('is idempotent — does not double-award on second call', async () => {
      await partnerService.awardReferralSignupBonus(SUPPLIER_USER_ID);
      const second = await partnerService.awardReferralSignupBonus(SUPPLIER_USER_ID);
      expect(second).toBeNull();
      const txns = mockStore.partner_credit_transactions.filter(
        t => t.type === 'REFERRAL_SIGNUP_BONUS'
      );
      expect(txns).toHaveLength(1);
    });

    it('returns null when supplier is not a referral', async () => {
      const result = await partnerService.awardReferralSignupBonus('usr_not_referred');
      expect(result).toBeNull();
    });

    it('returns null when partner is disabled', async () => {
      mockStore.partners[0].status = 'disabled';
      const result = await partnerService.awardReferralSignupBonus(SUPPLIER_USER_ID);
      expect(result).toBeNull();
    });
  });

  // ── awardFirstReviewBonus ──────────────────────────────────────────────────

  describe('awardFirstReviewBonus()', () => {
    beforeEach(seedPartnerAndReferral);

    it('awards +15 credits when referred supplier receives first review', async () => {
      const txn = await partnerService.awardFirstReviewBonus(SUPPLIER_USER_ID);
      expect(txn).not.toBeNull();
      expect(txn.amount).toBe(partnerService.FIRST_REVIEW_BONUS);
      expect(txn.type).toBe('FIRST_REVIEW_BONUS');
      expect(txn.partnerId).toBe(ACTIVE_PARTNER.id);
    });

    it('is idempotent — does not award twice', async () => {
      await partnerService.awardFirstReviewBonus(SUPPLIER_USER_ID);
      const second = await partnerService.awardFirstReviewBonus(SUPPLIER_USER_ID);
      expect(second).toBeNull();
    });

    it('returns null when supplier is not a referral', async () => {
      const result = await partnerService.awardFirstReviewBonus('usr_not_referred');
      expect(result).toBeNull();
    });
  });

  // ── awardProfileApprovedBonus ──────────────────────────────────────────────

  describe('awardProfileApprovedBonus()', () => {
    // Profile-approved bonus has been removed: profiles are auto-approved and
    // awarding points for this action is no longer appropriate.
    it('always returns null (bonus removed)', async () => {
      const txn = await partnerService.awardProfileApprovedBonus(SUPPLIER_USER_ID);
      expect(txn).toBeNull();
    });

    it('returns null for any supplier user ID', async () => {
      const result = await partnerService.awardProfileApprovedBonus('usr_not_referred');
      expect(result).toBeNull();
    });
  });

  // ── getBalance available vs maturing ──────────────────────────────────────

  describe('getBalance() — available vs maturing points', () => {
    beforeEach(() => {
      mockStore.partners.push({ ...ACTIVE_PARTNER });
    });

    it('places credits older than 30 days in availableBalance', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      mockStore.partner_credit_transactions.push({
        id: 'ptx_old_1',
        partnerId: ACTIVE_PARTNER.id,
        type: 'PACKAGE_BONUS',
        amount: 10,
        supplierUserId: 'usr_s1',
        createdAt: oldDate,
      });

      const balance = await partnerService.getBalance(ACTIVE_PARTNER.id);
      expect(balance.availableBalance).toBe(10);
      expect(balance.maturingBalance).toBe(0);
    });

    it('places recently earned credits in maturingBalance', async () => {
      const recentDate = new Date().toISOString();
      mockStore.partner_credit_transactions.push({
        id: 'ptx_new_1',
        partnerId: ACTIVE_PARTNER.id,
        type: 'SUBSCRIPTION_BONUS',
        amount: 100,
        supplierUserId: 'usr_s2',
        createdAt: recentDate,
      });

      const balance = await partnerService.getBalance(ACTIVE_PARTNER.id);
      expect(balance.availableBalance).toBe(0);
      expect(balance.maturingBalance).toBe(100);
    });

    it('splits mixed old and recent credits correctly', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date().toISOString();

      mockStore.partner_credit_transactions.push(
        {
          id: 'ptx_m1',
          partnerId: ACTIVE_PARTNER.id,
          type: 'PACKAGE_BONUS',
          amount: 10,
          supplierUserId: 'usr_s1',
          createdAt: oldDate,
        },
        {
          id: 'ptx_m2',
          partnerId: ACTIVE_PARTNER.id,
          type: 'SUBSCRIPTION_BONUS',
          amount: 100,
          supplierUserId: 'usr_s2',
          createdAt: recentDate,
        }
      );

      const balance = await partnerService.getBalance(ACTIVE_PARTNER.id);
      expect(balance.availableBalance).toBe(10);
      expect(balance.maturingBalance).toBe(100);
      expect(balance.balance).toBe(110);
    });

    it('subtracts REDEEM transactions from availableBalance', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      mockStore.partner_credit_transactions.push(
        {
          id: 'ptx_e1',
          partnerId: ACTIVE_PARTNER.id,
          type: 'PACKAGE_BONUS',
          amount: 100,
          supplierUserId: 'usr_s1',
          createdAt: oldDate,
        },
        {
          id: 'ptx_r1',
          partnerId: ACTIVE_PARTNER.id,
          type: 'REDEEM',
          amount: -50,
          supplierUserId: null,
          createdAt: oldDate,
        }
      );

      const balance = await partnerService.getBalance(ACTIVE_PARTNER.id);
      expect(balance.availableBalance).toBe(50);
      expect(balance.redeemed).toBe(50);
    });

    it('availableBalance cannot go below zero', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      mockStore.partner_credit_transactions.push(
        {
          id: 'ptx_e2',
          partnerId: ACTIVE_PARTNER.id,
          type: 'PACKAGE_BONUS',
          amount: 10,
          supplierUserId: 'usr_s1',
          createdAt: oldDate,
        },
        {
          id: 'ptx_r2',
          partnerId: ACTIVE_PARTNER.id,
          type: 'REDEEM',
          amount: -100,
          supplierUserId: null,
          createdAt: oldDate,
        }
      );

      const balance = await partnerService.getBalance(ACTIVE_PARTNER.id);
      expect(balance.availableBalance).toBe(0);
    });
  });

  // ── debitPoints / reverseDebit ────────────────────────────────────────────

  describe('debitPoints() and reverseDebit()', () => {
    beforeEach(() => {
      mockStore.partners.push({ ...ACTIVE_PARTNER });
    });

    it('debitPoints inserts a negative REDEEM transaction', async () => {
      const txn = await partnerService.debitPoints({
        partnerId: ACTIVE_PARTNER.id,
        amount: 50,
        notes: 'Test debit',
        externalRef: 'ref_test_001',
      });

      expect(txn.amount).toBe(-50);
      expect(txn.type).toBe('REDEEM');
      expect(txn.partnerId).toBe(ACTIVE_PARTNER.id);
      expect(txn.externalRef).toBe('ref_test_001');
    });

    it('reverseDebit inserts a positive ADJUSTMENT to cancel the debit', async () => {
      const debit = await partnerService.debitPoints({
        partnerId: ACTIVE_PARTNER.id,
        amount: 50,
        notes: 'Test debit',
        externalRef: 'ref_test_002',
      });

      const reversal = await partnerService.reverseDebit(debit.id, ACTIVE_PARTNER.id);
      expect(reversal).not.toBeNull();
      expect(reversal.amount).toBe(50);
      expect(reversal.type).toBe('ADJUSTMENT');
    });

    it('reverseDebit returns null when debit not found', async () => {
      const result = await partnerService.reverseDebit('ptx_nonexistent', ACTIVE_PARTNER.id);
      expect(result).toBeNull();
    });
  });

  // ── POINTS_PER_GBP constant ────────────────────────────────────────────────

  describe('POINTS_PER_GBP', () => {
    it('is a positive integer', () => {
      expect(typeof partnerService.POINTS_PER_GBP).toBe('number');
      expect(partnerService.POINTS_PER_GBP).toBeGreaterThan(0);
      expect(Number.isInteger(partnerService.POINTS_PER_GBP)).toBe(true);
    });

    it('defaults to 100 (100 points = £1)', () => {
      // Assumes POINTS_PER_GBP env var is not set in test environment
      expect(partnerService.POINTS_PER_GBP).toBe(100);
    });
  });
});
