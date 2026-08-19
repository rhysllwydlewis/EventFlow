'use strict';

/**
 * Empty-state SEO index gating (audit finding SEO-005).
 *
 * A handful of pages are entirely inventory-driven: a community category, the
 * "all discussions" index, the public calendar. With zero (or too little)
 * real content behind them they are thin, near-duplicate shells rather than
 * a useful destination, so they must respond 200 with `noindex, follow` and
 * drop out of the sitemap until a real amount of content exists — never a
 * hard block (the page, and its underlying category/location architecture,
 * keeps working for visitors) and never silently indexed.
 *
 * The thresholds and counting logic live in exactly one place so the live
 * routes (which decide the response a request gets) and sitemap.js (which
 * decides sitemap membership) can never disagree about what counts as
 * "empty" — see sitemap.js's own comment on why gating and sitemap output
 * are implemented together.
 */

const { isIndexablePublicEvent } = require('./publicListingSeo.service');

/** States a community discussion must be in to count as real public content. Mirrors PUBLIC_STATES in models/CommunityContent.js minus 'superseded', matching the discussion URLs the sitemap is willing to advertise on their own. */
const PUBLIC_DISCUSSION_STATES = new Set(['published', 'archived']);

/**
 * Minimum published/archived discussions a community category needs before
 * its own page (and the sitemap entry for it) is worth indexing.
 */
const MIN_CATEGORY_DISCUSSIONS_FOR_INDEX = 1;

/**
 * Minimum published/archived discussions the community must hold, in total,
 * before the "all discussions" index page is worth indexing.
 */
const MIN_TOTAL_DISCUSSIONS_FOR_INDEX = 1;

/**
 * Minimum indexable (future, public, published) events the public calendar
 * needs before the calendar hub page itself is worth indexing.
 */
const MIN_CALENDAR_EVENTS_FOR_INDEX = 1;

/**
 * Minimum results a supplier search/filter combination must return before
 * that specific URL is treated as an indexable landing page rather than
 * consolidated (via the page's own static self-canonical) back to the plain
 * `/suppliers` listing.
 */
const MIN_SUPPLIER_RESULTS_FOR_INDEX = 1;

const isPublicDiscussion = discussion =>
  Boolean(discussion) && PUBLIC_DISCUSSION_STATES.has(discussion.state);

/**
 * Count published/archived discussions per category slug.
 * @param {Object[]} discussions Discussion records.
 * @returns {Map<string, number>} Count keyed by categorySlug.
 */
function countDiscussionsByCategory(discussions) {
  const counts = new Map();
  (discussions || []).forEach(discussion => {
    if (!isPublicDiscussion(discussion) || !discussion.categorySlug) {
      return;
    }
    counts.set(discussion.categorySlug, (counts.get(discussion.categorySlug) || 0) + 1);
  });
  return counts;
}

/**
 * Count all published/archived discussions.
 * @param {Object[]} discussions Discussion records.
 * @returns {number} Total public discussion count.
 */
function countPublicDiscussions(discussions) {
  return (discussions || []).filter(isPublicDiscussion).length;
}

/**
 * Count indexable (future, public, published/cancelled) calendar events.
 * @param {Object[]} events Public calendar event records.
 * @param {Date} [now] Clock injection for tests.
 * @returns {number} Indexable event count.
 */
function countIndexableEvents(events, now = new Date()) {
  return (events || []).filter(event => isIndexablePublicEvent(event, now)).length;
}

const communityCategoryIsIndexable = discussionCount =>
  Number(discussionCount) >= MIN_CATEGORY_DISCUSSIONS_FOR_INDEX;

const communityDiscussionsIndexIsIndexable = totalDiscussionCount =>
  Number(totalDiscussionCount) >= MIN_TOTAL_DISCUSSIONS_FOR_INDEX;

const calendarIsIndexable = indexableEventCount =>
  Number(indexableEventCount) >= MIN_CALENDAR_EVENTS_FOR_INDEX;

const supplierFilterResultsAreIndexable = resultCount =>
  Number(resultCount) >= MIN_SUPPLIER_RESULTS_FOR_INDEX;

module.exports = {
  MIN_CATEGORY_DISCUSSIONS_FOR_INDEX,
  MIN_TOTAL_DISCUSSIONS_FOR_INDEX,
  MIN_CALENDAR_EVENTS_FOR_INDEX,
  MIN_SUPPLIER_RESULTS_FOR_INDEX,
  countDiscussionsByCategory,
  countPublicDiscussions,
  countIndexableEvents,
  communityCategoryIsIndexable,
  communityDiscussionsIndexIsIndexable,
  calendarIsIndexable,
  supplierFilterResultsAreIndexable,
};
