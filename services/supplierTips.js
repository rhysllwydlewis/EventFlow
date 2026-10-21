/**
 * Supplier dashboard tips
 *
 * Tips are derived from this supplier's real state, never from generic filler:
 * their category, account status (email, verification, approval), plan and its
 * real limits, profile gaps, reviews, conversations, enquiries and packages.
 * A tip whose data does not exist is simply not produced. Tips contain no
 * statistics or promises about outcomes; numbers in them are the supplier's own
 * (their photo count, their plan's limit, how many enquiries are waiting).
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
const { getSupplierGalleryCount } = require('./supplierProfileCompleteness');
const { isPlaceholderImage } = require('../utils/packageImageUtils');

const MAX_TIPS = 3;

/** The values `action.type` can take. */
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

/** Which kind of business a category is, for category-specific advice. */
const CATEGORY_GROUPS = Object.freeze({
  Venues: 'venue',
  Photography: 'photo',
  Videography: 'photo',
  Catering: 'food',
  Cake: 'food',
  Entertainment: 'music',
  'Music/DJ': 'music',
  Florist: 'styling',
  Decor: 'styling',
  'Event Planner': 'planner',
  Planning: 'planner',
  'Wedding Fayre': 'fayre',
});

const DESCRIPTION_ADVICE = Object.freeze({
  venue:
    'Say how many guests you can hold, what is included in a hire and where guests park or stay.',
  photo: 'Describe your style, how you work on the day and what customers receive afterwards.',
  food: 'Describe your menu style, how many guests you can cater for and which dietary needs you cover.',
  music: 'Say what you perform or play, how long a set runs and what equipment you bring.',
  styling: 'Describe the styles you create and the kinds of event you work on.',
  planner: 'Explain which parts of an event you plan or coordinate.',
  fayre: 'Say where and how often your fayres run and who they are for.',
  general: 'Tell customers what you offer and where you work.',
});

const GALLERY_ADVICE = Object.freeze({
  venue: 'Show the space set up for different kinds of event.',
  photo: 'Show a range of your recent work.',
  food: 'Show real dishes and set-ups from events you have catered.',
  music: 'Show yourself performing at events.',
  styling: 'Show finished arrangements and room set-ups.',
  planner: 'Show events you have planned.',
  fayre: 'Show previous fayres.',
  general: 'Show your work from real events.',
});

const PACKAGE_ADVICE = Object.freeze({
  venue:
    'List each hire option you offer, for example day or evening hire, with what is included and the price.',
  photo: 'Create packages by length of coverage and say what customers receive.',
  food: 'Create packages by menu or service style and say whether pricing is per head or fixed.',
  music: 'Create packages by length of performance and say what equipment is included.',
  styling: 'Create packages by event size or style and say what is included.',
  planner:
    'Create packages for the level of planning you offer, such as full planning or day-of coordination.',
  general: 'Packages show customers what you offer and roughly what it costs.',
});

/**
 * Which advice group a category belongs to.
 *
 * @param {string} category - Supplier category
 * @returns {string} venue | photo | food | music | styling | planner | fayre | general
 */
function categoryGroup(category) {
  return CATEGORY_GROUPS[category] || 'general';
}

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
 * Format an ISO timestamp as a UTC calendar date, e.g. "12 Jul 2026".
 *
 * @param {string|null} iso - Timestamp
 * @returns {string|null} Text, or null when unparseable
 */
function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Tips about the account itself: email, verification, approval, suspension. These
 * come first because nothing else on the dashboard works until they are resolved.
 *
 * @param {Object} verification - summary.verification
 * @returns {Object[]} Tips
 */
function accountTips(verification) {
  if (verification.emailVerified === false) {
    return [
      tip({
        id: 'verify-email',
        priority: 1,
        category: 'account',
        icon: '✉️',
        title: 'Verify your email address',
        body: 'Until your email is verified you cannot edit your profile, upload photos or create packages.',
        type: 'verify-email',
        label: 'Verify email',
      }),
    ];
  }
  if (verification.approved) {
    return [];
  }
  const note = verification.notes ? ` Admin note: ${verification.notes}` : '';
  switch (verification.status) {
    case 'pending_review': {
      const when = shortDate(verification.submittedAt);
      return [
        tip({
          id: 'verification-pending',
          priority: 1,
          category: 'account',
          icon: '⏳',
          title: 'Your profile is waiting for review',
          body: `${when ? `You submitted it on ${when}. ` : ''}An admin is reviewing it and you will be notified. Until it is approved customers cannot see your profile. You can keep improving it meanwhile.`,
          type: 'open-profile-editor',
          label: 'Edit profile',
        }),
      ];
    }
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
      return [
        tip({
          id: 'submit-verification',
          priority: 1,
          category: 'account',
          icon: '✅',
          title: 'Submit your profile for review',
          body: 'Customers cannot see your profile until an admin approves it. Make sure your business name, category, email, phone and location are filled in, then submit it for review.',
          type: 'open-verification',
          label: 'Submit for review',
        }),
      ];
  }
}

/**
 * Tips about customers waiting on the supplier: enquiries, conversations, reviews.
 *
 * @param {Object} summary - Dashboard summary
 * @param {Object[]} reviewDocs - Stored reviews for this supplier
 * @returns {Object[]} Tips
 */
function customerTips(summary, reviewDocs) {
  const tips = [];
  const newRequests =
    summary.enquiries && summary.enquiries.requests && summary.enquiries.requests.new;
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

  const unanswered = summary.responses && summary.responses.unanswered;
  if (unanswered > 0) {
    tips.push(
      tip({
        id: 'unanswered-conversations',
        priority: 3,
        category: 'messages',
        icon: '💬',
        title: `${counted(unanswered, 'conversation', 'conversations')} still need a reply`,
        body: `${counted(unanswered, 'customer started a conversation', 'customers started conversations')} in the last ${summary.window.days} days that is more than a day old and has no reply from you.`,
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
  } else if (summary.reviews && summary.reviews.approvedCount === 0) {
    tips.push(
      tip({
        id: 'first-review',
        priority: 7,
        category: 'reviews',
        icon: '⭐',
        title: 'Ask a past customer for a review',
        body:
          summary.reviews.pendingCount > 0
            ? 'You have no published reviews yet; some are waiting for moderation. You can also invite a past customer to review you.'
            : 'You have no published reviews yet. Invite a past customer to review you.',
        type: 'open-review-request',
        label: 'Request a review',
      })
    );
  }
  return tips;
}

/**
 * Tips about packages and the plan limits that apply to them.
 *
 * @param {Object} supplier - Supplier document
 * @param {Object} summary - Dashboard summary
 * @param {Object[]} packageDocs - Stored packages for this supplier
 * @returns {Object[]} Tips
 */
function packageTips(supplier, summary, packageDocs) {
  const tips = [];
  const group = categoryGroup(supplier.category);
  const packages = summary.packages;

  if (packageDocs.length === 0 && group !== 'fayre') {
    tips.push(
      tip({
        id: 'first-package',
        priority: 5,
        category: 'packages',
        icon: '📦',
        title: 'Create your first package',
        body: PACKAGE_ADVICE[group] || PACKAGE_ADVICE.general,
        type: 'open-package-form',
        label: 'Create package',
      })
    );
  }

  const withoutPhoto = packageDocs.filter(pkg => isPlaceholderImage(pkg.image)).length;
  if (withoutPhoto > 0) {
    tips.push(
      tip({
        id: 'package-photos',
        priority: 5,
        category: 'packages',
        icon: '🖼️',
        title: `${counted(withoutPhoto, 'package has', 'packages have')} no photo`,
        body: 'Each package needs its own photo; the photos on your profile are not used for packages.',
        type: 'open-packages',
        label: 'Add package photos',
        field: 'photos',
      })
    );
  }

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

  const limit = packages && packages.limit;
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
 * Profile-gap tips, category-specific, derived from the same checks as the profile
 * completeness score. Only offered when the supplier can actually edit (verified email).
 *
 * @param {Object} supplier - Supplier document
 * @param {Object} summary - Dashboard summary
 * @returns {Object[]} Tips
 */
function profileTips(supplier, summary) {
  const tips = [];
  const group = categoryGroup(supplier.category);
  const open = new Set(
    summary.profile.completeness.checks.filter(check => !check.done).map(check => check.id)
  );
  const category = String(supplier.category || '')
    .trim()
    .toLowerCase();

  if (category === '' || category === 'other') {
    tips.push(
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
      })
    );
  }

  if (open.has('description')) {
    const length = String(
      supplier.description_long || supplier.description_short || supplier.description || ''
    ).trim().length;
    tips.push(
      tip({
        id: 'write-description',
        priority: 5.5,
        category: 'profile',
        icon: '✍️',
        title: length === 0 ? 'Write a description' : 'Make your description fuller',
        body: `${length === 0 ? 'Your profile has no description.' : `Your description is ${length} characters; the profile checklist asks for at least 100.`} ${DESCRIPTION_ADVICE[group]}`,
        type: 'open-profile-editor',
        label: 'Edit profile',
        field: 'description',
      })
    );
  }

  if (open.has('gallery')) {
    const photos = getSupplierGalleryCount(supplier);
    tips.push(
      tip({
        id: 'add-photos',
        priority: 5.6,
        category: 'profile',
        icon: '📸',
        title: `Add more photos (${photos} of 3)`,
        body: `Your profile checklist asks for at least 3 gallery photos. ${GALLERY_ADVICE[group]}`,
        type: 'open-profile-editor',
        label: 'Add photos',
        field: 'photos',
      })
    );
  }

  if (open.has('logo')) {
    tips.push(
      tip({
        id: 'add-profile-photo',
        priority: 5.7,
        category: 'profile',
        icon: '🙂',
        title: 'Add a profile photo',
        body: 'Your profile does not have a profile photo yet.',
        type: 'open-profile-editor',
        label: 'Add photo',
        field: 'profile-photo',
      })
    );
  }

  if (open.has('location')) {
    tips.push(
      tip({
        id: 'add-location',
        priority: 5.8,
        category: 'profile',
        icon: '📍',
        title: 'Add your location and postcode',
        body: 'Location searches match on your postcode, so a profile without one cannot be found by area.',
        type: 'open-profile-editor',
        label: 'Edit profile',
        field: 'location',
      })
    );
  }

  const remaining = [
    ['coverImage', 'banner', 'Add a banner image', 'Your profile has no banner image.', 'banner'],
    [
      'socials',
      'social-links',
      'Link your social profiles',
      'Your checklist asks for at least 2 social profiles.',
      'social-links',
    ],
    ['website', 'website', 'Add your website', 'Your profile has no website link.', 'website'],
  ];
  remaining.forEach(([check, id, title, body, field], index) => {
    if (open.has(check)) {
      tips.push(
        tip({
          id: `add-${id}`,
          priority: 9 + index,
          category: 'profile',
          icon: '🔗',
          title,
          body,
          type: 'open-profile-editor',
          label: 'Edit profile',
          field,
        })
      );
    }
  });
  return tips;
}

/**
 * Tip about the plan's photo allowance when the gallery is full.
 *
 * @param {Object} supplier - Supplier document
 * @param {Object} summary - Dashboard summary
 * @returns {Object[]} Tips
 */
function photoLimitTips(supplier, summary) {
  const allowed =
    summary.subscription && summary.subscription.limits
      ? summary.subscription.limits.maxPhotos
      : null;
  const used = getSupplierGalleryCount(supplier);
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
 * Tip for suppliers who can publish to the public calendar but have nothing coming up.
 *
 * @param {Object} summary - Dashboard summary
 * @param {boolean} canPublish - Whether the supplier may publish to the public calendar
 * @returns {Object[]} Tips
 */
function calendarTips(summary, canPublish) {
  if (canPublish && Array.isArray(summary.upcoming) && summary.upcoming.length === 0) {
    return [
      tip({
        id: 'publish-event',
        priority: 6,
        category: 'calendar',
        icon: '📅',
        title: 'Add your next event to the public calendar',
        body: 'Your supplier type can publish events to the public calendar, and you have nothing coming up there or in your own calendar.',
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
 * @param {{packageDocs: (Object[]|null), reviewDocs: (Object[]|null)}} params.raw - Raw records from buildSummaryWithContext
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
      all.push(...packageTips(supplier, summary, raw.packageDocs));
    }
    if (summary.profile && summary.profile.completeness) {
      all.push(...profileTips(supplier, summary));
    }
    all.push(...photoLimitTips(supplier, summary));
  }
  if (approved) {
    all.push(...calendarTips(summary, canPublishPublicCalendar));
  }

  all.sort((first, second) => first.priority - second.priority);
  return { tips: all.slice(0, MAX_TIPS), total: all.length };
}

module.exports = { MAX_TIPS, ACTION_TYPES, categoryGroup, buildTips };
