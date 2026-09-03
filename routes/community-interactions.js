/**
 * EventFlow Community — replies, reactions and moderation entry points
 *
 * Everything a member does to an existing post lives here: replying, quoting,
 * reacting, saving, following, marking helpful and official answers, voting in
 * polls and reporting content.
 */

'use strict';

const express = require('express');
const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const {
  authRequired,
  userExtractionMiddleware,
  requireVerifiedUser,
} = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, publicReadLimiter } = require('../middleware/rateLimits');
const {
  requireCommunityEnabled,
  attachViewer,
  requireAdultDeclaration,
  requirePostingRights,
} = require('../middleware/community');
const community = require('../services/community.service');
const moderation = require('../services/communityModeration.service');
const { stripHtml } = require('../services/contentSanitizer');
const {
  COLLECTIONS,
  CONTENT_STATES,
  COUNTABLE_STATES,
  REACTIONS,
  REACTION_KEYS,
  REPORT_REASONS,
  REPORT_REASON_KEYS,
  ESCALATION_REASONS,
  LIMITS,
} = require('../models/CommunityContent');

router.use(userExtractionMiddleware, attachViewer);

const REACTION_BY_KEY = new Map(REACTIONS.map(item => [item.key, item]));
const REPORT_BY_KEY = new Map(REPORT_REASONS.map(item => [item.key, item]));

/**
 * Load a discussion by its immutable public identifier.
 * @param {string} stableId Stable identifier.
 * @returns {Promise<Object|null>} Discussion or null.
 */
function findDiscussion(stableId) {
  const value = String(stableId || '').trim();
  if (!/^[a-f0-9]{6,32}$/i.test(value)) {
    return null;
  }
  return dbUnified.findOne(COLLECTIONS.discussions, { stableId: value });
}

/**
 * Notify the people who asked to hear about activity on a discussion, without
 * notifying the person who caused it and without leaking withdrawn content.
 * @param {Object} input Notification context.
 * @returns {Promise<void>} Resolves when notifications are queued.
 */
async function notifyDiscussionFollowers(input) {
  const { discussion, reply, actorId } = input;
  try {
    const follows =
      (await dbUnified.find(COLLECTIONS.follows, {
        targetType: 'discussion',
        targetId: discussion.id,
      })) || [];

    const recipients = new Set(follows.map(item => item.userId));
    recipients.add(discussion.authorId);
    recipients.delete(actorId);

    const blocked = new Set();
    await Promise.all(
      Array.from(recipients).map(async userId => {
        const block = await dbUnified.findOne(COLLECTIONS.restrictions, {
          userId,
          type: 'muted_discussion',
          targetId: discussion.id,
          active: true,
        });
        if (block) {
          blocked.add(userId);
        }
      })
    );

    await Promise.all(
      Array.from(recipients)
        .filter(userId => !blocked.has(userId))
        .map(userId =>
          community.createNotification({
            // Deterministic id so a retry cannot double-notify.
            id: `cnotif_reply_${reply.id}_${userId}`,
            userId,
            type: 'community_reply',
            title: `New reply: ${discussion.title}`,
            message: community.buildExcerpt(reply.bodyText, 120),
            actionUrl: `${community.discussionPath(discussion)}#reply-${reply.id}`,
            icon: '💬',
            metadata: { discussionId: discussion.stableId, replyId: reply.id },
          })
        )
    );
  } catch (error) {
    logger.warn('Could not notify community followers:', error.message);
  }
}

// ─── Replies ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/community/discussions/:stableId/replies
 * Reply to a discussion, optionally quoting an existing reply.
 */
// skipcq: JS-R1005 -- Reply creation is one ordered pipeline: guard, moderate, persist, notify.
router.post(
  '/discussions/:stableId/replies',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  requireAdultDeclaration,
  requirePostingRights,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion || !community.canView(discussion, req.viewer)) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      if (discussion.locked) {
        return res.status(409).json({
          error: 'Discussion locked',
          message:
            'This discussion is locked. Start a new discussion to carry on the conversation.',
        });
      }
      if (discussion.state === CONTENT_STATES.ARCHIVED) {
        return res.status(409).json({
          error: 'Discussion archived',
          message:
            'This discussion has been archived because it is no longer current. Start a new discussion instead.',
        });
      }

      const settings = await community.getSettings();
      const context = req.viewer;
      const prepared = moderation.prepareBody(req.body.body, {
        clickable: moderation.policyFor(context.trustTier).linksClickable,
        settings,
        isReply: true,
      });

      const lengthCheck = moderation.validateLength({ text: prepared.text, isReply: true });
      if (!lengthCheck.valid) {
        return res.status(400).json({ error: 'Validation failed', details: lengthCheck.errors });
      }

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentReplies = await dbUnified.find(COLLECTIONS.replies, {
        authorId: req.user.id,
        createdAt: { $gte: hourAgo },
      });
      if ((recentReplies || []).length >= Number(settings.maxRepliesPerHour || 30)) {
        return res.status(429).json({
          error: 'Rate limit reached',
          message: 'Please slow down and try again shortly.',
        });
      }

      const verdict = moderation.assessContent({
        text: prepared.text,
        trustTier: context.trustTier,
        settings,
        thread: discussion,
        recentPosts: await community.recentPostsFor(req.user.id),
      });

      if (verdict.decision === 'reject') {
        await community.recordModerationAction({
          action: 'quarantine',
          targetType: 'reply',
          targetId: 'rejected',
          reason: 'automated_block',
          signals: verdict.signals,
        });
        return res.status(422).json({
          error: 'Reply blocked',
          code: 'CONTENT_BLOCKED',
          message:
            'This reply links to a domain that is not allowed in the community. Remove the link and try again.',
        });
      }

      let quotedReplyId = null;
      let quotedExcerpt = null;
      if (req.body.quotedReplyId) {
        const quoted = await dbUnified.findOne(COLLECTIONS.replies, {
          id: String(req.body.quotedReplyId),
        });
        if (
          quoted &&
          quoted.discussionId === discussion.id &&
          COUNTABLE_STATES.includes(quoted.state)
        ) {
          quotedReplyId = quoted.id;
          quotedExcerpt = community.buildExcerpt(quoted.bodyText, 180);
        }
      }

      const author = await community.buildAuthorCard(req.dbUser, context);
      const now = new Date().toISOString();
      const mentions = await community.resolveMentions(prepared.text, {
        excludeUserId: req.user.id,
      });

      // A supplier replying in a thread that names their own business must be
      // disclosed. The disclosure is derived from authoritative supplier data,
      // never from anything the supplier types.
      let supplierDisclosure = null;
      if (author.isSupplier) {
        const mentionsOwnBusiness =
          author.supplierId &&
          (prepared.text.toLowerCase().includes(String(author.displayName || '').toLowerCase()) ||
            String(req.body.selfRecommendation || '') === 'true');
        supplierDisclosure = {
          supplierId: author.supplierId,
          category: author.supplierCategory,
          approved: author.supplierApproved,
          selfRecommendation: Boolean(mentionsOwnBusiness),
          label: mentionsOwnBusiness
            ? 'This supplier is recommending their own business'
            : 'Reply from an EventFlow supplier',
        };
      }

      const reply = {
        id: community.createRecordId('crep'),
        discussionId: discussion.id,
        discussionStableId: discussion.stableId,
        authorId: req.user.id,
        author,
        authorTrustTier: context.trustTier,
        bodyHtml: prepared.html,
        bodyText: prepared.text,
        mentions,
        fingerprint: moderation.fingerprint(prepared.text),
        quotedReplyId,
        quotedExcerpt,
        reactionCounts: {},
        isHelpfulAnswer: false,
        isOfficialAnswer: false,
        supplierDisclosure,
        state: verdict.state,
        createdAt: now,
        updatedAt: now,
        editedAt: null,
        riskScore: verdict.score,
        riskSignals: verdict.signals,
        moderation: { autoDecision: verdict.decision, decidedAt: now },
      };

      await dbUnified.insertOne(COLLECTIONS.replies, reply);
      await community.bumpUserStats(req.user.id, { replies: 1 }, { lastPostAt: now });
      await community.recalculateDiscussionCounters(discussion.id);

      if (verdict.decision === 'review') {
        await community.recordModerationAction({
          action: 'quarantine',
          targetType: 'reply',
          targetId: reply.id,
          reason: 'automated_review',
          signals: verdict.signals,
        });
      } else {
        await notifyDiscussionFollowers({ discussion, reply, actorId: req.user.id });
        if (mentions.length > 0) {
          await community.notifyMentionedUsers({
            mentions,
            postId: reply.id,
            title: discussion.title,
            actionUrl: `${community.discussionPath(discussion)}#reply-${reply.id}`,
            mentionedByName: author.displayName,
          });
        }
      }

      res.status(201).json({
        reply: community.toReplyView(reply, { viewerId: req.user.id }),
        pendingReview: verdict.decision === 'review',
        message:
          verdict.decision === 'review'
            ? 'Your reply has been sent for a quick moderator check before it appears publicly.'
            : 'Your reply has been posted.',
      });
    } catch (error) {
      logger.error('Could not create community reply:', error);
      res.status(500).json({ error: 'Could not post reply' });
    }
  }
);

/**
 * PATCH /api/v1/community/replies/:id
 * Edit your own reply.
 */
router.patch(
  '/replies/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const reply = await dbUnified.findOne(COLLECTIONS.replies, { id: req.params.id });
      if (!reply) {
        return res.status(404).json({ error: 'Reply not found' });
      }
      if (reply.authorId !== req.user.id) {
        return res.status(403).json({ error: 'You can only edit your own replies.' });
      }
      if (reply.state === CONTENT_STATES.REMOVED) {
        return res.status(409).json({ error: 'This reply can no longer be edited.' });
      }

      const settings = await community.getSettings();
      const prepared = moderation.prepareBody(req.body.body, {
        clickable: moderation.policyFor(req.viewer.trustTier).linksClickable,
        settings,
        isReply: true,
      });
      const check = moderation.validateLength({ text: prepared.text, isReply: true });
      if (!check.valid) {
        return res.status(400).json({ error: 'Validation failed', details: check.errors });
      }

      // Re-assess on edit, for the same reason discussions do: a reply that is
      // already public must not become a vector by being edited afterwards.
      const discussion = await dbUnified.findOne(COLLECTIONS.discussions, {
        id: reply.discussionId,
      });
      const verdict = moderation.assessContent({
        text: prepared.text,
        trustTier: req.viewer.trustTier,
        settings,
        thread: discussion,
        recentPosts: await community.recentPostsFor(req.user.id),
      });

      if (verdict.decision === 'reject') {
        await community.recordModerationAction({
          action: 'quarantine',
          targetType: 'reply',
          targetId: reply.id,
          reason: 'automated_block_on_edit',
          signals: verdict.signals,
        });
        return res.status(422).json({
          error: 'Edit blocked',
          code: 'CONTENT_BLOCKED',
          message:
            'This edit links to a domain that is not allowed in the community. Remove the link and try again.',
        });
      }

      const now = new Date().toISOString();
      const update = {
        bodyHtml: prepared.html,
        bodyText: prepared.text,
        fingerprint: moderation.fingerprint(prepared.text),
        editedAt: now,
        updatedAt: now,
        riskScore: verdict.score,
        riskSignals: verdict.signals,
      };

      if (verdict.decision === 'review' && reply.state === CONTENT_STATES.PUBLISHED) {
        update.state = CONTENT_STATES.QUARANTINED;
      }

      await dbUnified.updateOne(COLLECTIONS.replies, { id: reply.id }, { $set: update });

      if (update.state === CONTENT_STATES.QUARANTINED) {
        await community.recalculateDiscussionCounters(reply.discussionId);
        await community.recordModerationAction({
          action: 'quarantine',
          targetType: 'reply',
          targetId: reply.id,
          reason: 'automated_review_on_edit',
          signals: verdict.signals,
        });
      }

      const updated = await dbUnified.findOne(COLLECTIONS.replies, { id: reply.id });
      res.json({
        reply: community.toReplyView(updated, { viewerId: req.user.id }),
        pendingReview: update.state === CONTENT_STATES.QUARANTINED,
      });
    } catch (error) {
      logger.error('Could not update community reply:', error);
      res.status(500).json({ error: 'Could not update reply' });
    }
  }
);

/**
 * DELETE /api/v1/community/replies/:id
 * Withdraw your own reply. Soft deletion keeps the conversation readable and
 * preserves the record for moderation and legal retention.
 */
router.delete(
  '/replies/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const reply = await dbUnified.findOne(COLLECTIONS.replies, { id: req.params.id });
      if (!reply) {
        return res.status(404).json({ error: 'Reply not found' });
      }
      const asModerator = community.isModerator(req.viewer.user || {});
      if (reply.authorId !== req.user.id && !asModerator) {
        return res.status(403).json({ error: 'You can only withdraw your own replies.' });
      }

      await dbUnified.updateOne(
        COLLECTIONS.replies,
        { id: reply.id },
        {
          $set: {
            state: CONTENT_STATES.REMOVED,
            moderationPublicReason:
              reply.authorId === req.user.id ? 'Withdrawn by the author' : 'Removed by moderators',
            removedAt: new Date().toISOString(),
          },
        }
      );
      await community.recalculateDiscussionCounters(reply.discussionId);
      await community.recordModerationAction({
        action: 'remove',
        targetType: 'reply',
        targetId: reply.id,
        moderatorId: req.user.id,
        reason: reply.authorId === req.user.id ? 'author_withdrawal' : 'moderator_removal',
      });
      res.json({ removed: true });
    } catch (error) {
      logger.error('Could not remove community reply:', error);
      res.status(500).json({ error: 'Could not remove reply' });
    }
  }
);

// ─── Reactions ───────────────────────────────────────────────────────────────

/**
 * Recount reactions on a post and persist the totals.
 * @param {string} targetId Reply id.
 * @returns {Promise<Object>} Reaction counts.
 */
async function recountReactions(targetId) {
  const reactions = (await dbUnified.find(COLLECTIONS.reactions, { targetId })) || [];
  // Null prototype, and only reactions from the published vocabulary are
  // counted, so a stored value can never write a prototype member.
  const counts = Object.create(null);
  reactions.forEach(item => {
    if (!REACTION_KEYS.includes(item.reaction)) {
      return;
    }
    counts[item.reaction] = (counts[item.reaction] || 0) + 1;
  });
  await dbUnified.updateOne(
    COLLECTIONS.replies,
    { id: targetId },
    { $set: { reactionCounts: counts } }
  );
  return counts;
}

/**
 * POST /api/v1/community/posts/:id/reactions
 * Add a reaction to a reply. One reaction of each kind per member.
 */
router.post(
  '/posts/:id/reactions',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  requirePostingRights,
  csrfProtection,
  async (req, res) => {
    try {
      const reaction = String(req.body.reaction || '').trim();
      if (!REACTION_KEYS.includes(reaction)) {
        return res.status(400).json({ error: 'Unknown reaction' });
      }
      const reply = await dbUnified.findOne(COLLECTIONS.replies, { id: req.params.id });
      if (!reply || !COUNTABLE_STATES.includes(reply.state)) {
        return res.status(404).json({ error: 'Post not found' });
      }
      if (reply.authorId === req.user.id) {
        return res.status(400).json({ error: 'You cannot react to your own post.' });
      }

      const existing = await dbUnified.findOne(COLLECTIONS.reactions, {
        targetId: reply.id,
        userId: req.user.id,
        reaction,
      });
      if (!existing) {
        await dbUnified.insertOne(COLLECTIONS.reactions, {
          id: community.createRecordId('creact'),
          targetId: reply.id,
          targetType: 'reply',
          discussionId: reply.discussionId,
          userId: req.user.id,
          reaction,
          createdAt: new Date().toISOString(),
        });

        const definition = REACTION_BY_KEY.get(reaction);
        if (definition && definition.countsTowardsReputation) {
          await community.bumpUserStats(reply.authorId, { helpfulVotesReceived: 1 });
        }
      }

      const counts = await recountReactions(reply.id);
      await community.recalculateDiscussionCounters(reply.discussionId);
      res.json({ reactions: counts, mine: reaction });
    } catch (error) {
      logger.error('Could not add community reaction:', error);
      res.status(500).json({ error: 'Could not add reaction' });
    }
  }
);

/**
 * DELETE /api/v1/community/posts/:id/reactions/:reaction
 * Remove one of your reactions.
 */
router.delete(
  '/posts/:id/reactions/:reaction',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const reaction = String(req.params.reaction || '').trim();
      if (!REACTION_KEYS.includes(reaction)) {
        return res.status(400).json({ error: 'Unknown reaction' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.reactions, {
        targetId: req.params.id,
        userId: req.user.id,
        reaction,
      });
      if (existing) {
        await dbUnified.deleteOne(COLLECTIONS.reactions, { id: existing.id });
      }
      const counts = await recountReactions(req.params.id);
      res.json({ reactions: counts, mine: null });
    } catch (error) {
      logger.error('Could not remove community reaction:', error);
      res.status(500).json({ error: 'Could not remove reaction' });
    }
  }
);

// ─── Saves and follows ───────────────────────────────────────────────────────

/**
 * POST /api/v1/community/discussions/:stableId/save
 * Save a discussion to your reading list.
 */
router.post(
  '/discussions/:stableId/save',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion || !community.canView(discussion, req.viewer)) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.bookmarks, {
        userId: req.user.id,
        discussionId: discussion.id,
      });
      if (!existing) {
        await dbUnified.insertOne(COLLECTIONS.bookmarks, {
          id: community.createRecordId('cbook'),
          userId: req.user.id,
          discussionId: discussion.id,
          createdAt: new Date().toISOString(),
        });
        await dbUnified.updateOne(
          COLLECTIONS.discussions,
          { id: discussion.id },
          { $inc: { saveCount: 1 } }
        );
      }
      res.json({ saved: true });
    } catch (error) {
      logger.error('Could not save community discussion:', error);
      res.status(500).json({ error: 'Could not save discussion' });
    }
  }
);

/**
 * DELETE /api/v1/community/discussions/:stableId/save
 * Remove a discussion from your reading list.
 */
router.delete(
  '/discussions/:stableId/save',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.bookmarks, {
        userId: req.user.id,
        discussionId: discussion.id,
      });
      if (existing) {
        await dbUnified.deleteOne(COLLECTIONS.bookmarks, { id: existing.id });
        await dbUnified.updateOne(
          COLLECTIONS.discussions,
          { id: discussion.id },
          { $inc: { saveCount: -1 } }
        );
      }
      res.json({ saved: false });
    } catch (error) {
      logger.error('Could not unsave community discussion:', error);
      res.status(500).json({ error: 'Could not update saved discussions' });
    }
  }
);

/**
 * POST /api/v1/community/discussions/:stableId/follow
 * Follow a discussion for reply notifications.
 */
router.post(
  '/discussions/:stableId/follow',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion || !community.canView(discussion, req.viewer)) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.follows, {
        userId: req.user.id,
        targetType: 'discussion',
        targetId: discussion.id,
      });
      if (!existing) {
        await dbUnified.insertOne(COLLECTIONS.follows, {
          id: community.createRecordId('cfollow'),
          userId: req.user.id,
          targetType: 'discussion',
          targetId: discussion.id,
          createdAt: new Date().toISOString(),
        });
      }
      res.json({ following: true });
    } catch (error) {
      logger.error('Could not follow community discussion:', error);
      res.status(500).json({ error: 'Could not follow discussion' });
    }
  }
);

/**
 * DELETE /api/v1/community/discussions/:stableId/follow
 * Stop following a discussion.
 */
router.delete(
  '/discussions/:stableId/follow',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.follows, {
        userId: req.user.id,
        targetType: 'discussion',
        targetId: discussion.id,
      });
      if (existing) {
        await dbUnified.deleteOne(COLLECTIONS.follows, { id: existing.id });
      }
      res.json({ following: false });
    } catch (error) {
      logger.error('Could not unfollow community discussion:', error);
      res.status(500).json({ error: 'Could not unfollow discussion' });
    }
  }
);

// ─── Answers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/community/discussions/:stableId/solve
 * Mark a reply as the helpful answer. Only the person who asked, or a
 * moderator, can do this — and it is separate from an official answer.
 */
router.post(
  '/discussions/:stableId/solve',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const asModerator = community.isModerator(req.viewer.user || {});
      if (discussion.authorId !== req.user.id && !asModerator) {
        return res.status(403).json({
          error: 'Only the person who started this discussion can mark a helpful answer.',
        });
      }

      const replyId = req.body.replyId ? String(req.body.replyId) : null;
      if (replyId) {
        const reply = await dbUnified.findOne(COLLECTIONS.replies, { id: replyId });
        if (
          !reply ||
          reply.discussionId !== discussion.id ||
          !COUNTABLE_STATES.includes(reply.state)
        ) {
          return res.status(400).json({ error: 'That reply cannot be marked as the answer.' });
        }
        if (discussion.helpfulAnswerId && discussion.helpfulAnswerId !== replyId) {
          await dbUnified.updateOne(
            COLLECTIONS.replies,
            { id: discussion.helpfulAnswerId },
            { $set: { isHelpfulAnswer: false } }
          );
        }
        await dbUnified.updateOne(
          COLLECTIONS.replies,
          { id: replyId },
          { $set: { isHelpfulAnswer: true } }
        );
        await community.bumpUserStats(reply.authorId, { helpfulAnswers: 1 });
        await dbUnified.updateOne(
          COLLECTIONS.discussions,
          { id: discussion.id },
          { $set: { helpfulAnswerId: replyId, solvedAt: new Date().toISOString() } }
        );
        return res.json({ solved: true, helpfulAnswerId: replyId });
      }

      if (discussion.helpfulAnswerId) {
        await dbUnified.updateOne(
          COLLECTIONS.replies,
          { id: discussion.helpfulAnswerId },
          { $set: { isHelpfulAnswer: false } }
        );
      }
      await dbUnified.updateOne(
        COLLECTIONS.discussions,
        { id: discussion.id },
        { $set: { helpfulAnswerId: null, solvedAt: null } }
      );
      res.json({ solved: false, helpfulAnswerId: null });
    } catch (error) {
      logger.error('Could not update helpful answer:', error);
      res.status(500).json({ error: 'Could not update the helpful answer' });
    }
  }
);

/**
 * POST /api/v1/community/discussions/:stableId/official-answer
 * Mark a reply as an official EventFlow answer. Staff only, and recorded with a
 * "last verified" date so readers can judge whether it is still current.
 */
router.post(
  '/discussions/:stableId/official-answer',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      if (!community.isModerator(req.viewer.user || {})) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only the EventFlow team can mark official answers.',
        });
      }
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const reply = await dbUnified.findOne(COLLECTIONS.replies, {
        id: String(req.body.replyId || ''),
      });
      if (!reply || reply.discussionId !== discussion.id) {
        return res.status(400).json({ error: 'That reply is not part of this discussion.' });
      }

      const official = req.body.official !== false;
      const now = new Date().toISOString();
      await dbUnified.updateOne(
        COLLECTIONS.replies,
        { id: reply.id },
        {
          $set: {
            isOfficialAnswer: official,
            officialAnswerVerifiedAt: official ? now : null,
            officialAnswerBy: official ? req.user.id : null,
          },
        }
      );
      if (official) {
        await community.bumpUserStats(reply.authorId, { officialAnswers: 1 });
      }
      await community.recalculateDiscussionCounters(discussion.id);
      await community.recordModerationAction({
        action: official ? 'approve' : 'restore',
        targetType: 'reply',
        targetId: reply.id,
        moderatorId: req.user.id,
        reason: official ? 'official_answer_marked' : 'official_answer_cleared',
      });

      await community.createNotification({
        id: `cnotif_official_${reply.id}`,
        userId: discussion.authorId,
        type: 'community_official_answer',
        title: 'An official EventFlow answer has been added',
        message: discussion.title,
        actionUrl: `${community.discussionPath(discussion)}#reply-${reply.id}`,
        icon: '✅',
      });

      res.json({ officialAnswer: official, verifiedAt: official ? now : null });
    } catch (error) {
      logger.error('Could not update official answer:', error);
      res.status(500).json({ error: 'Could not update the official answer' });
    }
  }
);

// ─── Polls ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/community/discussions/:stableId/poll-vote
 * Cast a single vote in a discussion poll.
 */
router.post(
  '/discussions/:stableId/poll-vote',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await findDiscussion(req.params.stableId);
      if (!discussion || !discussion.poll) {
        return res.status(404).json({ error: 'Poll not found' });
      }
      const optionId = String(req.body.optionId || '');
      const option = discussion.poll.options.find(item => item.id === optionId);
      if (!option) {
        return res.status(400).json({ error: 'Unknown poll option' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.pollVotes, {
        discussionId: discussion.id,
        userId: req.user.id,
      });
      if (existing) {
        return res.status(409).json({ error: 'You have already voted in this poll.' });
      }

      await dbUnified.insertOne(COLLECTIONS.pollVotes, {
        id: community.createRecordId('cpoll'),
        discussionId: discussion.id,
        userId: req.user.id,
        optionId,
        createdAt: new Date().toISOString(),
      });

      const votes =
        (await dbUnified.find(COLLECTIONS.pollVotes, { discussionId: discussion.id })) || [];
      const poll = {
        ...discussion.poll,
        options: discussion.poll.options.map(item => ({
          ...item,
          votes: votes.filter(vote => vote.optionId === item.id).length,
        })),
        totalVotes: votes.length,
      };
      await dbUnified.updateOne(COLLECTIONS.discussions, { id: discussion.id }, { $set: { poll } });
      res.json({ poll, myVote: optionId });
    } catch (error) {
      logger.error('Could not record poll vote:', error);
      res.status(500).json({ error: 'Could not record your vote' });
    }
  }
);

// ─── Reports ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/community/posts/:id/report
 * Report a discussion or reply. Reporting is available from every post and does
 * not require the reporter to be signed in for illegal-content reports.
 */
// skipcq: JS-R1005 -- Report intake validates, de-duplicates, prioritises and escalates in order.
router.post(
  '/posts/:id/report',
  writeLimiter,
  requireCommunityEnabled,
  csrfProtection,
  async (req, res) => {
    try {
      const reason = String(req.body.reason || '').trim();
      if (!REPORT_REASON_KEYS.includes(reason)) {
        return res.status(400).json({ error: 'Choose a reason for your report.' });
      }
      const detail = stripHtml(String(req.body.detail || ''))
        .trim()
        .slice(0, LIMITS.REPORT_DETAIL_MAX);

      const targetId = String(req.params.id || '');
      const reply = await dbUnified.findOne(COLLECTIONS.replies, { id: targetId });
      const discussion = reply
        ? await dbUnified.findOne(COLLECTIONS.discussions, { id: reply.discussionId })
        : await dbUnified.findOne(COLLECTIONS.discussions, { stableId: targetId });

      if (!reply && !discussion) {
        return res.status(404).json({ error: 'Content not found' });
      }

      const target = reply || discussion;
      const reporterId = req.user ? req.user.id : null;

      if (reporterId) {
        const duplicate = await dbUnified.findOne(COLLECTIONS.reports, {
          targetId: target.id,
          reporterId,
        });
        if (duplicate) {
          return res.json({
            reported: true,
            reportId: duplicate.id,
            message: 'You have already reported this. Our moderators are reviewing it.',
          });
        }
      }

      const definition = REPORT_BY_KEY.get(reason);
      const escalate = ESCALATION_REASONS.includes(reason);
      const report = {
        id: community.createRecordId('crept'),
        targetType: reply ? 'reply' : 'discussion',
        targetId: target.id,
        discussionId: discussion ? discussion.id : null,
        discussionStableId: discussion ? discussion.stableId : null,
        reportedUserId: target.authorId || null,
        reporterId,
        reason,
        reasonLabel: definition ? definition.label : reason,
        detail,
        priority: definition ? definition.priority : 'normal',
        status: escalate ? 'escalated' : 'open',
        assignedTo: null,
        // A snapshot means a decision can still be reviewed after the author edits.
        snapshot: {
          title: discussion ? discussion.title : null,
          body: community.buildExcerpt(target.bodyText, 800),
          capturedAt: new Date().toISOString(),
        },
        decision: null,
        decisionReason: null,
        actionTaken: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolvedAt: null,
      };

      await dbUnified.insertOne(COLLECTIONS.reports, report);

      // Serious categories are quarantined pending human review rather than left
      // in public while the queue is worked through.
      if (escalate) {
        const collection = reply ? COLLECTIONS.replies : COLLECTIONS.discussions;
        await dbUnified.updateOne(
          collection,
          { id: target.id },
          { $set: { state: CONTENT_STATES.QUARANTINED } }
        );
        if (reply) {
          await community.recalculateDiscussionCounters(reply.discussionId);
        }
        await community.recordModerationAction({
          action: 'quarantine',
          targetType: report.targetType,
          targetId: target.id,
          reason: `escalated_report:${reason}`,
        });
      }

      res.status(201).json({
        reported: true,
        reportId: report.id,
        escalated: escalate,
        message: escalate
          ? 'Thank you. This content has been hidden while a senior moderator reviews it.'
          : 'Thank you. A moderator will review this report.',
      });
    } catch (error) {
      logger.error('Could not record community report:', error);
      res.status(500).json({ error: 'Could not submit report' });
    }
  }
);

/**
 * POST /api/v1/community/reports/bulk
 * Report a whole series of posts from one account in a single action, so a
 * member does not have to report a spam run one post at a time.
 */
router.post(
  '/reports/bulk',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const reason = String(req.body.reason || 'spam').trim();
      if (!REPORT_REASON_KEYS.includes(reason)) {
        return res.status(400).json({ error: 'Choose a reason for your report.' });
      }
      const handle = String(req.body.handle || '').trim();
      if (!handle) {
        return res.status(400).json({ error: 'Tell us which account you are reporting.' });
      }

      const [replies, discussions] = await Promise.all([
        dbUnified.find(COLLECTIONS.replies, { 'author.handle': handle }),
        dbUnified.find(COLLECTIONS.discussions, { 'author.handle': handle }),
      ]);
      const targets = [...(replies || []), ...(discussions || [])].filter(item =>
        COUNTABLE_STATES.includes(item.state)
      );

      if (targets.length === 0) {
        return res.status(404).json({ error: 'No public posts found for that account.' });
      }

      const definition = REPORT_BY_KEY.get(reason);
      const now = new Date().toISOString();
      const groupId = community.createRecordId('cbulk');

      await Promise.all(
        targets.slice(0, 100).map(target =>
          dbUnified.insertOne(COLLECTIONS.reports, {
            id: community.createRecordId('crept'),
            groupId,
            targetType: target.discussionId ? 'reply' : 'discussion',
            targetId: target.id,
            discussionId: target.discussionId || target.id,
            discussionStableId: target.discussionStableId || target.stableId || null,
            reportedUserId: target.authorId || null,
            reporterId: req.user.id,
            reason,
            reasonLabel: definition ? definition.label : reason,
            detail: stripHtml(String(req.body.detail || '')).slice(0, LIMITS.REPORT_DETAIL_MAX),
            priority: 'high',
            status: 'open',
            assignedTo: null,
            snapshot: { body: community.buildExcerpt(target.bodyText, 400), capturedAt: now },
            decision: null,
            createdAt: now,
            updatedAt: now,
            resolvedAt: null,
          })
        )
      );

      res.status(201).json({
        reported: true,
        groupId,
        count: Math.min(targets.length, 100),
        message: 'Thank you. A moderator will review this account and all of its recent posts.',
      });
    } catch (error) {
      logger.error('Could not record bulk community report:', error);
      res.status(500).json({ error: 'Could not submit report' });
    }
  }
);

/**
 * GET /api/v1/community/report-reasons
 * Public vocabulary for the report dialog.
 */
router.get('/report-reasons', publicReadLimiter, requireCommunityEnabled, (req, res) => {
  res.json({ reasons: REPORT_REASONS.map(({ key, label }) => ({ key, label })) });
});

module.exports = router;
module.exports.__internal = { recountReactions, notifyDiscussionFollowers, findDiscussion };
