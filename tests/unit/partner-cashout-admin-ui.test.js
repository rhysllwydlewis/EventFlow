'use strict';

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/admin-cashout-requests-init.js'),
  'utf8'
);

describe('partner cashout admin safety UI', () => {
  test('surfaces emergency payout controls with a reasoned CSRF-protected write path', () => {
    expect(script).toContain('/api/v1/admin/cashout-requests/ops/controls');
    expect(script).toContain('getCsrfToken()');
    expect(script).toContain("'X-CSRF-Token': csrfToken");
    expect(script).toContain('Operational reason');
    expect(script).toContain('Pause cashouts');
    expect(script).toContain('Master-pause payouts');
  });

  test('surfaces identity, ledger reconciliation and fraud state on ordinary cashout review', () => {
    expect(script).toContain('cashoutIdentitySummary');
    expect(script).toContain('reconciliationSummary');
    expect(script).toContain('fraudSummary');
    expect(script).toContain('Identity review needed');
    expect(script).toContain('Ledger reconciliation passed.');
  });

  test('provides reasoned identity-review and reconciliation actions from the cashout modal', () => {
    expect(script).toContain('/ops/identity/');
    expect(script).toContain('/ops/reconcile/');
    expect(script).toContain('Verify identity');
    expect(script).toContain('Reject identity');
    expect(script).toContain('Run ledger reconciliation');
    expect(script).toContain('targetStatus: safetyTargetStatus(_currentRequest)');
  });

  test('does not describe the PR3 master control as pausing all referral earning', () => {
    expect(script).toContain('Master payout pause');
    expect(script).not.toContain('Pause Partner Programme');
  });
});
