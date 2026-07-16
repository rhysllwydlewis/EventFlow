'use strict';

const fs = require('fs');
const path = require('path');

describe('supplier review-request dashboard client', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/dashboard-supplier-overhaul.js'),
    'utf8'
  );

  test('uses a CSRF-aware request helper for review requests', () => {
    expect(source).toContain('async function fetchWithCsrfRetry');
    expect(source).toContain("fetchWithCsrfRetry('/api/v1/supplier/request-review'");
    expect(source).toContain("'X-CSRF-Token': token");
  });

  test('refreshes and retries after an explicit CSRF rejection', () => {
    expect(source).toContain('response.status !== 403 && response.status !== 419');
    expect(source).toContain('response.clone().json()');
    expect(source).toContain('response = await execute(true)');
  });

  test('also protects the existing availability write', () => {
    expect(source).toContain("fetchWithCsrfRetry('/api/v1/supplier/availability'");
  });
});
