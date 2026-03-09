/**
 * Supplier Verification State Machine
 *
 * Defines the allowed verification states and valid transitions
 * for the supplier verification workflow.
 *
 * State flow:
 *   unverified ──► pending_review ──► needs_changes ──► pending_review (resubmit)
 *                       │
 *                       ├──► approved
 *                       └──► rejected
 *
 *   approved ──► suspended
 *   suspended ──► approved (reinstate)
 */

'use strict';

/**
 * All valid verification states.
 */
const VERIFICATION_STATES = {
  /** Supplier signed up but has never submitted for review */
  UNVERIFIED: 'unverified',
  /** Supplier submitted their profile/documents; awaiting admin review */
  PENDING_REVIEW: 'pending_review',
  /** Admin has requested changes; supplier must resubmit */
  NEEDS_CHANGES: 'needs_changes',
  /** Admin approved the supplier */
  APPROVED: 'approved',
  /** Admin rejected the supplier */
  REJECTED: 'rejected',
  /** Admin suspended a previously-approved supplier */
  SUSPENDED: 'suspended',
};

/**
 * Map of allowed transitions: currentState → [...allowedNextStates]
 *
 * Actor key:
 *   'supplier' – supplier-initiated transition
 *   'admin'    – admin-initiated transition
 */
const ALLOWED_TRANSITIONS = {
  [VERIFICATION_STATES.UNVERIFIED]: {
    supplier: [VERIFICATION_STATES.PENDING_REVIEW],
    admin: [VERIFICATION_STATES.APPROVED, VERIFICATION_STATES.REJECTED],
  },
  [VERIFICATION_STATES.PENDING_REVIEW]: {
    supplier: [],
    admin: [
      VERIFICATION_STATES.APPROVED,
      VERIFICATION_STATES.REJECTED,
      VERIFICATION_STATES.NEEDS_CHANGES,
    ],
  },
  [VERIFICATION_STATES.NEEDS_CHANGES]: {
    supplier: [VERIFICATION_STATES.PENDING_REVIEW],
    admin: [VERIFICATION_STATES.REJECTED],
  },
  [VERIFICATION_STATES.APPROVED]: {
    supplier: [],
    admin: [VERIFICATION_STATES.SUSPENDED, VERIFICATION_STATES.REJECTED],
  },
  [VERIFICATION_STATES.REJECTED]: {
    supplier: [VERIFICATION_STATES.PENDING_REVIEW],
    admin: [VERIFICATION_STATES.APPROVED],
  },
  [VERIFICATION_STATES.SUSPENDED]: {
    supplier: [],
    admin: [VERIFICATION_STATES.APPROVED, VERIFICATION_STATES.REJECTED],
  },
};

/**
 * Normalise a legacy verificationStatus value to the canonical state enum.
 *
 * Legacy values stored in the DB before this state machine was introduced:
 *   undefined / null / 'pending' → UNVERIFIED
 *   'verified'                   → APPROVED
 *   'rejected'                   → REJECTED
 *
 * @param {string|undefined} rawStatus - Value from the supplier record
 * @param {boolean} [isVerified=false] - Legacy `verified` boolean field
 * @returns {string} Canonical VERIFICATION_STATES value
 */
function normaliseState(rawStatus, isVerified = false) {
  if (!rawStatus || rawStatus === 'pending') {
    return isVerified ? VERIFICATION_STATES.APPROVED : VERIFICATION_STATES.UNVERIFIED;
  }
  if (rawStatus === 'verified') {
    return VERIFICATION_STATES.APPROVED;
  }
  if (Object.values(VERIFICATION_STATES).includes(rawStatus)) {
    return rawStatus;
  }
  // Unknown value – treat as unverified to be safe
  return VERIFICATION_STATES.UNVERIFIED;
}

/**
 * Check whether a transition is permitted.
 *
 * @param {string} currentState - Current verificationStatus
 * @param {string} nextState    - Desired next state
 * @param {'supplier'|'admin'} actor - Who is initiating the transition
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canTransition(currentState, nextState, actor) {
  const canonicalCurrent = normaliseState(currentState);
  const transitions = ALLOWED_TRANSITIONS[canonicalCurrent];

  if (!transitions) {
    return { allowed: false, reason: `Unknown current state: ${currentState}` };
  }

  const actorTransitions = transitions[actor];
  if (!actorTransitions) {
    return { allowed: false, reason: `Unknown actor: ${actor}` };
  }

  if (!actorTransitions.includes(nextState)) {
    return {
      allowed: false,
      reason: `Transition from '${canonicalCurrent}' to '${nextState}' is not permitted for ${actor}`,
    };
  }

  return { allowed: true };
}

/**
 * Derive the `verified` boolean from a canonical state for backward compatibility.
 *
 * @param {string} state - Canonical VERIFICATION_STATES value
 * @returns {boolean}
 */
function isVerifiedFromState(state) {
  return state === VERIFICATION_STATES.APPROVED;
}

module.exports = {
  VERIFICATION_STATES,
  ALLOWED_TRANSITIONS,
  normaliseState,
  canTransition,
  isVerifiedFromState,
};
