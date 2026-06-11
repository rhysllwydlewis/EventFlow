/**
 * Regression tests for partner programme launch-readiness fixes.
 */

'use strict';

const mockStore = {
  partners: [],
  partner_referrals: [],
  partner_credit_transactions: [],
  partner_code_history: [],
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
    return Promise.resolve(
      items.find(item => Object.entries(query).every(([key, value]) => item[key] === value)) || null
    );
  }),
  updateOne: jest.fn((collection, query, update) => {
    const items = mockStore[collection] || [];
    const index = items.findIndex(item =>
      Object.entries(query).every(([key, value]) => item[key] === value)
    );
    if (index !== -1 && update.$set) {
      Object.assign(items[index], update.$set);
    }
    return Promise.resolve({ modified: index !== -1 ? 1 : 0 });
  }),
  find: jest.fn((collection, filter) => {
    const items = mockStore[collection] || [];
    return Promise.resolve(
      items.filter(item => Object.entries(filter).every(([key, value]) => item[key] === value))
    );
  }),
}));

jest.mock('../../store', () => ({
  uid: prefix => `${prefix}_regression_${Math.random().toString(36).slice(2)}`,
  DATA_DIR: '/tmp/test-data',
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const partnerService = require('../../services/partnerService');

describe('Partner red item regressions', () => {
  beforeEach(() => {
    mockStore.partners = [];
    mockStore.partner_referrals = [];
    mockStore.partner_credit_transactions = [];
    mockStore.partner_code_history = [];
    jest.clearAllMocks();
  });

  it('resolves historical referral codes through getPartnerByRefCode', async () => {
    mockStore.partners.push({
      id: 'prt_history',
      userId: 'usr_partner',
      refCode: 'p_CURRENT',
      status: 'active',
    });
    mockStore.partner_code_history.push({
      id: 'pch_old',
      partnerId: 'prt_history',
      refCode: 'p_OLDPOST',
      replacedByCode: 'p_CURRENT',
      archivedAt: new Date().toISOString(),
    });

    const found = await partnerService.getPartnerByRefCode('p_OLDPOST');

    expect(found).not.toBeNull();
    expect(found.id).toBe('prt_history');
  });

  it('stores sanitised campaign metadata when recording referrals', async () => {
    const referral = await partnerService.recordReferral({
      partnerId: 'prt_campaign',
      supplierUserId: 'usr_supplier_campaign',
      supplierCreatedAt: new Date().toISOString(),
      utm_source: 'facebook_group<script>',
      utm_medium: 'social',
      utm_campaign: 'south wales suppliers!!!',
      utm_content: 'post / launch',
      utm_term: 'venues @ cardiff',
    });

    expect(referral.source).toBe('facebook_groupscript');
    expect(referral.medium).toBe('social');
    expect(referral.campaign).toBe('south wales suppliers');
    expect(referral.content).toBe('post / launch');
    expect(referral.term).toBe('venues @ cardiff');
    expect(referral.source).not.toContain('<');
    expect(referral.source).not.toContain('>');
  });
});
