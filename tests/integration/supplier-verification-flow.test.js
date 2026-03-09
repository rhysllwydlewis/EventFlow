/**
 * Integration tests for the supplier verification flow
 *
 * Tests the state machine, API endpoints, and state transitions
 * for the complete supplier verification lifecycle.
 */

'use strict';

const {
  VERIFICATION_STATES,
  normaliseState,
  canTransition,
  isVerifiedFromState,
} = require('../../utils/supplierVerificationStateMachine');

// ---------------------------------------------------------------------------
// State machine unit tests
// ---------------------------------------------------------------------------

describe('Supplier Verification State Machine', () => {
  describe('VERIFICATION_STATES', () => {
    it('should export all required states', () => {
      expect(VERIFICATION_STATES.UNVERIFIED).toBe('unverified');
      expect(VERIFICATION_STATES.PENDING_REVIEW).toBe('pending_review');
      expect(VERIFICATION_STATES.NEEDS_CHANGES).toBe('needs_changes');
      expect(VERIFICATION_STATES.APPROVED).toBe('approved');
      expect(VERIFICATION_STATES.REJECTED).toBe('rejected');
      expect(VERIFICATION_STATES.SUSPENDED).toBe('suspended');
    });
  });

  describe('normaliseState()', () => {
    it('maps undefined → unverified', () => {
      expect(normaliseState(undefined, false)).toBe(VERIFICATION_STATES.UNVERIFIED);
    });

    it('maps null → unverified', () => {
      expect(normaliseState(null, false)).toBe(VERIFICATION_STATES.UNVERIFIED);
    });

    it('maps legacy "pending" → unverified (not yet submitted)', () => {
      expect(normaliseState('pending', false)).toBe(VERIFICATION_STATES.UNVERIFIED);
    });

    it('maps legacy "verified" → approved', () => {
      expect(normaliseState('verified', true)).toBe(VERIFICATION_STATES.APPROVED);
    });

    it('maps verified=true + missing status → approved', () => {
      expect(normaliseState(undefined, true)).toBe(VERIFICATION_STATES.APPROVED);
    });

    it('maps "rejected" → rejected', () => {
      expect(normaliseState('rejected', false)).toBe(VERIFICATION_STATES.REJECTED);
    });

    it('maps "pending_review" → pending_review', () => {
      expect(normaliseState('pending_review', false)).toBe(VERIFICATION_STATES.PENDING_REVIEW);
    });

    it('maps "needs_changes" → needs_changes', () => {
      expect(normaliseState('needs_changes', false)).toBe(VERIFICATION_STATES.NEEDS_CHANGES);
    });

    it('maps "approved" → approved', () => {
      expect(normaliseState('approved', true)).toBe(VERIFICATION_STATES.APPROVED);
    });

    it('maps "suspended" → suspended', () => {
      expect(normaliseState('suspended', false)).toBe(VERIFICATION_STATES.SUSPENDED);
    });

    it('maps unknown value → unverified', () => {
      expect(normaliseState('some_unknown_status', false)).toBe(VERIFICATION_STATES.UNVERIFIED);
    });
  });

  describe('isVerifiedFromState()', () => {
    it('returns true only for APPROVED', () => {
      expect(isVerifiedFromState(VERIFICATION_STATES.APPROVED)).toBe(true);
    });

    it('returns false for all other states', () => {
      [
        VERIFICATION_STATES.UNVERIFIED,
        VERIFICATION_STATES.PENDING_REVIEW,
        VERIFICATION_STATES.NEEDS_CHANGES,
        VERIFICATION_STATES.REJECTED,
        VERIFICATION_STATES.SUSPENDED,
      ].forEach(state => {
        expect(isVerifiedFromState(state)).toBe(false);
      });
    });
  });

  describe('canTransition() – supplier actor', () => {
    it('allows unverified → pending_review (supplier submits)', () => {
      const result = canTransition('unverified', VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
      expect(result.allowed).toBe(true);
    });

    it('allows rejected → pending_review (supplier resubmits)', () => {
      const result = canTransition('rejected', VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
      expect(result.allowed).toBe(true);
    });

    it('allows needs_changes → pending_review (supplier resubmits after changes)', () => {
      const result = canTransition('needs_changes', VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
      expect(result.allowed).toBe(true);
    });

    it('denies supplier trying to approve themselves', () => {
      const result = canTransition('pending_review', VERIFICATION_STATES.APPROVED, 'supplier');
      expect(result.allowed).toBe(false);
    });

    it('denies approved → pending_review (already approved)', () => {
      const result = canTransition('approved', VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
      expect(result.allowed).toBe(false);
    });

    it('denies supplier submitting when already pending_review', () => {
      const result = canTransition(
        'pending_review',
        VERIFICATION_STATES.PENDING_REVIEW,
        'supplier'
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('canTransition() – admin actor', () => {
    it('allows pending_review → approved', () => {
      const result = canTransition('pending_review', VERIFICATION_STATES.APPROVED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('allows pending_review → rejected', () => {
      const result = canTransition('pending_review', VERIFICATION_STATES.REJECTED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('allows pending_review → needs_changes', () => {
      const result = canTransition('pending_review', VERIFICATION_STATES.NEEDS_CHANGES, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('allows approved → suspended', () => {
      const result = canTransition('approved', VERIFICATION_STATES.SUSPENDED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('allows suspended → approved (reinstate)', () => {
      const result = canTransition('suspended', VERIFICATION_STATES.APPROVED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('allows unverified → approved (direct admin approval)', () => {
      const result = canTransition('unverified', VERIFICATION_STATES.APPROVED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('denies approved → needs_changes (must suspend first)', () => {
      const result = canTransition('approved', VERIFICATION_STATES.NEEDS_CHANGES, 'admin');
      expect(result.allowed).toBe(false);
    });

    it('denies needs_changes → approved (must resubmit first)', () => {
      const result = canTransition('needs_changes', VERIFICATION_STATES.APPROVED, 'admin');
      expect(result.allowed).toBe(false);
    });

    it('denies rejected → suspended', () => {
      const result = canTransition('rejected', VERIFICATION_STATES.SUSPENDED, 'admin');
      expect(result.allowed).toBe(false);
    });

    it('includes a human-readable reason when transition is denied', () => {
      const result = canTransition('approved', VERIFICATION_STATES.NEEDS_CHANGES, 'admin');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('approved');
    });

    it('handles legacy "verified" status (backwards compat)', () => {
      // A record with verificationStatus='verified' should be treated as 'approved'
      const result = canTransition('verified', VERIFICATION_STATES.SUSPENDED, 'admin');
      expect(result.allowed).toBe(true);
    });

    it('handles legacy undefined status with verified=true (backwards compat)', () => {
      // normalise to 'approved'
      const result = canTransition(undefined, VERIFICATION_STATES.SUSPENDED, 'admin');
      // verified=false is implied in canTransition without 2nd arg – defaults to unverified
      // So this should NOT be allowed (unverified → suspended is not in the map)
      expect(result.allowed).toBe(false);
    });
  });

  describe('canTransition() – invalid inputs', () => {
    it('normalises unknown current state to unverified before checking', () => {
      // Unknown state is normalised to 'unverified', so admin can still approve
      const result = canTransition('bogus_state', VERIFICATION_STATES.APPROVED, 'admin');
      // This is allowed (unverified → approved is a valid admin transition)
      expect(result.allowed).toBe(true);
    });

    it('returns allowed=false for unknown actor', () => {
      const result = canTransition('pending_review', VERIFICATION_STATES.APPROVED, 'hacker');
      expect(result.allowed).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Endpoint structure tests (code-level, no HTTP layer required)
// ---------------------------------------------------------------------------

describe('Supplier Admin Route Structure', () => {
  const fs = require('fs');
  const path = require('path');

  const supplierAdminContent = fs.readFileSync(
    path.join(__dirname, '../../routes/supplier-admin.js'),
    'utf8'
  );

  it('should define POST /suppliers/:id/approve endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/:id/approve'");
  });

  it('should define POST /suppliers/:id/reject endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/:id/reject'");
  });

  it('should define POST /suppliers/:id/request-changes endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/:id/request-changes'");
  });

  it('should define POST /suppliers/:id/suspend endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/:id/suspend'");
  });

  it('should define GET /suppliers/:id/audit endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/:id/audit'");
  });

  it('should define GET /suppliers/pending-verification endpoint', () => {
    expect(supplierAdminContent).toContain("'/suppliers/pending-verification'");
  });

  it('should import and use the state machine', () => {
    expect(supplierAdminContent).toContain('supplierVerificationStateMachine');
    expect(supplierAdminContent).toContain('canTransition');
    expect(supplierAdminContent).toContain('VERIFICATION_STATES');
  });

  it('should require a reason for rejection', () => {
    expect(supplierAdminContent).toContain('A rejection reason is required');
  });

  it('should require a reason for requesting changes', () => {
    expect(supplierAdminContent).toContain('A reason for requesting changes is required');
  });

  it('should require a reason for suspension', () => {
    expect(supplierAdminContent).toContain('A suspension reason is required');
  });

  it('should log audit events for all admin actions', () => {
    expect(supplierAdminContent).toContain('AUDIT_ACTIONS.SUPPLIER_APPROVED');
    expect(supplierAdminContent).toContain('AUDIT_ACTIONS.SUPPLIER_REJECTED');
    expect(supplierAdminContent).toContain('AUDIT_ACTIONS.SUPPLIER_NEEDS_CHANGES');
    expect(supplierAdminContent).toContain('AUDIT_ACTIONS.SUPPLIER_SUSPENDED');
  });
});

describe('Supplier Route Structure – Verification Submission', () => {
  const fs = require('fs');
  const path = require('path');

  const supplierRouteContent = fs.readFileSync(
    path.join(__dirname, '../../routes/supplier.js'),
    'utf8'
  );

  it('should define GET /verification/status endpoint', () => {
    expect(supplierRouteContent).toContain("'/verification/status'");
  });

  it('should define POST /verification/submit endpoint', () => {
    expect(supplierRouteContent).toContain("'/verification/submit'");
  });

  it('should validate required profile fields before submission', () => {
    expect(supplierRouteContent).toContain('missingFields');
  });

  it('should use the state machine for submission transition', () => {
    expect(supplierRouteContent).toContain('canTransition');
    expect(supplierRouteContent).toContain('PENDING_REVIEW');
  });

  it('should restrict submission to supplier role', () => {
    expect(supplierRouteContent).toContain('Only suppliers can submit verification');
  });
});

describe('Admin-User-Management Route – Verify Endpoint', () => {
  const fs = require('fs');
  const path = require('path');

  const routeContent = fs.readFileSync(
    path.join(__dirname, '../../routes/admin-user-management.js'),
    'utf8'
  );

  it('should have POST /suppliers/:id/verify endpoint', () => {
    expect(routeContent).toContain("'/suppliers/:id/verify'");
  });

  it('should use state machine in verify endpoint', () => {
    expect(routeContent).toContain('supplierVerificationStateMachine');
  });

  it('should enforce state transition before verifying', () => {
    expect(routeContent).toContain('canTransition');
  });

  it('should return 409 on invalid transition', () => {
    expect(routeContent).toContain('status(409)');
  });

  it('should require rejection notes when rejecting', () => {
    expect(routeContent).toContain('A rejection reason is required');
  });
});

// ---------------------------------------------------------------------------
// Verification flow simulation tests (no DB, using mock objects)
// ---------------------------------------------------------------------------

describe('Supplier Verification Flow Simulation', () => {
  /**
   * Simulate the full happy path: signup → submit → admin review → approval.
   */
  it('happy path: unverified → pending_review → approved', () => {
    // 1. Supplier signs up – starts in unverified
    const supplierState = { verificationStatus: 'unverified', verified: false };

    // 2. Supplier submits for review
    let check = canTransition(
      supplierState.verificationStatus,
      VERIFICATION_STATES.PENDING_REVIEW,
      'supplier'
    );
    expect(check.allowed).toBe(true);
    supplierState.verificationStatus = VERIFICATION_STATES.PENDING_REVIEW;

    // 3. Admin approves
    check = canTransition(supplierState.verificationStatus, VERIFICATION_STATES.APPROVED, 'admin');
    expect(check.allowed).toBe(true);
    supplierState.verificationStatus = VERIFICATION_STATES.APPROVED;
    supplierState.verified = isVerifiedFromState(VERIFICATION_STATES.APPROVED);

    expect(supplierState.verified).toBe(true);
    expect(supplierState.verificationStatus).toBe('approved');
  });

  it('rejection path: pending_review → rejected → resubmit → approved', () => {
    let state = 'pending_review';

    // Admin rejects
    let check = canTransition(state, VERIFICATION_STATES.REJECTED, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.REJECTED;

    // Supplier resubmits
    check = canTransition(state, VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.PENDING_REVIEW;

    // Admin approves on second pass
    check = canTransition(state, VERIFICATION_STATES.APPROVED, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.APPROVED;

    expect(state).toBe('approved');
  });

  it('needs-changes path: pending_review → needs_changes → resubmit → approved', () => {
    let state = 'pending_review';

    // Admin requests changes
    let check = canTransition(state, VERIFICATION_STATES.NEEDS_CHANGES, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.NEEDS_CHANGES;

    // Supplier resubmits
    check = canTransition(state, VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.PENDING_REVIEW;

    // Admin approves
    check = canTransition(state, VERIFICATION_STATES.APPROVED, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.APPROVED;

    expect(state).toBe('approved');
  });

  it('suspension path: approved → suspended → reinstated', () => {
    let state = 'approved';

    // Admin suspends
    let check = canTransition(state, VERIFICATION_STATES.SUSPENDED, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.SUSPENDED;

    // Admin reinstates
    check = canTransition(state, VERIFICATION_STATES.APPROVED, 'admin');
    expect(check.allowed).toBe(true);
    state = VERIFICATION_STATES.APPROVED;

    expect(state).toBe('approved');
  });

  it('blocks supplier from reaching approved without admin review', () => {
    // Supplier cannot jump directly to approved
    const check = canTransition('unverified', VERIFICATION_STATES.APPROVED, 'supplier');
    expect(check.allowed).toBe(false);
  });

  it('blocks supplier from skipping needs_changes straight to approved', () => {
    const check = canTransition('needs_changes', VERIFICATION_STATES.APPROVED, 'supplier');
    expect(check.allowed).toBe(false);
  });

  it('blocks double-submission while pending_review', () => {
    const check = canTransition('pending_review', VERIFICATION_STATES.PENDING_REVIEW, 'supplier');
    expect(check.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit action constants tests
// ---------------------------------------------------------------------------

describe('Audit Action Constants', () => {
  it('should define all required supplier verification audit actions', () => {
    const { AUDIT_ACTIONS } = require('../../middleware/audit');

    expect(AUDIT_ACTIONS.SUPPLIER_APPROVED).toBe('supplier_approved');
    expect(AUDIT_ACTIONS.SUPPLIER_REJECTED).toBe('supplier_rejected');
    expect(AUDIT_ACTIONS.SUPPLIER_NEEDS_CHANGES).toBe('supplier_needs_changes');
    expect(AUDIT_ACTIONS.SUPPLIER_SUSPENDED).toBe('supplier_suspended');
    expect(AUDIT_ACTIONS.SUPPLIER_REINSTATED).toBe('supplier_reinstated');
    expect(AUDIT_ACTIONS.SUPPLIER_VERIFICATION_SUBMITTED).toBe('supplier_verification_submitted');
  });
});
