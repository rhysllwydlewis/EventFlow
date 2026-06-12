'use strict';

const mockDb = {
  updateOne: jest.fn(() => Promise.resolve({ modified: 1 })),
};

jest.mock('../../db-unified', () => mockDb);

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const partnerReferralCampaignCapture = require('../../middleware/partnerReferralCampaignCapture');

function createReq({ body = {}, query = {}, referer = '', path = '/register' } = {}) {
  return {
    method: 'POST',
    path,
    originalUrl: path,
    body,
    query,
    get: jest.fn(name => (String(name).toLowerCase() === 'referer' ? referer : undefined)),
  };
}

function createRes({ statusCode = 201 } = {}) {
  return {
    statusCode,
    json: jest.fn(body => body),
  };
}

describe('partnerReferralCampaignCapture middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts and sanitises campaign metadata from body, query and referer', () => {
    const req = createReq({
      body: { utm_source: 'facebook_group<script>' },
      query: { utm_campaign: 'south wales suppliers!!!' },
      referer: '/auth?utm_medium=social&utm_content=launch%20post&utm_term=venues%20%40%20cardiff',
    });

    expect(partnerReferralCampaignCapture.extractCampaignMetadata(req)).toEqual({
      source: 'facebook_groupscript',
      medium: 'social',
      campaign: 'south wales suppliers',
      content: 'launch post',
      term: 'venues @ cardiff',
    });
  });

  it('updates the referral record after successful supplier registration', () => {
    const req = createReq({
      body: { ref: 'p_ABC123', utm_source: 'facebook_group', utm_campaign: 'founding_supplier_push' },
    });
    const res = createRes({ statusCode: 201 });
    const next = jest.fn();

    partnerReferralCampaignCapture(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);

    res.json({
      ok: true,
      user: { id: 'usr_supplier_1', role: 'supplier' },
    });

    expect(mockDb.updateOne).toHaveBeenCalledWith(
      'partner_referrals',
      { supplierUserId: 'usr_supplier_1' },
      { $set: { source: 'facebook_group', campaign: 'founding_supplier_push' } }
    );
  });

  it('does not wrap responses when no referral code or campaign metadata is present', () => {
    const req = createReq({ body: { ref: 'p_ABC123' } });
    const res = createRes();
    const originalJson = res.json;
    const next = jest.fn();

    partnerReferralCampaignCapture(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).toBe(originalJson);
  });
});
