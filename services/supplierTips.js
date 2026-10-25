/**
 * Supplier dashboard tips
 *
 * The "Next steps" checklist (services/supplierNextSteps.js) is the single place for "complete your
 * profile / get set up" items. Tips only say what the checklist cannot: advice from live activity
 * and data (waiting enquiries and conversations, reviews to answer, plan limits being reached,
 * packages awaiting approval, a calendar with nothing coming up) and account problems that carry
 * more than a checklist line can (a suspension, a rejection or requested changes with the admin's
 * note). A tip therefore never restates an open checklist step. The tips that used to duplicate one
 * were removed (checklist step in brackets):
 *   verify-email (verify-email), submit-verification and verification-pending (get-verified),
 *   write-description (description), add-photos (gallery), add-profile-photo (profile-photo),
 *   add-location (business-details), add-banner (banner), add-social-links (social-links),
 *   add-website (website), first-package (first-package), package-photos (package-photos),
 *   first-review (request-review), and choose-category for a profile with no category at all
 *   (business-details). publish-event (calendar) is kept but only once that step is done, and
 *   choose-category is kept for "Other" only: the checklist counts "Other" as a category filled in,
 *   so it says nothing about it.
 *
 * Tips are derived from this supplier's real state, never from generic filler. A tip whose data does
 * not exist is simply not produced, and a supplier with nothing to act on gets no tips (the
 * dashboard then hides the card). Tips contain no statistics or promises about outcomes; numbers in
 * them are the supplier's own (their photo allowance, their plan's limit, how many enquiries are
 * waiting).
 *
 * Shape of a tip (stable; the front end renders and wires it):
 *   {
 *     id,                // stable string
 *     priority,          // lower = more useful; the list is sorted by it
 *     category,          // 'account'|'enquiries'|'messages'|'reviews'|'packages'|'profile'|'plan'|'calendar'
 *     icon,              // single emoji for legacy renderers
 *     title, body,       // plain text (render with textContent)
 *     action: {
 *       type,            // see ACTION_TYPES
 *       label,           // button text
 *       href,            // page+anchor hint for plain links (null when the action has no page)
 *       field,           // optional: which profile field/section to focus, e.g. 'description'
 *       data,            // legacy: 'request-review' for the old inline review-request form
 *     },
 *   }
 *
 * The response carries at most MAX_TIPS tips plus `total` (how many applied).
 */

'use strict';

const { reviewState, reviewResponse, STATES } = require('../utils/reviewShape');
const { countAllowanceGalleryPhotos } = require('../utils/photoGalleryAllowance');

const MAX_TIPS = 3;

/**
 * The values `action.type` can take: every action the dashboard knows how to wire (the front end
 * maps each one). Not every type is used by a tip at any one time.
 */
const ACTION_TYPES = Object.freeze([
  'verify-email',
  'open-verification',
  'open-support',
  'open-profile-editor',
  'open-packages',
  'open-package-form',
  'open-enquiries',
  'open-messages',
  'open-reviews',
  'open-review-request',
  'open-calendar',
  'open-plan',
]);

const HREFS = Object.freeze({
  'verify-email': '/verify',
  'open-verification': '/dashboard/supplier#verification',
  'open-support': '/dashboard/supplier#tickets-heading',
  'open-profile-editor': '/dashboard/supplier#my-suppliers',
  'open-packages': '/dashboard/supplier#my-suppliers',
  'open-package-form': '/dashboard/supplier#toggle-package-form',
  'open-enquiries': '/dashboard/supplier#enquiries',
  'open-messages': '/dashboard/supplier#messages-heading',
  'open-reviews': '/dashboard/supplier#reviews-heading',
  'open-review-request': null,
  'open-calendar': '/dashboard/supplier#availability-calendar',
  'open-plan': '/supplier/subscription',
});

/**
 * Build a tip.
 *
 * @param {Object} spec - Tip fields
 * @param {string} spec.id - Stable id
 * @param {number} spec.priority - Lower is more useful
 * @param {string} spec.category - Tip family
 * @param {string} spec.icon - Emoji
 * @param {string} spec.title - Title
 * @param {string} spec.body - Body
 * @param {string} spec.type - One of ACTION_TYPES
 * @param {string} spec.label - Action label
 * @param {string} [spec.field] - Profile field/section to focus
 * @returns {Object} Tip
 */
function tip({ id, priority, category, icon, title, body, type, label, field }) {
  const action = { type, label, href: HREFS[type] };
  if (field) {
    action.field = field;
  }
  if (type === 'open-review-request') {
    // The old dashboard wires this button by name.
    action.data = 'request-review';
  }
  return { id, priority, category, icon, title, body, action };
}

/**
 * Pluralise a count for display.
 *
 * @param {number} count - Number
 * @param {string} singular - Singular noun
 * @param {string} plural - Plural noun
 * @returns {string} "1 package" / "3 packages"
 */
function counted(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * An admin's note as a sentence of its own, e.g. " Admin note: add a logo." (the note may or may
 * not end in punctuation).
 *
 * @param {string|null} notes - Note the admin left
 * @returns {string} Text starting with a space, or '' when there is no note
 */
function adminNote(notes) {
  const text = String(notes || '')
    .trim()
    .replace(/[\s.!?,;:]+$/, '');
  return text ? ` Admin note: ${text}.` : '';
}

/**
 * Tips about the account itself, only where they say more than the checklist's "Get your profile
 * verified" step: a suspension, a rejection or requested changes (with the admin's note) and an
 * approved record whose listing is not yet approved. Verifying the email, submitting for the first
 * time and waiting for a review are plain checklist steps (or their lock reasons), so no tip.
 * These come first because nothing else on the dashboard works until they are resolved.
 *
 * @param {Object} verification - summary.verification
 * @returns {Object[]} Tips
 */
function accountTips(verification) {
  if (verification.approved) {
    return [];
  }
  if (verification.emailVerified === false && verification.status !== 'suspended') {
    // Nothing below can be acted on until the email is verified, and that is the checklist's first step.
    return [];
  }
  const note = adminNote(verification.notes);
  switch (verification.status) {
    case 'needs_changes':
      return [
        tip({
          id: 'verification-changes',
          priority: 1,
          category: 'account',
          icon: '📝',
          title: 'Changes requested on your profile',
          body: `An admin asked for changes before approving it.${note} Update your profile and submit it again.`,
          type: 'open-verification',
          label: 'Review and resubmit',
        }),
      ];
    case 'rejected':
      return [
        verification.rejectionCount >= 5
          ? tip({
              id: 'verification-rejected-final',
              priority: 1,
              category: 'account',
              icon: '🚫',
              title: 'Your verification was not approved',
              body: `You have used all your verification attempts.${note} Contact support to take it further.`,
              type: 'open-support',
              label: 'Contact support',
            })
          : tip({
              id: 'verification-rejected',
              priority: 1,
              category: 'account',
              icon: '🚫',
              title: 'Your verification was not approved',
              body: `Your profile was not approved.${note} You can fix the points raised and submit it again.`,
              type: 'open-verification',
              label: 'Review and resubmit',
            }),
      ];
    case 'approved':
      // Verified, but the listing itself has not been approved: there is nothing to submit, and
      // the submit button would be refused (an approved record cannot be submitted again).
      return [
        tip({
          id: 'listing-awaiting-approval',
          priority: 1,
          category: 'account',
          icon: '⏳',
          title: 'Your profile is waiting for listing approval',
          body: 'Your verification is complete, but your listing has not been approved yet, so customers cannot see your profile. If this is taking a while, contact support.',
          type: 'open-support',
          label: 'Contact support',
        }),
      ];
    case 'suspended':
      return [
        tip({
          id: 'profile-suspended',
          priority: 1,
          category: 'account',
          icon: '⛔',
          title: 'Your profile is suspended',
          body: 'Customers cannot see your profile while it is suspended. Contact support to find out why and how to restore it.',
          type: 'open-support',
          label: 'Contact support',
        }),
      ];
    default:
      // Never submitted, or waiting for review: the checklist's "Get your profile verified" step.
      return [];
  }
}

/**
 * Tips about customers waiting on the supplier: enquiries, conversations, reviews to answer.
 * ("Ask for a first review" is the checklist's request-review step, so it is not a tip.)
 *
 * @param {Object} summary - Dashboard summary
 * @param {Object[]} reviewDocs - Stored reviews for this supplier
 * @returns {Object[]} Tips
 */
function customerTips(summary, reviewDocs) {
  const tips = [];
  const newRequests = summary.enquiries?.requests?.new;
  if (newRequests > 0) {
    tips.push(
      tip({
        id: 'new-enquiries',
        priority: 2,
        category: 'enquiries',
        icon: '📨',
        title: `${counted(newRequests, 'new enquiry', 'new enquiries')} to look at`,
        body: 'Customers have sent you quote requests or enquiries through your profile that you have not marked as read or handled yet. Their contact details are in each enquiry.',
        type: 'open-enquiries',
        label: 'Open enquiries',
      })
    );
  }

  const unanswered = summary.responses?.unanswered;
  if (unanswered > 0) {
    tips.push(
      tip({
        id: 'unanswered-conversations',
        priority: 3,
        category: 'messages',
        icon: '💬',
        title: `${counted(unanswered, 'conversation', 'conversations')} still need a reply`,
        body: `${counted(unanswered, 'conversation', 'conversations')} started by customers in the last ${summary.window.days} days ${unanswered === 1 ? 'is' : 'are'} more than a day old and ${unanswered === 1 ? 'has' : 'have'} no reply from you.`,
        type: 'open-messages',
        label: 'Open messages',
      })
    );
  } else if (summary.messages && summary.messages.unreadMessages > 0) {
    tips.push(
      tip({
        id: 'unread-messages',
        priority: 6,
        category: 'messages',
        icon: '💬',
        title: `You have ${counted(summary.messages.unreadMessages, 'unread message', 'unread messages')}`,
        body: 'Open your inbox to read them.',
        type: 'open-messages',
        label: 'Open messages',
      })
    );
  }

  const unansweredReviews = reviewDocs.filter(
    review => reviewState(review) === STATES.APPROVED && !reviewResponse(review)
  ).length;
  if (unansweredReviews > 0) {
    tips.push(
      tip({
        id: 'unanswered-reviews',
        priority: 4,
        category: 'reviews',
        icon: '⭐',
        title: `Reply to ${counted(unansweredReviews, 'review', 'reviews')}`,
        body: `${counted(unansweredReviews, 'published review has', 'published reviews have')} no reply from you yet. Your reply is shown publicly under the review.`,
        type: 'open-reviews',
        label: 'View reviews',
      })
    );
  }
  return tips;
}

/**
 * Tips about packages in review and the plan's package limit. ("Create your first package" and
 * "Add a photo to every package" are checklist steps, so they are not tips.)
 *
 * @param {Object} summary - Dashboard summary
 * @returns {Object[]} Tips
 */
function packageTips(summary) {
  const tips = [];
  const packages = summary.packages;

  if (packages && packages.awaitingApproval > 0) {
    tips.push(
      tip({
        id: 'packages-awaiting-approval',
        priority: 8,
        category: 'packages',
        icon: '⏳',
        title: `${counted(packages.awaitingApproval, 'package is', 'packages are')} waiting for approval`,
        body: 'Customers cannot see a package until an admin approves it.',
        type: 'open-packages',
        label: 'View packages',
      })
    );
  }

  const limit = packages?.limit;
  if (Number.isFinite(limit) && limit >= 0 && packages.countedTowardsLimit >= limit) {
    tips.push(
      tip({
        id: 'package-limit',
        priority: 5,
        category: 'plan',
        icon: '📦',
        title: `You have used all ${limit} package ${limit === 1 ? 'place' : 'places'} on your plan`,
        body: 'To list another package, pause one you are not using or move to a plan with a higher limit.',
        type: 'open-plan',
        label: 'See plans',
      })
    );
  }
  return tips;
}

/**
 * Tip for a profile listed under "Other". "Other" is a valid category for the verification form, so
 * the checklist counts the business details as done; browsing by category will not find the
 * supplier though. (A profile with no category at all is the checklist's business-details step.)
 *
 * @param {Object} supplier - Supplier document
 * @returns {Object[]} Tips
 */
function categoryTips(supplier) {
  const category = String(supplier.category || '')
    .trim()
    .toLowerCase();
  if (category !== 'other') {
    return [];
  }
  return [
    tip({
      id: 'choose-category',
      priority: 3.5,
      category: 'profile',
      icon: '🏷️',
      title: 'Choose a specific category',
      body: 'Your profile is listed under "Other", so customers browsing a category will not find you there.',
      type: 'open-profile-editor',
      label: 'Edit profile',
      field: 'category',
    }),
  ];
}

/**
 * Tip about the plan's photo allowance when the gallery is full.
 *
 * @param {Object} supplier - Supplier document
 * @param {Object} summary - Dashboard summary
 * @returns {Object[]} Tips
 */
function photoLimitTips(supplier, summary) {
  const allowed = summary.subscription?.limits ? summary.subscription.limits.maxPhotos : null;
  // Only photos the plan lets them use: the count the upload limit checks.
  const used = countAllowanceGalleryPhotos(supplier);
  if (Number.isFinite(allowed) && allowed >= 0 && used >= allowed) {
    return [
      tip({
        id: 'photo-limit',
        priority: 5,
        category: 'plan',
        icon: '📸',
        title: `Your gallery is full (${used} of ${allowed} photos)`,
        body: 'To add more photos, remove some you no longer need or move to a plan that allows more.',
        type: 'open-plan',
        label: 'See plans',
      }),
    ];
  }
  return [];
}

/**
 * Tip for suppliers who can publish to the public calendar, have used their calendar before, and
 * now have nothing coming up. A supplier who has never added an event is on the checklist's
 * "Add an event to your calendar" step, so is not told twice.
 *
 * @param {Object} summary - Dashboard summary
 * @param {boolean} canPublish - Whether the supplier may publish to the public calendar
 * @param {boolean|null} hasActivity - Whether the calendar has ever had an entry (null = unknown)
 * @returns {Object[]} Tips
 */
function calendarTips(summary, canPublish, hasActivity) {
  // An unreadable calendar reports no events, which is not the same as having none.
  if (Array.isArray(summary.unavailable) && summary.unavailable.includes('calendar')) {
    return [];
  }
  if (
    canPublish &&
    hasActivity === true &&
    Array.isArray(summary.upcoming) &&
    summary.upcoming.length === 0
  ) {
    return [
      tip({
        id: 'publish-event',
        priority: 6,
        category: 'calendar',
        icon: '📅',
        title: 'Add your next event to the public calendar',
        body: 'Your supplier type can publish events to the public calendar. You have added events before, but nothing is coming up there or in your own calendar.',
        type: 'open-calendar',
        label: 'Open calendar',
      }),
    ];
  }
  return [];
}

/**
 * Build the ranked tips for one supplier.
 *
 * @param {Object} params - Inputs
 * @param {Object} params.supplier - Supplier document
 * @param {Object} params.summary - Dashboard summary (buildDashboardSummary)
 * @param {{packageDocs: (Object[]|null), reviewDocs: (Object[]|null), calendarHasActivity: (boolean|null)}} params.raw - Raw records from buildSummaryWithContext
 * @param {boolean} params.canPublishPublicCalendar - Whether the supplier may publish publicly
 * @returns {{tips: Object[], total: number}} At most MAX_TIPS tips, most useful first
 */
function buildTips({ supplier, summary, raw, canPublishPublicCalendar }) {
  const verification = summary.verification;
  const canEdit = verification.emailVerified !== false;
  const approved = verification.approved === true;

  const all = [...accountTips(verification)];
  if (approved) {
    all.push(...customerTips(summary, raw.reviewDocs || []));
  }
  if (canEdit) {
    if (approved && raw.packageDocs) {
      all.push(...packageTips(summary));
    }
    all.push(...categoryTips(supplier));
    all.push(...photoLimitTips(supplier, summary));
  }
  // Publishing to the public calendar needs a verified email, so it is not offered before then.
  if (approved && canEdit) {
    all.push(...calendarTips(summary, canPublishPublicCalendar, raw.calendarHasActivity ?? null));
  }

  all.sort((first, second) => first.priority - second.priority);
  return { tips: all.slice(0, MAX_TIPS), total: all.length };
}

module.exports = { MAX_TIPS, ACTION_TYPES, buildTips };
