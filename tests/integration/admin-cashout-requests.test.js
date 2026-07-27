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

  test('releases holds on rejection and finalises redemption on delivery', () => {
    expect(routeContent).toContain('releaseCashoutHold');
    expect(routeContent).toContain('CREDIT_TYPES.REDEEM');
    expect(routeContent).toContain('externalRef === request.id');
    expect(routeContent).toContain('request.finalRedeemTxnId');
  });

  test('persists the permanent redemption before releasing its temporary hold', () => {
    const deliveryStart = routeContent.indexOf("} else if (status === 'delivered') {");
    const deliveryBlock = routeContent.slice(deliveryStart);
    const insertPosition = deliveryBlock.indexOf('const cashoutTxInserted');
    const releasePosition = deliveryBlock.indexOf('releaseCashoutHold');
    expect(insertPosition).toBeGreaterThan(-1);
    expect(releasePosition).toBeGreaterThan(insertPosition);
    expect(deliveryBlock).toContain('CASHOUT_HOLD_RELEASE_FAILED');
  });

  test('does not mark a cashout delivered without delivery evidence', () => {
    expect(routeContent).toContain('CASHOUT_DELIVERY_EVIDENCE_REQUIRED');
    expect(routeContent).toContain('Delivery evidence is required');
    expect(routeContent).toContain('deliveryDetails.reference');
  });

  test('fails when the final redemption ledger write does not persist', () => {
    expect(routeContent).toContain('CASHOUT_REDEEM_WRITE_FAILED');
    expect(routeContent).toContain('Failed to persist the final cashout redemption');
  });

  test('returns anti-abuse status codes instead of flattening them into a generic 500', () => {
    expect(routeContent).toContain('Number(err.statusCode) || 500');
    expect(routeContent).toContain("code: err.code || 'CASHOUT_UPDATE_FAILED'");
    expect(routeContent).toContain('assessment: err.assessment || undefined');
  });

  test('exposes the persisted fraud assessment in cashout detail', () => {
    expect(routeContent).toContain("findOne('partner_fraud_assessments'");
    expect(routeContent).toContain('fraudAssessment: fraudAssessment || null');
    expect(routeContent).toContain('fraudSummary');
  });

  test('only deletes terminal requests and records the action', () => {
    expect(routeContent).toContain("TERMINAL_STATES = ['rejected', 'delivered']");
    expect(routeContent).toContain('TERMINAL_STATES.includes(request.status)');
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
