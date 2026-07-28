'use strict';

const fs = require('fs');
const path = require('path');

const routeContent = fs.readFileSync(
  path.join(__dirname, '../../routes/admin-cashout-requests.js'),
  'utf8'
);

describe('admin cashout request security', () => {
  test('all routes require an administrator and writes require CSRF', () => {
    expect(routeContent).toMatch(/router\.use\(authRequired,\s*roleRequired\(['"]admin['"]\)\)/);
    expect(routeContent).toContain("router.patch('/:id', csrfProtection,");
    expect(routeContent).toContain("router.delete('/:id', csrfProtection,");
  });

  test('enforces the cashout status state machine', () => {
    expect(routeContent).toContain('VALID_TRANSITIONS');
    expect(routeContent).toContain('Cannot transition from');
    expect(routeContent).toContain("submitted: ['approved', 'rejected']");
    expect(routeContent).toContain("processing: ['delivered', 'rejected']");
  });

  test('runs and persists a fraud assessment before approval', () => {
    expect(routeContent).toContain('partnerAntiAbuse.assessCashout');
    expect(routeContent).toContain('partnerAntiAbuse.persistAssessment');
    expect(routeContent).toContain('PARTNER_CASHOUT_HIGH_RISK');
    expect(routeContent).toContain('PARTNER_CASHOUT_REVIEW_NOTE_REQUIRED');
    expect(routeContent).toContain('PARTNER_CASHOUT_RISK_WRITE_FAILED');
  });

  test('requires an active hold, a valid amount and delivery evidence', () => {
    expect(routeContent).toContain('CASHOUT_DELIVERY_EVIDENCE_REQUIRED');
    expect(routeContent).toContain('CASHOUT_HOLD_MISSING');
    expect(routeContent).toContain('CASHOUT_POINTS_INVALID');
    expect(routeContent).toContain('deliveryDetails.reference');
  });

  test('persists the permanent redemption before releasing its temporary hold', () => {
    const deliveryStart = routeContent.indexOf("if (status === 'delivered') {", 7000);
    const deliveryBlock = routeContent.slice(deliveryStart);
    const insertPosition = deliveryBlock.indexOf(
      "insertOne('partner_credit_transactions', finalRedeem)"
    );
    const releasePosition = deliveryBlock.indexOf('releaseCashoutHold');
    expect(insertPosition).toBeGreaterThan(-1);
    expect(releasePosition).toBeGreaterThan(insertPosition);
    expect(deliveryBlock).toContain('CASHOUT_REDEEM_WRITE_FAILED');
    expect(deliveryBlock).toContain('CASHOUT_HOLD_RELEASE_FAILED');
  });

  test('verifies a stored final redemption before trusting its transaction ID', () => {
    expect(routeContent).toContain('transaction.id === cashoutRequest.finalRedeemTxnId');
    expect(routeContent).toContain('transaction.externalRef === cashoutRequest.id');
    expect(routeContent).toContain('updates.finalRedeemTxnId = existingRedeem.id');
  });

  test('returns anti-abuse status codes instead of flattening them into a generic 500', () => {
    expect(routeContent).toContain('Number(error.statusCode) || 500');
    expect(routeContent).toContain("code: error.code || 'CASHOUT_UPDATE_FAILED'");
    expect(routeContent).toContain('assessment: error.assessment || undefined');
  });

  test('exposes the persisted fraud assessment in cashout detail and list summaries', () => {
    expect(routeContent).toContain("findOne('partner_fraud_assessments'");
    expect(routeContent).toContain('fraudAssessment: fraudAssessment || null');
    expect(routeContent).toContain('fraudSummary');
  });

  test('only deletes terminal requests and records the action', () => {
    expect(routeContent).toContain("TERMINAL_STATES = ['rejected', 'delivered']");
    expect(routeContent).toContain('TERMINAL_STATES.includes(cashoutRequest.status)');
    expect(routeContent).toContain("deleteOne('partner_cashout_requests'");
    expect(routeContent).toContain('deleted cashout request');
  });
});

describe('partner pages remain noindex', () => {
  const seoContent = fs.readFileSync(path.join(__dirname, '../../middleware/seo.js'), 'utf8');

  test('partner pages are excluded from indexing', () => {
    expect(seoContent).toContain("'/partner'");
    expect(seoContent).toContain('X-Robots-Tag');
    expect(seoContent).toContain('noindex, nofollow');
  });
});
