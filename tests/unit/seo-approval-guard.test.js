'use strict';

const { approvalDecision } = require('../../services/seoRecordLifecycle.util');

describe('SEO fixture approval guard', () => {
  test('blocks explicit, exact and previously quarantined fixtures', () => {
    expect(approvalDecision({ id: '1', name: 'Real Co', isTest: true }).allowed).toBe(false);
    expect(approvalDecision({ id: '2', title: 'Test' }).allowed).toBe(false);
    expect(approvalDecision({ id: '3', name: 'Real Co', seoQuarantined: true }).allowed).toBe(
      false
    );
  });

  test('does not block a real company or a heuristic-only name', () => {
    expect(approvalDecision({ id: '1', name: 'Cardiff Caterers' }).allowed).toBe(true);
    expect(approvalDecision({ id: '2', name: 'Test Valley Marquees' }).allowed).toBe(true);
  });
});
