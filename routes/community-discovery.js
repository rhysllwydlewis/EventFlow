/**
 * EventFlow Community — search, member profiles and personal data
 *
 * Discovery endpoints (search, duplicate suggestions, member profiles) plus the
 * member's own view of their community activity: saved discussions, follows,
 * drafts, mutes, notification preferences and a data export.
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
const { writeLimiter, searchLimiter, publicReadLimiter } = require('../middleware/rateLimits');
const { requireCommunityEnabled, attachViewer } = require('../middleware/community');
const community = require('../services/community.service');
const moderation = require('../services/communityModeration.service');
const { stripHtml } = require('../services/contentSanitizer');
const {
  COLLECTIONS,
  CONTENT_STATES,
  COUNTABLE_STATES,
  EVENT_TYPE_LABELS,
  REGION_LABELS,
  SORT_OPTIONS,
  LIMITS,
} = require('../models/CommunityContent');

router.use(userExtractionMiddleware, attachViewer);

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Score a discussion against a set of query terms across its title, body,
 * tags and replies, with a freshness weighting so current advice outranks
 * an equally relevant answer from six years ago.
 * @param {Object} discussion Discussion document.
 * @param {string[]} terms Lower-cased query terms.
 * @param {Map<string, Object[]>} repliesByDiscussion Replies indexed by discussion id.
 * @param {Date} now Clock injection for tests.
 * @returns {number} Relevance score.
 */
function scoreDiscussion(discussion, terms, repliesByDiscussion, now) {
  const title = String(discussion.title || '').toLowerCase();
  const body = String(discussion.bodyText || '').toLowerCase();
  const tags = (discussion.tags || []).join(' ').toLowerCase();
  const replies = (repliesByDiscussion.get(discussion.id) || [])
    .map(reply => String(reply.bodyText || '').toLowerCase())
    .join(' ');

  let score = 0;
  let matched = 0;

  terms.forEach(term => {
    let hit = false;
    if (title.includes(term)) {
      score += 12;
      hit = true;
    }
    if (tags.includes(term)) {
      score += 6;
      hit = true;
    }
    if (body.includes(term)) {
      score += 4;
      hit = true;
    }
    if (replies.includes(term)) {
      score += 2;
      hit = true;
    }
    if (hit) {
      matched += 1;
    }
  });

  if (matched === 0) {
    return 0;
  }
  // Require most terms to appear somewhere so a single common word cannot
  // surface an unrelated thread.
  score *= matched / terms.length;

  if (discussion.helpfulAnswerId) {
    score += 8;
  }
  if (Array.isArray(discussion.officialAnswerIds) && discussion.officialAnswerIds.length) {
    score += 10;
  }

  const freshness = moderation.assessFreshness(discussion, now);
  if (freshness.freshness === 'recent') {
    score *= 1.25;
  } else if (freshness.freshness === 'archive') {
    score *= 0.6;
  }

  return score;
}

/**
 * Highlight query terms in a snippet without ever emitting raw user HTML.
 * @param {string} text Plain-text source.
 * @param {string[]} terms Lower-cased query terms.
 * @returns {string} Escaped snippet with <mark> around matches.
 */
function highlight(text, terms) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return terms.reduce((acc, term) => {
    if (term.length < 2) {
      return acc;
    }
    const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return acc.replace(pattern, '<mark>$1</mark>');
  }, escaped);
}

/**
 * GET /api/v1/community/search
 * Full-text search across titles, original posts, replies and tags with the
 * same facets as the discussion index.
 */
router.get('/search', searchLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const raw = stripHtml(String(req.query.q || ''))
      .trim()
      .slice(0, LIMITS.SEARCH_QUERY_MAX);
    if (raw.length < 2) {
      return res.json({
        query: raw,
        results: [],
        pagination: { page: 1, limit: 0, total: 0, totalPages: 1 },
      });
    }

    const terms = raw
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length >= 2)
      .slice(0, 10);

    const now = new Date();
    const [discussions, replies, categories] = await Promise.all([
      community.loadPublicDiscussions(),
      dbUnified.find(COLLECTIONS.replies, { state: CONTENT_STATES.PUBLISHED }),
      community.listCategories({ includeHidden: true }),
    ]);

    const repliesByDiscussion = new Map();
    (replies || []).forEach(reply => {
      const list = repliesByDiscussion.get(reply.discussionId) || [];
      list.push(reply);
      repliesByDiscussion.set(reply.discussionId, list);
    });

    const categoriesBySlug = new Map(categories.map(item => [item.slug, item]));
    const filtered = community.applyFilters(discussions, req.query, now);

    const scored = filtered
      .map(item => ({ item, score: scoreDiscussion(item, terms, repliesByDiscussion, now) }))
      .filter(entry => entry.score > 0);

    const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : null;
    if (sort) {
      const comparator = community.comparatorFor(sort, now);
      scored.sort((a, b) => comparator(a.item, b.item));
    } else {
      scored.sort((a, b) => b.score - a.score);
    }

    const { page, limit, skip } = community.parsePagination(req.query);
    const pageItems = scored.slice(skip, skip + limit);

    res.json({
      query: raw,
      results: pageItems.map(({ item, score }) => ({
        ...community.toDiscussionCard(item, {
          category: categoriesBySlug.get(item.categorySlug),
          now,
        }),
        relevance: Math.round(score * 10) / 10,
        snippet: highlight(community.buildExcerpt(item.bodyText, 240), terms),
      })),
      facets: {
        categories: countBy(scored.map(entry => entry.item.categorySlug)),
        eventTypes: countBy(scored.map(entry => entry.item.eventType).filter(Boolean)),
        regions: countBy(scored.map(entry => entry.item.region).filter(Boolean)),
      },
      pagination: {
        page,
        limit,
        total: scored.length,
        totalPages: Math.max(1, Math.ceil(scored.length / limit)),
      },
    });
  } catch (error) {
    logger.error('Community search failed:', error);
    res.status(500).json({ error: 'Search is temporarily unavailable' });
  }
});

/**
 * Count occurrences of each value in a list.
 * @param {string[]} values Values to count.
 * @returns {Array<{key: string, count: number}>} Counts, highest first.
 */
function countBy(values) {
  const counts = new Map();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * GET /api/v1/community/similar
 * Suggest existing discussions while someone types a new title, so a member
 * finds the existing answer before creating a duplicate.
 */
router.get('/similar', searchLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const title = stripHtml(String(req.query.title || ''))
      .trim()
      .slice(0, LIMITS.TITLE_MAX);
    if (title.length < 6) {
      return res.json({ suggestions: [], guides: [] });
    }

    const now = new Date();
    const discussions = await community.loadPublicDiscussions();
    const scored = discussions
      .map(item => ({
        item,
        score: Math.max(
          moderation.similarity(title, item.title || ''),
          moderation.similarity(title, community.buildExcerpt(item.bodyText, 300))
        ),
      }))
      .filter(entry => entry.score >= 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    res.json({
      suggestions: scored.map(({ item, score }) => ({
        title: item.title,
        url: community.discussionPath(item),
        replyCount: Number(item.replyCount || 0),
        solved: Boolean(item.helpfulAnswerId),
        lastActivityAt: item.lastActivityAt,
        freshness: moderation.assessFreshness(item, now).freshness,
        similarity: Math.round(score * 100) / 100,
      })),
    });
  } catch (error) {
    logger.error('Could not build duplicate suggestions:', error);
    res.json({ suggestions: [] });
  }
});

// ─── Member profiles ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/community/members/:handle
 * Public community profile. Only fields the member has chosen to publish are
 * returned; account and contact details never appear here.
 */
router.get('/members/:handle', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const handle = String(req.params.handle || '').trim();
    if (!/^[a-zA-Z0-9]{2,32}$/.test(handle)) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const now = new Date();
    const [discussions, replies] = await Promise.all([
      dbUnified.find(COLLECTIONS.discussions, { 'author.handle': handle }),
      dbUnified.find(COLLECTIONS.replies, { 'author.handle': handle }),
    ]);

    const publicDiscussions = (discussions || []).filter(item =>
      COUNTABLE_STATES.includes(item.state)
    );
    const publicReplies = (replies || []).filter(item => COUNTABLE_STATES.includes(item.state));

    const sample = publicDiscussions[0] || publicReplies[0];
    if (!sample) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const user = await dbUnified.findOne('users', { id: sample.authorId });
    const stats = await community.getUserStats(sample.authorId);
    const level = community.computeLevel(stats, user || {}, now);
    const author = community.publicAuthor(sample.author);

    const categoriesBySlug = new Map(
      (await community.listCategories({ includeHidden: true })).map(item => [item.slug, item])
    );

    // The optional context fields come from the member's current profile rather
    // than the copy denormalised onto an old post, so changing them updates the
    // profile immediately instead of showing whatever was true when they last
    // posted. Only values from the published vocabularies are ever shown.
    const region = user && REGION_LABELS[user.communityRegion] ? user.communityRegion : null;
    const eventType =
      user && EVENT_TYPE_LABELS[user.communityEventType] ? user.communityEventType : null;

    res.json({
      member: {
        ...author,
        level: level.key,
        levelLabel: level.label,
        bio:
          user && user.communityBio ? stripHtml(user.communityBio).slice(0, LIMITS.BIO_MAX) : null,
        memberSince: user && user.createdAt ? new Date(user.createdAt).toISOString() : null,
        region,
        eventType,
        eventTypeLabel: eventType ? EVENT_TYPE_LABELS[eventType] : null,
        regionLabel: region ? REGION_LABELS[region] : null,
        supplierProfileUrl:
          author.isSupplier && author.supplierId ? `/supplier?id=${author.supplierId}` : null,
      },
      stats: {
        discussions: publicDiscussions.length,
        replies: publicReplies.length,
        helpfulAnswers: Number(stats.helpfulAnswers || 0),
        helpfulVotesReceived: Number(stats.helpfulVotesReceived || 0),
        officialAnswers: Number(stats.officialAnswers || 0),
      },
      discussions: publicDiscussions
        .sort(community.comparatorFor('newest', now))
        .slice(0, 10)
        .map(item =>
          community.toDiscussionCard(item, {
            category: categoriesBySlug.get(item.categorySlug),
            now,
          })
        ),
      replies: publicReplies
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
        .map(reply => ({
          id: reply.id,
          excerpt: community.buildExcerpt(reply.bodyText, 160),
          createdAt: reply.createdAt,
          isHelpfulAnswer: Boolean(reply.isHelpfulAnswer),
          url: `/community/discussion/${reply.discussionStableId}#reply-${reply.id}`,
        })),
    });
  } catch (error) {
    logger.error('Could not load community member profile:', error);
    res.status(500).json({ error: 'Could not load member profile' });
  }
});

// ─── The member's own data ───────────────────────────────────────────────────

/**
 * GET /api/v1/community/me
 * The signed-in member's community state: handle, level, trust tier, any
 * restriction and their notification preferences.
 */
router.get('/me', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    // "Who is looking at this page?" is a public question, and every community
    // page asks it on load. Answering a logged-out visitor with 401 turned an
    // ordinary anonymous visit into a console error and a wasted round trip, so
    // the endpoint reports the absence of a member rather than refusing.
    if (!req.user || !req.user.id) {
      return res.json({ authenticated: false });
    }
    const user = req.dbUser || (await dbUnified.findOne('users', { id: req.user.id }));
    const context = req.viewer;
    const stats = context.stats || (await community.getUserStats(req.user.id));
    const level = community.computeLevel(stats, user || {});

    res.json({
      authenticated: true,
      handle: (user && user.communityHandle) || community.deriveHandle(user || {}),
      displayName: (user && (user.communityDisplayName || user.displayName || user.name)) || null,
      level: level.key,
      levelLabel: level.label,
      role: context.role,
      // The tier and its effects are shown to the member; the underlying risk
      // signals are not, and neither is anything hidden from them.
      trustTier: context.trustTier,
      linkPolicy: moderation.policyFor(context.trustTier),
      adultDeclared: Boolean(
        user && (user.adultDeclaration || user.isAdult || user.communityAdultDeclaredAt)
      ),
      emailVerified: Boolean(user && user.verified),
      restriction: context.restriction
        ? {
            type: context.restriction.type,
            reason: context.restriction.publicReason || null,
            expiresAt: context.restriction.expiresAt || null,
            appealable: true,
          }
        : null,
      stats: {
        discussions: Number(stats.discussions || 0),
        replies: Number(stats.replies || 0),
        helpfulAnswers: Number(stats.helpfulAnswers || 0),
      },
      notificationPreferences: (user && user.communityNotificationPreferences) || {
        inApp: true,
        email: 'weekly',
      },
    });
  } catch (error) {
    logger.error('Could not load community member state:', error);
    res.status(500).json({ error: 'Could not load your community profile' });
  }
});

/**
 * POST /api/v1/community/me/adult-declaration
 * Record the member's 18+ self-declaration.
 */
router.post(
  '/me/adult-declaration',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      if (req.body.confirmed !== true) {
        return res.status(400).json({ error: 'Confirmation required' });
      }
      await dbUnified.updateOne(
        'users',
        { id: req.user.id },
        {
          $set: {
            adultDeclaration: true,
            communityAdultDeclaredAt: new Date().toISOString(),
          },
        }
      );
      res.json({ adultDeclared: true });
    } catch (error) {
      logger.error('Could not record adult declaration:', error);
      res.status(500).json({ error: 'Could not save your confirmation' });
    }
  }
);

/**
 * PATCH /api/v1/community/me/profile
 * Update the member's public community profile. Everything here is optional and
 * the defaults publish nothing beyond a handle.
 */
router.patch(
  '/me/profile',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const update = {};

      if (typeof req.body.bio === 'string') {
        update.communityBio = stripHtml(req.body.bio).trim().slice(0, LIMITS.BIO_MAX);
      }
      if (typeof req.body.displayName === 'string') {
        update.communityDisplayName = stripHtml(req.body.displayName).trim().slice(0, 60);
      }
      if (typeof req.body.region === 'string') {
        update.communityRegion = REGION_LABELS[req.body.region] ? req.body.region : null;
      }
      if (typeof req.body.eventType === 'string') {
        update.communityEventType = EVENT_TYPE_LABELS[req.body.eventType]
          ? req.body.eventType
          : null;
      }
      if (
        req.body.notificationPreferences &&
        typeof req.body.notificationPreferences === 'object'
      ) {
        const prefs = req.body.notificationPreferences;
        update.communityNotificationPreferences = {
          inApp: prefs.inApp !== false,
          email: ['immediate', 'daily', 'weekly', 'none'].includes(prefs.email)
            ? prefs.email
            : 'weekly',
        };
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      await dbUnified.updateOne('users', { id: req.user.id }, { $set: update });
      res.json({ updated: true, profile: update });
    } catch (error) {
      logger.error('Could not update community profile:', error);
      res.status(500).json({ error: 'Could not update your profile' });
    }
  }
);

/**
 * GET /api/v1/community/me/saved
 * The member's saved discussions.
 */
router.get(
  '/me/saved',
  publicReadLimiter,
  requireCommunityEnabled,
  authRequired,
  async (req, res) => {
    try {
      const bookmarks =
        (await dbUnified.find(COLLECTIONS.bookmarks, { userId: req.user.id })) || [];
      const ids = new Set(bookmarks.map(item => item.discussionId));
      const discussions = (await community.loadPublicDiscussions()).filter(item =>
        ids.has(item.id)
      );
      const now = new Date();
      res.json({
        discussions: discussions
          .sort(community.comparatorFor('latest-activity', now))
          .map(item => community.toDiscussionCard(item, { now })),
      });
    } catch (error) {
      logger.error('Could not load saved discussions:', error);
      res.status(500).json({ error: 'Could not load your saved discussions' });
    }
  }
);

/**
 * GET /api/v1/community/me/following
 * Categories and discussions the member follows.
 */
router.get(
  '/me/following',
  publicReadLimiter,
  requireCommunityEnabled,
  authRequired,
  async (req, res) => {
    try {
      const follows = (await dbUnified.find(COLLECTIONS.follows, { userId: req.user.id })) || [];
      const categoryIds = new Set(
        follows.filter(item => item.targetType === 'category').map(item => item.targetId)
      );
      const discussionIds = new Set(
        follows.filter(item => item.targetType === 'discussion').map(item => item.targetId)
      );

      const [categories, discussions] = await Promise.all([
        community.listCategories({ includeHidden: true }),
        community.loadPublicDiscussions(),
      ]);
      const now = new Date();

      res.json({
        categories: categories
          .filter(item => categoryIds.has(item.id))
          .map(item => ({ slug: item.slug, name: item.name, icon: item.icon })),
        discussions: discussions
          .filter(item => discussionIds.has(item.id))
          .sort(community.comparatorFor('latest-activity', now))
          .map(item => community.toDiscussionCard(item, { now })),
      });
    } catch (error) {
      logger.error('Could not load following feed:', error);
      res.status(500).json({ error: 'Could not load what you follow' });
    }
  }
);

/**
 * GET /api/v1/community/me/drafts
 * The member's saved drafts.
 */
router.get(
  '/me/drafts',
  publicReadLimiter,
  requireCommunityEnabled,
  authRequired,
  async (req, res) => {
    try {
      const drafts = (await dbUnified.find(COLLECTIONS.drafts, { userId: req.user.id })) || [];
      res.json({
        drafts: drafts
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
          .map(draft => ({
            id: draft.id,
            title: draft.title,
            category: draft.category,
            excerpt: community.buildExcerpt(draft.bodyText, 160),
            updatedAt: draft.updatedAt,
          })),
      });
    } catch (error) {
      logger.error('Could not load community drafts:', error);
      res.status(500).json({ error: 'Could not load your drafts' });
    }
  }
);

/**
 * PUT /api/v1/community/me/drafts
 * Create or replace a draft.
 */
router.put(
  '/me/drafts',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const id = req.body.id ? String(req.body.id) : community.createRecordId('cdraft');
      const bodyText = stripHtml(String(req.body.body || '')).slice(0, LIMITS.BODY_MAX);
      const draft = {
        id,
        userId: req.user.id,
        title: stripHtml(String(req.body.title || '')).slice(0, LIMITS.TITLE_MAX),
        category: String(req.body.category || '').slice(0, 80),
        body: String(req.body.body || '').slice(0, LIMITS.BODY_MAX),
        bodyText,
        updatedAt: new Date().toISOString(),
      };

      const existing = await dbUnified.findOne(COLLECTIONS.drafts, { id, userId: req.user.id });
      if (existing) {
        await dbUnified.updateOne(COLLECTIONS.drafts, { id, userId: req.user.id }, { $set: draft });
      } else {
        await dbUnified.insertOne(COLLECTIONS.drafts, { ...draft, createdAt: draft.updatedAt });
      }
      res.json({ draft: { id: draft.id, updatedAt: draft.updatedAt } });
    } catch (error) {
      logger.error('Could not save community draft:', error);
      res.status(500).json({ error: 'Could not save your draft' });
    }
  }
);

/**
 * DELETE /api/v1/community/me/drafts/:id
 * Delete a draft.
 */
router.delete(
  '/me/drafts/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      await dbUnified.deleteOne(COLLECTIONS.drafts, { id: req.params.id, userId: req.user.id });
      res.json({ deleted: true });
    } catch (error) {
      logger.error('Could not delete community draft:', error);
      res.status(500).json({ error: 'Could not delete your draft' });
    }
  }
);

/**
 * POST /api/v1/community/me/mutes
 * Mute a member, a category or a discussion.
 */
router.post(
  '/me/mutes',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const kinds = {
        user: 'muted_user',
        category: 'muted_category',
        discussion: 'muted_discussion',
      };
      const type = kinds[String(req.body.kind || '')];
      const targetId = String(req.body.targetId || '').trim();
      if (!type || !targetId) {
        return res.status(400).json({ error: 'Tell us what you would like to mute.' });
      }

      const existing = await dbUnified.findOne(COLLECTIONS.restrictions, {
        userId: req.user.id,
        type,
        targetId,
      });
      if (!existing) {
        await dbUnified.insertOne(COLLECTIONS.restrictions, {
          id: community.createRecordId('cmute'),
          userId: req.user.id,
          type,
          targetId,
          active: true,
          selfApplied: true,
          createdAt: new Date().toISOString(),
        });
      }
      res.json({ muted: true, kind: req.body.kind, targetId });
    } catch (error) {
      logger.error('Could not save community mute:', error);
      res.status(500).json({ error: 'Could not save your preference' });
    }
  }
);

/**
 * DELETE /api/v1/community/me/mutes/:id
 * Remove one of your own mutes. Moderator-applied restrictions are never
 * removable this way.
 */
router.delete(
  '/me/mutes/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const record = await dbUnified.findOne(COLLECTIONS.restrictions, {
        id: req.params.id,
        userId: req.user.id,
      });
      if (!record || record.selfApplied !== true) {
        return res.status(404).json({ error: 'Not found' });
      }
      await dbUnified.deleteOne(COLLECTIONS.restrictions, { id: record.id });
      res.json({ muted: false });
    } catch (error) {
      logger.error('Could not remove community mute:', error);
      res.status(500).json({ error: 'Could not update your preference' });
    }
  }
);

/**
 * GET /api/v1/community/me/export
 * Download everything you have posted in the community as JSON.
 */
router.get(
  '/me/export',
  publicReadLimiter,
  requireCommunityEnabled,
  authRequired,
  async (req, res) => {
    try {
      const [discussions, replies, bookmarks, follows, drafts] = await Promise.all([
        dbUnified.find(COLLECTIONS.discussions, { authorId: req.user.id }),
        dbUnified.find(COLLECTIONS.replies, { authorId: req.user.id }),
        dbUnified.find(COLLECTIONS.bookmarks, { userId: req.user.id }),
        dbUnified.find(COLLECTIONS.follows, { userId: req.user.id }),
        dbUnified.find(COLLECTIONS.drafts, { userId: req.user.id }),
      ]);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="eventflow-community-export.json"'
      );
      res.json({
        exportedAt: new Date().toISOString(),
        discussions: (discussions || []).map(community.stripInternalFields),
        replies: (replies || []).map(community.stripInternalFields),
        savedDiscussions: (bookmarks || []).map(community.stripInternalFields),
        follows: (follows || []).map(community.stripInternalFields),
        drafts: (drafts || []).map(community.stripInternalFields),
      });
    } catch (error) {
      logger.error('Could not export community data:', error);
      res.status(500).json({ error: 'Could not build your export' });
    }
  }
);

/**
 * POST /api/v1/community/me/appeals
 * Appeal a moderation decision.
 */
router.post(
  '/me/appeals',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const message = stripHtml(String(req.body.message || ''))
        .trim()
        .slice(0, LIMITS.APPEAL_MAX);
      if (message.length < 20) {
        return res.status(400).json({ error: 'Tell us why you think the decision was wrong.' });
      }

      const appeal = {
        id: community.createRecordId('cappeal'),
        userId: req.user.id,
        targetType: String(req.body.targetType || 'content').slice(0, 20),
        targetId: String(req.body.targetId || '').slice(0, 80) || null,
        message,
        status: 'open',
        decision: null,
        decisionReason: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      await dbUnified.insertOne(COLLECTIONS.appeals, appeal);
      res.status(201).json({
        appealId: appeal.id,
        status: 'open',
        message:
          'Thank you. A senior moderator will review your appeal and let you know the outcome.',
      });
    } catch (error) {
      logger.error('Could not record community appeal:', error);
      res.status(500).json({ error: 'Could not submit your appeal' });
    }
  }
);

module.exports = router;
module.exports.__internal = { scoreDiscussion, highlight, countBy };
