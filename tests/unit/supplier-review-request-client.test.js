'use strict';

const fs = require('fs');
const path = require('path');

describe('supplier review-request dashboard client', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/supplier-dashboard-home.js'),
    'utf8'
  );

  test('uses a CSRF-aware request helper for review requests', () => {
    expect(source).toContain('async function sendJson(');
    expect(source).toContain("sendJson('/api/v1/supplier/request-review'");
    expect(source).toContain("'X-CSRF-Token': token");
  });

  test('refreshes and retries after an explicit CSRF rejection', () => {
    expect(source).toContain('response.status === 403 || response.status === 419');
    expect(source).toContain('const retry = await csrfToken(true)');
  });

  test('has no availability card or write any more (it was never shown to customers)', () => {
    expect(source).not.toContain('/api/v1/supplier/availability');
    expect(source).not.toMatch(/save-availability|retry-availability|data-availability/);
  });

  test('loads review request history and keeps retries on the canonical secure send route', () => {
    expect(source).toContain("getJson('/api/v1/supplier/review-requests?limit=50')");
    expect(source).toContain('function renderReviewRequests(');
    expect(source).toContain('data-sdh-action="retry-request"');
    expect(source.match(/sendJson\('\/api\/v1\/supplier\/request-review'/g)).toHaveLength(2);
  });

  test('says why a request was refused: unverified email or an unapproved profile', () => {
    expect(source).toContain("code === 'EMAIL_NOT_VERIFIED'");
    expect(source).toContain("code === 'SUPPLIER_NOT_APPROVED'");
    expect(source).toContain('Verify your email address before you ask for reviews.');
    expect(source).toContain('You can ask for reviews once your profile has been approved.');
  });

  test('offers one Request a review button, in the Reviews card header', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '../../public/dashboard-supplier.html'),
      'utf8'
    );
    expect(html.match(/id="sdh-request-review-btn"/g)).toHaveLength(1);
    expect(html).not.toContain('id="copyReviewLinkBtn"');
    expect(html).not.toContain('rreq-toggle-form');
  });

  test('does not reference raw invitation or provider tracking fields in the supplier client', () => {
    expect(source).not.toContain('tokenHash');
    expect(source).not.toContain('providerMessageId');
    expect(source).not.toContain('emailLogId');
  });
});
