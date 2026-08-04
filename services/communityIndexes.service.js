/**
 * EventFlow Community — index bootstrap
 *
 * Idempotent index creation for the community collections. Every index is
 * named explicitly so repeated deploys reconcile rather than duplicate, and the
 * whole routine is safe to run on every boot.
 */

'use strict';

const logger = require('../utils/logger');
const { COLLECTIONS, FRESHNESS } = require('../models/CommunityContent');

let ensurePromise = null;

/**
 * Create every community index on the supplied database handle.
 * @param {Object} db MongoDB database handle.
 * @returns {Promise<void>} Resolves when all indexes exist.
 */
// skipcq: JS-R1005 -- A flat index manifest is easier to audit than nested helpers.
async function createIndexes(db) {
  const categories = db.collection(COLLECTIONS.categories);
  await categories.createIndex({ slug: 1 }, { name: 'uniq_community_category_slug', unique: true });
  await categories.createIndex({ order: 1, visible: 1 }, { name: 'community_category_order' });

  const discussions = db.collection(COLLECTIONS.discussions);
  await discussions.createIndex({ id: 1 }, { name: 'uniq_community_discussion_id', unique: true });
  await discussions.createIndex(
    { stableId: 1 },
    { name: 'uniq_community_discussion_stable_id', unique: true }
  );
  await discussions.createIndex({ slug: 1 }, { name: 'community_discussion_slug' });
  await discussions.createIndex(
    { state: 1, categorySlug: 1, lastActivityAt: -1 },
    { name: 'community_discussion_category_activity' }
  );
  await discussions.createIndex(
    { state: 1, lastActivityAt: -1 },
    { name: 'community_discussion_activity' }
  );
  await discussions.createIndex(
    { state: 1, createdAt: -1 },
    { name: 'community_discussion_created' }
  );
  await discussions.createIndex(
    { authorId: 1, createdAt: -1 },
    { name: 'community_discussion_author' }
  );
  await discussions.createIndex(
    { state: 1, pinned: -1, featured: -1, lastActivityAt: -1 },
    { name: 'community_discussion_pinned' }
  );
  await discussions.createIndex(
    { state: 1, eventType: 1, lastActivityAt: -1 },
    { name: 'community_discussion_event_type' }
  );
  await discussions.createIndex(
    { state: 1, region: 1, lastActivityAt: -1 },
    { name: 'community_discussion_region' }
  );
  await discussions.createIndex(
    { state: 1, replyCount: 1, createdAt: -1 },
    { name: 'community_discussion_unanswered' }
  );
  await discussions.createIndex(
    { title: 'text', searchText: 'text', tags: 'text' },
    { name: 'community_discussion_fulltext', weights: { title: 10, tags: 4, searchText: 1 } }
  );

  const replies = db.collection(COLLECTIONS.replies);
  await replies.createIndex({ id: 1 }, { name: 'uniq_community_reply_id', unique: true });
  await replies.createIndex(
    { discussionId: 1, createdAt: 1 },
    { name: 'community_reply_thread_order' }
  );
  await replies.createIndex({ authorId: 1, createdAt: -1 }, { name: 'community_reply_author' });
  await replies.createIndex({ state: 1, createdAt: -1 }, { name: 'community_reply_state' });
  await replies.createIndex(
    { fingerprint: 1, authorId: 1 },
    {
      name: 'community_reply_fingerprint',
      partialFilterExpression: { fingerprint: { $type: 'string' } },
    }
  );

  const reactions = db.collection(COLLECTIONS.reactions);
  await reactions.createIndex(
    { targetId: 1, userId: 1, reaction: 1 },
    { name: 'uniq_community_reaction', unique: true }
  );
  await reactions.createIndex({ targetId: 1 }, { name: 'community_reaction_target' });

  const bookmarks = db.collection(COLLECTIONS.bookmarks);
  await bookmarks.createIndex(
    { userId: 1, discussionId: 1 },
    { name: 'uniq_community_bookmark', unique: true }
  );
  await bookmarks.createIndex({ userId: 1, createdAt: -1 }, { name: 'community_bookmark_user' });

  const follows = db.collection(COLLECTIONS.follows);
  await follows.createIndex(
    { userId: 1, targetType: 1, targetId: 1 },
    { name: 'uniq_community_follow', unique: true }
  );
  await follows.createIndex({ targetType: 1, targetId: 1 }, { name: 'community_follow_target' });

  const reports = db.collection(COLLECTIONS.reports);
  await reports.createIndex({ id: 1 }, { name: 'uniq_community_report_id', unique: true });
  await reports.createIndex(
    { status: 1, priority: 1, createdAt: 1 },
    { name: 'community_report_queue' }
  );
  await reports.createIndex({ targetId: 1, reporterId: 1 }, { name: 'community_report_dedupe' });
  await reports.createIndex(
    { reportedUserId: 1, createdAt: -1 },
    {
      name: 'community_report_account',
      partialFilterExpression: { reportedUserId: { $type: 'string' } },
    }
  );

  const moderationActions = db.collection(COLLECTIONS.moderationActions);
  await moderationActions.createIndex(
    { id: 1 },
    { name: 'uniq_community_moderation_action_id', unique: true }
  );
  await moderationActions.createIndex(
    { targetId: 1, createdAt: -1 },
    { name: 'community_moderation_target' }
  );
  await moderationActions.createIndex(
    { moderatorId: 1, createdAt: -1 },
    { name: 'community_moderation_actor' }
  );

  const appeals = db.collection(COLLECTIONS.appeals);
  await appeals.createIndex({ id: 1 }, { name: 'uniq_community_appeal_id', unique: true });
  await appeals.createIndex({ status: 1, createdAt: 1 }, { name: 'community_appeal_queue' });
  await appeals.createIndex({ userId: 1, createdAt: -1 }, { name: 'community_appeal_user' });

  const userStats = db.collection(COLLECTIONS.userStats);
  await userStats.createIndex({ userId: 1 }, { name: 'uniq_community_user_stats', unique: true });
  await userStats.createIndex({ helpfulAnswers: -1 }, { name: 'community_user_stats_helpful' });

  const views = db.collection(COLLECTIONS.views);
  await views.createIndex(
    { discussionId: 1, viewerKey: 1 },
    { name: 'uniq_community_view', unique: true }
  );
  // The dedupe record expires with the window, so no long-lived viewer identifier
  // is retained. See docs/compliance/community-dpia.md.
  await views.createIndex({ expiresAt: 1 }, { name: 'community_view_ttl', expireAfterSeconds: 0 });

  const drafts = db.collection(COLLECTIONS.drafts);
  await drafts.createIndex({ id: 1 }, { name: 'uniq_community_draft_id', unique: true });
  await drafts.createIndex({ userId: 1, updatedAt: -1 }, { name: 'community_draft_user' });

  const settings = db.collection(COLLECTIONS.settings);
  await settings.createIndex({ id: 1 }, { name: 'uniq_community_settings', unique: true });

  const pollVotes = db.collection(COLLECTIONS.pollVotes);
  await pollVotes.createIndex(
    { discussionId: 1, userId: 1 },
    { name: 'uniq_community_poll_vote', unique: true }
  );

  const canonicalLinks = db.collection(COLLECTIONS.canonicalLinks);
  await canonicalLinks.createIndex(
    { fromDiscussionId: 1 },
    { name: 'uniq_community_canonical_from', unique: true }
  );
  await canonicalLinks.createIndex({ toDiscussionId: 1 }, { name: 'community_canonical_to' });

  const restrictions = db.collection(COLLECTIONS.restrictions);
  await restrictions.createIndex(
    { id: 1 },
    { name: 'uniq_community_restriction_id', unique: true }
  );
  await restrictions.createIndex({ userId: 1, active: 1 }, { name: 'community_restriction_user' });
  await restrictions.createIndex(
    { expiresAt: 1 },
    {
      name: 'community_restriction_expiry',
      partialFilterExpression: { expiresAt: { $type: 'date' } },
    }
  );
}

/**
 * Ensure all community indexes exist. Safe to call repeatedly; the work runs
 * at most once per process unless it fails.
 * @returns {Promise<boolean>} True once indexes are in place.
 */
function ensureIndexes() {
  if (ensurePromise) {
    return ensurePromise;
  }
  ensurePromise = (async () => {
    const { getDb } = require('../db');
    const db = await getDb();
    await createIndexes(db);
    logger.info('[COMMUNITY] Community indexes ensured');
    return true;
  })().catch(error => {
    ensurePromise = null;
    logger.warn('[COMMUNITY] Community index initialisation failed', { error: error.message });
    throw error;
  });
  return ensurePromise;
}

/** Reset memoised state between tests. */
function resetForTests() {
  ensurePromise = null;
}

module.exports = {
  ensureIndexes,
  VIEW_DEDUPE_HOURS: FRESHNESS.VIEW_DEDUPE_HOURS,
  _test: { createIndexes, resetForTests },
};
