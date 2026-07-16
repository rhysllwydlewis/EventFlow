'use strict';

const fs = require('fs');
const path = require('path');

describe('admin review request operations client', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../public/admin-emails.html'), 'utf8');
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/admin-emails-init.js'),
    'utf8'
  );

  test('adds a dedicated review request operations tab and filters', () => {
    expect(page).toContain('data-tab="reviewRequests"');
    expect(page).toContain('id="emailTabReviewRequests"');
    expect(page).toContain('id="reviewRequestFilterSupplier"');
    expect(page).toContain('id="reviewRequestFilterRecipient"');
    expect(page).toContain('id="reviewRequestFilterStatus"');
  });

  test('loads operational data and links requests to the existing email log detail', () => {
    expect(source).toContain('/api/admin/email-centre/review-requests?');
    expect(source).toContain('renderReviewRequests');
    expect(source).toContain('data-log-id');
    expect(source).toContain('openDetail');
  });
});
