/**
 * EventFlow Community — public and member API
 *
 * Read endpoints are open to everyone and return only published content.
 * Write endpoints require authentication, a verified email address, an adult
 * declaration and CSRF protection, and every decision is taken server-side.
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
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  REGIONS,
  REGION_LABELS,
  REACTION_KEYS,
  REPORT_REASONS,
  SORT_OPTIONS,
  ANSWER_FILTERS,
  FRESHNESS_FILTERS,
  LIMITS,
  COMMUNITY_LEVELS,
} = require('../models/CommunityContent');

// ─── Local helpers ───────────────────────────────────────────────────────────

const {
  applyFilters,
  loadPublicDiscussions,
  buildAuthorCard,
  recentPostsFor,
  recordModerationAction,
} = community;

// ─── Routes: reference data ──────────────────────────────────────────────────

router.use(userExtractionMiddleware, attachViewer);

/**
 * GET /api/v1/community/meta
 * Taxonomy, reaction and report vocabularies for the front end.
 */
router.get('/meta', publicReadLimiter, requireCommunityEnabled, (req, res) => {
  res.json({
    eventTypes: EVENT_TYPES.map(key => ({ key, label: EVENT_TYPE_LABELS[key] })),
    regions: REGIONS.map(key => ({ key, label: REGION_LABELS[key] })),
    reactions: REACTION_KEYS,
    reportReasons: REPORT_REASONS.map(({ key, label }) => ({ key, label })),
    sortOptions: SORT_OPTIONS,
    answerFilters: ANSWER_FILTERS,
    freshnessFilters: FRESHNESS_FILTERS,
    levels: COMMUNITY_LEVELS.map(({ key, label }) => ({ key, label })),
    limits: {
      titleMax: LIMITS.TITLE_MAX,
      bodyMax: LIMITS.BODY_MAX,
      replyMax: LIMITS.REPLY_MAX,
      tagsMax: LIMITS.TAGS_MAX,
    },
  });
});

/**
 * GET /api/v1/community/categories
 * Ordered category list with live counts.
 */
router.get('/categories', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const [categories, discussions] = await Promise.all([
      community.listCategories(),
      loadPublicDiscussions(),
    ]);
    const follows = req.viewer.user
      ? await dbUnified.find(COLLECTIONS.follows, {
          userId: req.viewer.user.id,
          targetType: 'category',
        })
      : [];
    const followed = new Set((follows || []).map(item => item.targetId));

    const counts = new Map();
    discussions.forEach(item => {
      counts.set(item.categorySlug, (counts.get(item.categorySlug) || 0) + 1);
    });

    res.json({
      categories: categories.map(item => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        icon: item.icon,
        coverUrl: item.coverUrl || null,
        rules: item.rules || null,
        officialSupport: Boolean(item.officialSupport),
        structuredRecommendations: Boolean(item.structuredRecommendations),
        marketplaceSafetyNotice: Boolean(item.marketplaceSafetyNotice),
        discussionCount: counts.get(item.slug) || 0,
        followerCount: Number(item.followerCount || 0),
        following: followed.has(item.id),
      })),
    });
  } catch (error) {
    logger.error('Could not list community categories:', error);
    res.status(500).json({ error: 'Could not load categories' });
  }
});

/**
 * GET /api/v1/community/categories/:slug
 * Category landing page payload.
 */
router.get('/categories/:slug', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const category = await dbUnified.findOne(COLLECTIONS.categories, { slug });
    if (!category || category.visible === false) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const now = new Date();
    // The category is part of the URL, not the query string, so it is merged in
    // to let the {state, categorySlug, lastActivityAt} index do the narrowing.
    const inCategory = await loadPublicDiscussions({ ...req.query, category: slug }, now);
    const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : 'latest-activity';
    const filtered = applyFilters(inCategory, req.query, now);

    const pinned = filtered.filter(item => item.pinned);
    const rest = filtered.filter(item => !item.pinned).sort(community.comparatorFor(sort, now));
    const ordered = [...pinned.sort(community.comparatorFor(sort, now)), ...rest];

    const { page, limit, skip } = community.parsePagination(req.query);
    const pageItems = ordered.slice(skip, skip + limit);

    const contributorCounts = new Map();
    inCategory.forEach(item => {
      const handle = item.author && item.author.handle;
      if (handle) {
        contributorCounts.set(handle, (contributorCounts.get(handle) || 0) + 1);
      }
    });

    const following = req.viewer.user
      ? Boolean(
          await dbUnified.findOne(COLLECTIONS.follows, {
            userId: req.viewer.user.id,
            targetType: 'category',
            targetId: category.id,
          })
        )
      : false;

    res.json({
      category: {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        icon: category.icon,
        coverUrl: category.coverUrl || null,
        rules: category.rules || null,
        officialSupport: Boolean(category.officialSupport),
        structuredRecommendations: Boolean(category.structuredRecommendations),
        marketplaceSafetyNotice: Boolean(category.marketplaceSafetyNotice),
        discussionCount: inCategory.length,
        followerCount: Number(category.followerCount || 0),
        following,
      },
      activeContributors: Array.from(contributorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([handle, count]) => ({ handle, posts: count })),
      discussions: pageItems.map(item => community.toDiscussionCard(item, { category, now })),
      pagination: {
        page,
        limit,
        total: ordered.length,
        totalPages: Math.max(1, Math.ceil(ordered.length / limit)),
      },
    });
  } catch (error) {
    logger.error('Could not load community category:', error);
    res.status(500).json({ error: 'Could not load category' });
  }
});

/**
 * POST /api/v1/community/categories/:id/follow
 * Follow a category. Following is optional and never required to participate.
 */
router.post(
  '/categories/:id/follow',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const category = await dbUnified.findOne(COLLECTIONS.categories, { id: req.params.id });
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      const existing = await dbUnified.findOne(COLLECTIONS.follows, {
        userId: req.user.id,
        targetType: 'category',
        targetId: category.id,
      });
      if (existing) {
        return res.json({ following: true, followerCount: Number(category.followerCount || 0) });
      }
      await dbUnified.insertOne(COLLECTIONS.follows, {
        id: community.createRecordId('cfollow'),
        userId: req.user.id,
        targetType: 'category',
        targetId: category.id,
        createdAt: new Date().toISOString(),
      });
      await dbUnified.updateOne(
        COLLECTIONS.categories,
        { id: category.id },
        { $inc: { followerCount: 1 } }
      );
      // Read the count back rather than computing it, so the response always
      // reflects what was actually stored.
      const updated = await dbUnified.findOne(COLLECTIONS.categories, { id: category.id });
      res.json({ following: true, followerCount: Number((updated || {}).followerCount || 0) });
    } catch (error) {
      logger.error('Could not follow community category:', error);
      res.status(500).json({ error: 'Could not follow category' });
    }
  }
);

/**
 * DELETE /api/v1/community/categories/:id/follow
 * Unfollow a category.
 */
router.delete(
  '/categories/:id/follow',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const existing = await dbUnified.findOne(COLLECTIONS.follows, {
        userId: req.user.id,
        targetType: 'category',
        targetId: req.params.id,
      });
      if (!existing) {
        return res.json({ following: false });
      }
      await dbUnified.deleteOne(COLLECTIONS.follows, { id: existing.id });
      await dbUnified.updateOne(
        COLLECTIONS.categories,
        { id: req.params.id },
        { $inc: { followerCount: -1 } }
      );
      res.json({ following: false });
    } catch (error) {
      logger.error('Could not unfollow community category:', error);
      res.status(500).json({ error: 'Could not unfollow category' });
    }
  }
);

// ─── Routes: home ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/community/home
 * Every module the community homepage renders, computed from real data only.
 * Modules with no genuine content return empty arrays so the page can omit them
 * rather than render a decorative empty box.
 */
// skipcq: JS-R1005 -- Assembling the home payload in one place avoids many round trips.
router.get('/home', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const now = new Date();
    const [categories, discussions] = await Promise.all([
      community.listCategories(),
      loadPublicDiscussions(),
    ]);
    const categoriesBySlug = new Map(categories.map(item => [item.slug, item]));
    const card = item =>
      community.toDiscussionCard(item, { category: categoriesBySlug.get(item.categorySlug), now });

    const byActivity = discussions.slice().sort(community.comparatorFor('latest-activity', now));
    const byCreated = discussions.slice().sort(community.comparatorFor('newest', now));

    const replies =
      (await dbUnified.find(COLLECTIONS.replies, { state: CONTENT_STATES.PUBLISHED })) || [];
    const discussionsById = new Map(discussions.map(item => [item.id, item]));
    const recentReplies = replies
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .filter(reply => discussionsById.has(reply.discussionId))
      .slice(0, 8)
      .map(reply => {
        const discussion = discussionsById.get(reply.discussionId);
        return {
          replyId: reply.id,
          discussionTitle: discussion.title,
          discussionUrl: `${community.discussionPath(discussion)}#reply-${reply.id}`,
          author: community.publicAuthor(reply.author),
          excerpt: community.buildExcerpt(reply.bodyText, 140),
          createdAt: reply.createdAt,
        };
      });

    const stats = (await dbUnified.find(COLLECTIONS.userStats, {})) || [];
    const helpfulMembers = stats
      .filter(item => Number(item.helpfulAnswers || 0) > 0)
      .sort((a, b) => Number(b.helpfulAnswers || 0) - Number(a.helpfulAnswers || 0))
      .slice(0, 6)
      .map(item => ({
        handle: item.handle || null,
        displayName: item.displayName || 'EventFlow member',
        helpfulAnswers: Number(item.helpfulAnswers || 0),
        level: item.level || 'contributor',
      }))
      .filter(item => item.handle);

    const supplierContributors = discussions
      .filter(item => item.hasSupplierReply)
      .slice(0, 6)
      .map(item => card(item));

    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const trending = discussions
      .filter(item => new Date(item.lastActivityAt || item.createdAt).getTime() >= weekAgo)
      .sort((a, b) => community.popularityScore(b, now) - community.popularityScore(a, now))
      .slice(0, 6);

    const following = req.viewer.user
      ? await buildFollowingFeed(req.viewer.user.id, discussions, categoriesBySlug, now)
      : null;

    const photoDiscussions = discussions
      .filter(
        item => Array.isArray(item.attachments) && item.attachments.some(a => a.kind === 'image')
      )
      .sort(community.comparatorFor('newest', now))
      .slice(0, 8);

    res.json({
      counts: {
        discussions: discussions.length,
        replies: replies.length,
        categories: categories.length,
        // Deliberately no "users online" vanity counter: see the parity matrix
        // entry explaining the evidence-backed replacement below.
        answeredPercentage:
          discussions.length === 0
            ? 0
            : Math.round(
                (discussions.filter(item => Number(item.replyCount || 0) > 0).length /
                  discussions.length) *
                  100
              ),
      },
      featured: discussions
        .filter(item => item.featured)
        .slice(0, 3)
        .map(card),
      recentDiscussions: byCreated.slice(0, 8).map(card),
      recentActivity: byActivity.slice(0, 8).map(card),
      recentReplies,
      popular: discussions
        .slice()
        .sort(community.comparatorFor('popular', now))
        .slice(0, 8)
        .map(card),
      mostViewed: discussions
        .slice()
        .sort(community.comparatorFor('most-viewed', now))
        .slice(0, 8)
        .map(card),
      unanswered: discussions
        .filter(item => Number(item.replyCount || 0) === 0)
        .sort(community.comparatorFor('newest', now))
        .slice(0, 8)
        .map(card),
      trending: trending.map(card),
      following,
      categories: categories.map(item => ({
        slug: item.slug,
        name: item.name,
        icon: item.icon,
        description: item.description,
        discussionCount: discussions.filter(d => d.categorySlug === item.slug).length,
        officialSupport: Boolean(item.officialSupport),
      })),
      helpfulMembers,
      supplierContributors,
      recentPhotos: photoDiscussions.map(item => ({
        url: community.discussionPath(item),
        title: item.title,
        attachment: item.attachments.find(a => a.kind === 'image'),
      })),
      eventTypes: EVENT_TYPES.map(key => ({
        key,
        label: EVENT_TYPE_LABELS[key],
        count: discussions.filter(item => item.eventType === key).length,
      })).filter(item => item.count > 0),
      regions: REGIONS.map(key => ({
        key,
        label: REGION_LABELS[key],
        count: discussions.filter(item => item.region === key).length,
      })).filter(item => item.count > 0),
    });
  } catch (error) {
    logger.error('Could not build community home payload:', error);
    res.status(500).json({ error: 'Could not load the community' });
  }
});

/**
 * Build the personalised "following" feed for a signed-in member.
 * @param {string} userId Member id.
 * @param {Object[]} discussions All public discussions.
 * @param {Map} categoriesBySlug Categories indexed by slug.
 * @param {Date} now Clock injection for tests.
 * @returns {Promise<Object>} Following feed.
 */
async function buildFollowingFeed(userId, discussions, categoriesBySlug, now) {
  const follows = (await dbUnified.find(COLLECTIONS.follows, { userId })) || [];
  const categoryIds = new Set(
    follows.filter(item => item.targetType === 'category').map(item => item.targetId)
  );
  const discussionIds = new Set(
    follows.filter(item => item.targetType === 'discussion').map(item => item.targetId)
  );

  const followedSlugs = new Set(
    Array.from(categoriesBySlug.values())
      .filter(item => categoryIds.has(item.id))
      .map(item => item.slug)
  );

  const items = discussions
    .filter(item => followedSlugs.has(item.categorySlug) || discussionIds.has(item.id))
    .sort(community.comparatorFor('latest-activity', now))
    .slice(0, 10)
    .map(item =>
      community.toDiscussionCard(item, { category: categoriesBySlug.get(item.categorySlug), now })
    );

  return {
    items,
    followedCategories: followedSlugs.size,
    followedDiscussions: discussionIds.size,
    // Explains the feed rather than leaving it opaque.
    explanation:
      'These are the newest posts in the categories and discussions you follow. Nothing here is paid placement.',
  };
}

// ─── Routes: discussions ─────────────────────────────────────────────────────

/**
 * GET /api/v1/community/discussions
 * Filterable, sortable, paginated discussion index.
 */
router.get('/discussions', publicReadLimiter, requireCommunityEnabled, async (req, res) => {
  try {
    const now = new Date();
    const [categories, all] = await Promise.all([
      community.listCategories({ includeHidden: true }),
      loadPublicDiscussions(req.query, now),
    ]);
    const categoriesBySlug = new Map(categories.map(item => [item.slug, item]));

    const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : 'latest-activity';
    let filtered = applyFilters(all, req.query, now);
    if (sort === 'unanswered') {
      filtered = filtered.filter(item => Number(item.replyCount || 0) === 0);
    }
    const ordered = filtered.sort(community.comparatorFor(sort, now));

    const { page, limit, skip } = community.parsePagination(req.query);
    const pageItems = ordered.slice(skip, skip + limit);

    res.json({
      discussions: pageItems.map(item =>
        community.toDiscussionCard(item, { category: categoriesBySlug.get(item.categorySlug), now })
      ),
      pagination: {
        page,
        limit,
        total: ordered.length,
        totalPages: Math.max(1, Math.ceil(ordered.length / limit)),
      },
      appliedSort: sort,
    });
  } catch (error) {
    logger.error('Could not list community discussions:', error);
    res.status(500).json({ error: 'Could not load discussions' });
  }
});

/**
 * GET /api/v1/community/discussions/:stableId
 * Full discussion with a page of replies.
 */
// skipcq: JS-R1005 -- The thread payload is assembled once for both the API and SSR.
router.get(
  '/discussions/:stableId',
  publicReadLimiter,
  requireCommunityEnabled,
  async (req, res) => {
    try {
      const stableId = String(req.params.stableId || '').trim();
      if (!/^[a-f0-9]{6,32}$/i.test(stableId)) {
        return res.status(404).json({ error: 'Discussion not found' });
      }

      const discussion = await dbUnified.findOne(COLLECTIONS.discussions, { stableId });
      if (!discussion || !community.canView(discussion, req.viewer)) {
        return res.status(404).json({ error: 'Discussion not found' });
      }

      const now = new Date();
      const category = await dbUnified.findOne(COLLECTIONS.categories, {
        slug: discussion.categorySlug,
      });

      const allReplies =
        (await dbUnified.find(COLLECTIONS.replies, { discussionId: discussion.id })) || [];
      const visible = allReplies
        .filter(
          reply => community.canView(reply, req.viewer) || reply.state === CONTENT_STATES.REMOVED
        )
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = LIMITS.REPLY_PAGE_SIZE;
      const pageReplies = visible.slice((page - 1) * limit, page * limit);

      const viewerId = req.viewer.user ? req.viewer.user.id : null;
      // Null prototype: the keys are record ids, so this object is a plain map and
      // must never expose or accept prototype members.
      const myReactions = Object.create(null);
      let saved = false;
      let following = false;
      if (viewerId) {
        const [reactions, bookmark, follow] = await Promise.all([
          dbUnified.find(COLLECTIONS.reactions, { userId: viewerId }),
          dbUnified.findOne(COLLECTIONS.bookmarks, {
            userId: viewerId,
            discussionId: discussion.id,
          }),
          dbUnified.findOne(COLLECTIONS.follows, {
            userId: viewerId,
            targetType: 'discussion',
            targetId: discussion.id,
          }),
        ]);
        (reactions || []).forEach(item => {
          // The key is a stored record id and the value a known reaction; both
          // are shape-checked so nothing outside that vocabulary is written.
          const target = String(item.targetId || '');
          if (!/^[a-z]+_[a-f0-9]{6,64}$/.test(target) || !REACTION_KEYS.includes(item.reaction)) {
            return;
          }
          myReactions[target] = myReactions[target] || [];
          myReactions[target].push(item.reaction);
        });
        saved = Boolean(bookmark);
        following = Boolean(follow);
      }

      // Views are recorded once per viewer per 24 hours and never store an IP.
      if (req.query.trackView !== 'false') {
        await community.recordView(discussion.id, req);
      }

      const freshness = moderation.assessFreshness(discussion, now);
      const canonical = discussion.supersededBy
        ? await dbUnified.findOne(COLLECTIONS.discussions, { id: discussion.supersededBy })
        : null;

      const related = (await loadPublicDiscussions())
        .filter(item => item.id !== discussion.id && item.categorySlug === discussion.categorySlug)
        .sort(community.comparatorFor('popular', now))
        .slice(0, 5)
        .map(item => ({ title: item.title, url: community.discussionPath(item) }));

      res.json({
        discussion: {
          ...community.toDiscussionCard(discussion, { category, now }),
          body: discussion.bodyHtml,
          attachments: discussion.attachments || [],
          poll: discussion.poll || null,
          editedAt: discussion.editedAt || null,
          archived: discussion.state === CONTENT_STATES.ARCHIVED,
          moderatorNotice: discussion.moderatorNotice || null,
          canonicalDiscussion: canonical
            ? { title: canonical.title, url: community.discussionPath(canonical) }
            : null,
          eventDate: discussion.eventDate || null,
          recommendationBrief: discussion.recommendationBrief || null,
          isOwn: Boolean(viewerId && discussion.authorId === viewerId),
          pendingReview: discussion.state === CONTENT_STATES.QUARANTINED,
        },
        freshness,
        replies: pageReplies.map(reply => community.toReplyView(reply, { viewerId })),
        myReactions,
        viewerState: {
          saved,
          following,
          canReply: Boolean(viewerId) && !discussion.locked,
          isModerator: community.isModerator(req.viewer.user || {}),
        },
        related,
        pagination: {
          page,
          limit,
          total: visible.length,
          totalPages: Math.max(1, Math.ceil(visible.length / limit)),
        },
      });
    } catch (error) {
      logger.error('Could not load community discussion:', error);
      res.status(500).json({ error: 'Could not load discussion' });
    }
  }
);

/**
 * Validate and normalise the optional structured fields on a discussion.
 * @param {Object} body Request body.
 * @returns {{errors: string[], values: Object}} Normalised values.
 */
function normaliseStructuredFields(body) {
  const errors = [];
  const values = {};

  const eventType = String(body.eventType || '').trim();
  if (eventType) {
    if (!EVENT_TYPES.includes(eventType)) {
      errors.push('Unknown event type.');
    } else {
      values.eventType = eventType;
    }
  }

  const region = String(body.region || '').trim();
  if (region) {
    if (!REGIONS.includes(region)) {
      errors.push('Unknown region.');
    } else {
      values.region = region;
    }
  }

  const eventDate = String(body.eventDate || '').trim();
  if (eventDate) {
    // Month precision only — an exact event date plus a region is more personal
    // data than a public forum post needs.
    if (!/^\d{4}-\d{2}$/.test(eventDate)) {
      errors.push('Event date must be a month in YYYY-MM format.');
    } else {
      values.eventDate = eventDate;
    }
  }

  const tags = Array.isArray(body.tags) ? body.tags : [];
  const cleanTags = tags
    .map(tag => stripHtml(String(tag)).trim().toLowerCase())
    .filter(Boolean)
    .filter(tag => tag.length <= LIMITS.TAG_MAX_LENGTH)
    .slice(0, LIMITS.TAGS_MAX);
  values.tags = Array.from(new Set(cleanTags));

  if (body.poll && typeof body.poll === 'object') {
    const question = stripHtml(String(body.poll.question || '')).trim();
    const options = Array.isArray(body.poll.options) ? body.poll.options : [];
    const cleanOptions = options
      .map(option => stripHtml(String(option)).trim().slice(0, LIMITS.POLL_OPTION_MAX_LENGTH))
      .filter(Boolean)
      .slice(0, LIMITS.POLL_OPTIONS_MAX);
    if (question && cleanOptions.length >= LIMITS.POLL_OPTIONS_MIN) {
      values.poll = {
        question,
        options: cleanOptions.map((label, index) => ({ id: `opt${index + 1}`, label, votes: 0 })),
        totalVotes: 0,
      };
    } else if (question || cleanOptions.length > 0) {
      errors.push(`A poll needs a question and at least ${LIMITS.POLL_OPTIONS_MIN} options.`);
    }
  }

  if (body.recommendationBrief && typeof body.recommendationBrief === 'object') {
    const brief = body.recommendationBrief;
    values.recommendationBrief = {
      supplierCategory:
        stripHtml(String(brief.supplierCategory || ''))
          .trim()
          .slice(0, 80) || null,
      budgetRange:
        stripHtml(String(brief.budgetRange || ''))
          .trim()
          .slice(0, 60) || null,
      guestCount: Number.isFinite(Number(brief.guestCount)) ? Number(brief.guestCount) : null,
      verifiedSuppliersMayReply: brief.verifiedSuppliersMayReply !== false,
    };
  }

  return { errors, values };
}

/**
 * POST /api/v1/community/discussions
 * Start a discussion.
 */
// skipcq: JS-R1005 -- Creation runs validation, moderation and persistence in order.
router.post(
  '/discussions',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  requireAdultDeclaration,
  requirePostingRights,
  csrfProtection,
  async (req, res) => {
    try {
      const settings = await community.getSettings();
      const context = req.viewer;
      const title = stripHtml(String(req.body.title || '')).trim();
      const categorySlug = String(req.body.category || '').trim();

      const category = await dbUnified.findOne(COLLECTIONS.categories, { slug: categorySlug });
      if (!category || category.visible === false || category.archived === true) {
        return res.status(400).json({ error: 'Choose a category for your discussion.' });
      }

      const prepared = moderation.prepareBody(req.body.body, {
        clickable: moderation.policyFor(context.trustTier).linksClickable,
        settings,
      });

      const lengthCheck = moderation.validateLength({ title, text: prepared.text });
      const structured = normaliseStructuredFields(req.body);
      const errors = [...lengthCheck.errors, ...structured.errors];
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const todaysDiscussions = await dbUnified.find(COLLECTIONS.discussions, {
        authorId: req.user.id,
        createdAt: { $gte: dayAgo },
      });
      if ((todaysDiscussions || []).length >= Number(settings.maxDiscussionsPerDay || 10)) {
        return res.status(429).json({
          error: 'Daily limit reached',
          message: 'You have started the maximum number of discussions for today.',
        });
      }

      const verdict = moderation.assessContent({
        text: prepared.text,
        title,
        trustTier: context.trustTier,
        settings,
        recentPosts: await recentPostsFor(req.user.id),
      });

      if (verdict.decision === 'reject') {
        await recordModerationAction({
          action: 'quarantine',
          targetType: 'discussion',
          targetId: 'rejected',
          reason: 'automated_block',
          signals: verdict.signals,
        });
        return res.status(422).json({
          error: 'Post blocked',
          code: 'CONTENT_BLOCKED',
          message:
            'This post links to a domain that is not allowed in the community. Remove the link and try again.',
        });
      }

      const author = await buildAuthorCard(req.dbUser, context);
      const stableId = community.createStableId();
      const now = new Date().toISOString();

      const discussion = {
        id: community.createRecordId('cdisc'),
        stableId,
        slug: community.slugify(title),
        title,
        bodyHtml: prepared.html,
        bodyText: prepared.text,
        searchText: prepared.text.slice(0, 5000),
        excerpt: community.buildExcerpt(prepared.text),
        fingerprint: moderation.fingerprint(prepared.text),
        authorId: req.user.id,
        author,
        authorTrustTier: context.trustTier,
        categorySlug: category.slug,
        categoryName: category.name,
        ...structured.values,
        attachments: [],
        state: verdict.state,
        pinned: false,
        featured: false,
        locked: false,
        helpfulAnswerId: null,
        officialAnswerIds: [],
        replyCount: 0,
        uniqueViews: 0,
        helpfulVotes: 0,
        saveCount: 0,
        participants: [req.user.id],
        hasSupplierReply: false,
        lastReply: null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
        editedAt: null,
        supersededBy: null,
        moderationPenalty: 0,
        riskScore: verdict.score,
        riskSignals: verdict.signals,
        moderation: { autoDecision: verdict.decision, decidedAt: now },
      };

      await dbUnified.insertOne(COLLECTIONS.discussions, discussion);
      await community.bumpUserStats(req.user.id, { discussions: 1 }, { lastPostAt: now });

      if (verdict.decision === 'review') {
        await recordModerationAction({
          action: 'quarantine',
          targetType: 'discussion',
          targetId: discussion.id,
          reason: 'automated_review',
          signals: verdict.signals,
        });
      }

      res.status(201).json({
        discussion: community.toDiscussionCard(discussion, { category }),
        url: community.discussionPath(discussion),
        pendingReview: verdict.decision === 'review',
        message:
          verdict.decision === 'review'
            ? 'Your discussion has been sent for a quick moderator check before it appears publicly.'
            : 'Your discussion has been published.',
      });
    } catch (error) {
      logger.error('Could not create community discussion:', error);
      res.status(500).json({ error: 'Could not create discussion' });
    }
  }
);

/**
 * PATCH /api/v1/community/discussions/:id
 * Edit your own discussion. Edits are always visible as edits.
 */
router.patch(
  '/discussions/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await dbUnified.findOne(COLLECTIONS.discussions, { id: req.params.id });
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      if (discussion.authorId !== req.user.id) {
        return res.status(403).json({ error: 'You can only edit your own discussions.' });
      }
      if (discussion.locked || discussion.state === CONTENT_STATES.REMOVED) {
        return res.status(409).json({ error: 'This discussion can no longer be edited.' });
      }

      const settings = await community.getSettings();
      const update = { updatedAt: new Date().toISOString(), editedAt: new Date().toISOString() };

      if (typeof req.body.title === 'string') {
        const title = stripHtml(req.body.title).trim();
        const check = moderation.validateLength({ title, text: discussion.bodyText });
        if (!check.valid) {
          return res.status(400).json({ error: 'Validation failed', details: check.errors });
        }
        update.title = title;
        // The slug follows the title but the stable id keeps every old link alive.
        update.slug = community.slugify(title);
      }

      if (typeof req.body.body === 'string') {
        const prepared = moderation.prepareBody(req.body.body, {
          clickable: moderation.policyFor(req.viewer.trustTier).linksClickable,
          settings,
        });
        const check = moderation.validateLength({
          title: update.title || discussion.title,
          text: prepared.text,
        });
        if (!check.valid) {
          return res.status(400).json({ error: 'Validation failed', details: check.errors });
        }
        update.bodyHtml = prepared.html;
        update.bodyText = prepared.text;
        update.searchText = prepared.text.slice(0, 5000);
        update.excerpt = community.buildExcerpt(prepared.text);
        update.fingerprint = moderation.fingerprint(prepared.text);
      }

      // Re-assess on edit. Otherwise a member could publish benign content and
      // then edit blocked domains or promotion into a document that is already
      // public — the moderation engine must see the text that will actually be
      // served, not only the text that was first submitted.
      const verdict = moderation.assessContent({
        text: update.bodyText || discussion.bodyText,
        title: update.title || discussion.title,
        trustTier: req.viewer.trustTier,
        settings,
        recentPosts: await recentPostsFor(req.user.id),
      });

      if (verdict.decision === 'reject') {
        await recordModerationAction({
          action: 'quarantine',
          targetType: 'discussion',
          targetId: discussion.id,
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

      update.riskScore = verdict.score;
      update.riskSignals = verdict.signals;

      if (verdict.decision === 'review' && discussion.state === CONTENT_STATES.PUBLISHED) {
        update.state = CONTENT_STATES.QUARANTINED;
      }

      await dbUnified.updateOne(COLLECTIONS.discussions, { id: discussion.id }, { $set: update });

      if (update.state === CONTENT_STATES.QUARANTINED) {
        await recordModerationAction({
          action: 'quarantine',
          targetType: 'discussion',
          targetId: discussion.id,
          reason: 'automated_review_on_edit',
          signals: verdict.signals,
        });
      }

      const updated = await dbUnified.findOne(COLLECTIONS.discussions, { id: discussion.id });
      res.json({
        discussion: community.toDiscussionCard(updated),
        url: community.discussionPath(updated),
        pendingReview: update.state === CONTENT_STATES.QUARANTINED,
        message:
          update.state === CONTENT_STATES.QUARANTINED
            ? 'Your edit has been sent for a quick moderator check before it appears publicly.'
            : 'Your discussion has been updated.',
      });
    } catch (error) {
      logger.error('Could not update community discussion:', error);
      res.status(500).json({ error: 'Could not update discussion' });
    }
  }
);

/**
 * DELETE /api/v1/community/discussions/:id
 * Withdraw your own discussion. Content is soft-deleted so moderation and legal
 * retention obligations can still be met.
 */
router.delete(
  '/discussions/:id',
  writeLimiter,
  requireCommunityEnabled,
  authRequired,
  csrfProtection,
  async (req, res) => {
    try {
      const discussion = await dbUnified.findOne(COLLECTIONS.discussions, { id: req.params.id });
      if (!discussion) {
        return res.status(404).json({ error: 'Discussion not found' });
      }
      const moderatorAction = community.isModerator(req.viewer.user || {});
      if (discussion.authorId !== req.user.id && !moderatorAction) {
        return res.status(403).json({ error: 'You can only withdraw your own discussions.' });
      }

      await dbUnified.updateOne(
        COLLECTIONS.discussions,
        { id: discussion.id },
        {
          $set: {
            state: CONTENT_STATES.REMOVED,
            removedAt: new Date().toISOString(),
            removedBy:
              moderatorAction && discussion.authorId !== req.user.id ? 'moderator' : 'author',
          },
        }
      );
      await recordModerationAction({
        action: 'remove',
        targetType: 'discussion',
        targetId: discussion.id,
        moderatorId: req.user.id,
        reason: discussion.authorId === req.user.id ? 'author_withdrawal' : 'moderator_removal',
      });
      res.json({ removed: true });
    } catch (error) {
      logger.error('Could not remove community discussion:', error);
      res.status(500).json({ error: 'Could not remove discussion' });
    }
  }
);

module.exports = router;
module.exports.__internal = { normaliseStructuredFields };
