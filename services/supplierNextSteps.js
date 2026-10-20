/**
 * Supplier "next steps" milestone list
 *
 * The supplier counterpart of GET /api/v1/customer/milestones. Every step is a
 * plain yes/no derived from stored state, independent of the supplier's email
 * preferences, and steps that cannot be started yet say so (`locked` plus a
 * `lockedReason`) instead of being offered as if they were available. The first
 * step that is neither done nor locked is the primary action.
 *
 * What gates what (verified against the routes):
 *   - editing the profile and uploading photos needs a verified email
 *   - creating packages needs a verified email AND an approved supplier
 *   - sending review requests needs a verified email AND an approved supplier
 *   - personal calendar entries need a verified email
 */

'use strict';

const PROFILE_HREF = '/dashboard/supplier#my-suppliers';

/**
 * Whether the fields the verification form requires (plus a discovery postcode)
 * are all filled in.
 *
 * @param {Object} supplier - Supplier document
 * @returns {boolean} True when business details are complete
 */
function hasBusinessDetails(supplier) {
  const filled = value => String(value || '').trim() !== '';
  return (
    filled(supplier.name) &&
    // Same required fields as POST /verification/submit, where "Other" is a valid category.
    filled(supplier.category) &&
    filled(supplier.location) &&
    filled(supplier.basePostcode || supplier.venuePostcode) &&
    filled(supplier.phone) &&
    filled(supplier.email)
  );
}

/**
 * Describe why the verification step cannot be acted on right now, if it cannot.
 *
 * @param {Object} verification - The `verification` block of the summary
 * @returns {string|null} Reason, or null when the supplier can submit
 */
function verificationLockReason(verification) {
  if (verification.status === 'pending_review') {
    return 'Your profile is waiting for an admin to review it';
  }
  if (verification.status === 'suspended') {
    return 'Your profile has been suspended - contact support';
  }
  if (verification.rejectionCount >= 5) {
    return 'You have used all your verification attempts - contact support';
  }
  return null;
}

/**
 * Build the milestone list.
 *
 * @param {Object} input - State the steps are derived from
 * @param {Object} input.supplier - Supplier document (photo-hydrated)
 * @param {Object} input.verification - The `verification` block of the summary
 * @param {{checks: Array<{id: string, done: boolean, href: string}>}} input.completeness - Profile completeness
 * @param {{total: number, withoutPhoto: number}} input.packages - Package totals
 * @param {number} input.reviewRequestsSent - Review requests this supplier has sent
 * @param {number} input.approvedReviewCount - Approved reviews
 * @param {boolean} input.hasCalendarActivity - Any personal calendar entry or owned public event
 * @returns {{steps: Object[], completed: number, total: number, percent: number, primaryStepId: (string|null)}}
 */
function evaluateNextSteps(input) {
  const { supplier, verification, completeness, packages } = input;
  const emailOk = verification.emailVerified === true;
  // null = the account lookup failed: do not lock steps on a guess.
  const emailUnknown = verification.emailVerified === null;
  const approved = verification.approved === true;
  const checkDone = id => completeness.checks.some(check => check.id === id && check.done);
  const checkHref = id => {
    const found = completeness.checks.find(check => check.id === id);
    return found ? found.href : PROFILE_HREF;
  };

  const needEmail = emailOk || emailUnknown ? null : 'Verify your email address first';
  const needApproval = approved ? null : 'Available once your profile is approved';

  const definitions = [
    {
      id: 'verify-email',
      label: 'Verify your email address',
      done: emailOk,
      href: '/verify',
      lockedReason: emailUnknown ? 'We could not check your email status just now' : null,
    },
    {
      id: 'business-details',
      label: 'Complete your business details',
      done: hasBusinessDetails(supplier),
      href: PROFILE_HREF,
      lockedReason: needEmail,
    },
    {
      id: 'get-verified',
      label: 'Get your profile verified',
      done: approved,
      href: '/dashboard/supplier#verification',
      lockedReason: verificationLockReason(verification),
    },
    {
      id: 'profile-photo',
      label: 'Add a profile photo',
      done: checkDone('logo'),
      href: checkHref('logo'),
      lockedReason: needEmail,
    },
    {
      id: 'description',
      label: 'Write a description of at least 100 characters',
      done: checkDone('description'),
      href: checkHref('description'),
      lockedReason: needEmail,
    },
    {
      id: 'gallery',
      label: 'Add at least 3 gallery photos',
      done: checkDone('gallery'),
      href: checkHref('gallery'),
      lockedReason: needEmail,
    },
    {
      id: 'banner',
      label: 'Add a banner image',
      done: checkDone('coverImage'),
      href: checkHref('coverImage'),
      lockedReason: needEmail,
    },
    {
      id: 'social-links',
      label: 'Link at least 2 social profiles',
      done: checkDone('socials'),
      href: checkHref('socials'),
      lockedReason: needEmail,
    },
    {
      id: 'website',
      label: 'Add your website',
      done: checkDone('website'),
      href: checkHref('website'),
      lockedReason: needEmail,
    },
    {
      id: 'first-package',
      label: 'Create your first package',
      done: packages.total > 0,
      href: '/dashboard/supplier#toggle-package-form',
      lockedReason: needEmail || needApproval,
    },
    {
      id: 'package-photos',
      label: 'Add a photo to every package',
      done: packages.total > 0 && packages.withoutPhoto === 0,
      href: '/dashboard/supplier#toggle-package-form',
      lockedReason: packages.total === 0 ? 'Create a package first' : needEmail || needApproval,
    },
    {
      id: 'request-review',
      label: 'Ask a past customer for a review',
      done: input.reviewRequestsSent > 0 || input.approvedReviewCount > 0,
      href: '/dashboard/supplier#review-requests',
      lockedReason: needEmail || needApproval,
    },
    {
      id: 'calendar',
      label: 'Add an event to your calendar',
      done: input.hasCalendarActivity === true,
      href: '/dashboard/supplier#availability-calendar',
      lockedReason: needEmail,
    },
  ];

  const steps = definitions.map((definition, index) => ({
    id: definition.id,
    label: definition.label,
    done: definition.done,
    locked: !definition.done && definition.lockedReason !== null,
    lockedReason: definition.done ? null : definition.lockedReason,
    href: definition.href,
    priority: index + 1,
  }));

  const completed = steps.filter(step => step.done).length;
  const primary = steps.find(step => !step.done && !step.locked);

  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    primaryStepId: primary ? primary.id : null,
  };
}

module.exports = { evaluateNextSteps, hasBusinessDetails, verificationLockReason };
