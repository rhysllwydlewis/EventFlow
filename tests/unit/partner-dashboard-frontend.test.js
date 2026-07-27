/**
 * Static contract tests for the partner dashboard frontend.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../public/partner/dashboard.html'), 'utf8');
const script = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/partner-dashboard-init.js'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/partner-dashboard-v2.css'),
  'utf8'
);

describe('partner dashboard frontend contract', () => {
  it('provides six accessible dashboard sections', () => {
    for (const panel of ['overview', 'referrals', 'rewards', 'share', 'support', 'settings']) {
      expect(html).toContain(`data-panel="${panel}"`);
      expect(html).toContain(`data-dashboard-panel="${panel}"`);
    }
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
  });

  it('renders all four advertised referral milestones', () => {
    expect(script).toContain("referralStage('Signup'");
    expect(script).toContain("referralStage('First package'");
    expect(script).toContain("referralStage('First review'");
    expect(script).toContain("referralStage('Paid subscription'");
  });

  it('uses a current state object for copy and sharing actions', () => {
    expect(script).toContain('state.partner?.refLink');
    expect(script).toContain('state.partner?.refCode');
    expect(script).toContain('state.partner.refLink = body.refLink');
    expect(script).toContain('state.partner.refCode = body.newCode');
  });

  it('sends an idempotency key with each cashout request', () => {
    expect(script).toContain("'Idempotency-Key': state.cashoutKey");
    expect(script).toContain('idempotencyKey: state.cashoutKey');
  });

  it('loads secondary dashboard sections independently', () => {
    expect(script).toContain('Promise.allSettled');
    expect(script).toContain('loadReferrals()');
    expect(script).toContain('loadTransactions()');
    expect(script).toContain('loadCashouts()');
    expect(script).toContain('loadCodeHistory()');
    expect(script).toContain('loadTickets()');
  });

  it('uses partner-specific support detail and reply endpoints', () => {
    expect(script).toContain('/support-tickets/${encodeURIComponent(ticketId)}');
    expect(script).toContain('/support-tickets/${encodeURIComponent(ticketId)}/reply');
  });

  it('includes focus trapping, Escape close and reduced-motion support', () => {
    expect(script).toContain("event.key === 'Escape'");
    expect(script).toContain("event.key !== 'Tab'");
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('surfaces existing Share Pack and Programme Terms resources', () => {
    expect(html).toContain('/partner/media-pack.html');
    expect(html).toContain('/partner/terms.html');
  });
});
