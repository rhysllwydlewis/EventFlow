/**
 * EventFlow Community — admin and moderation centre API
 *
 * Backs /admin/community. Every route requires an authenticated admin or
 * community moderator, every decision is written to the audit trail, and no
 * endpoint here is reachable by an ordinary member.
 */

'use strict';

const express = require('express');
const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, userExtractionMiddleware } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const {
  attachViewer,
  requireModerator,
  requireSeniorModerator,
} = require('../middleware/community');
const community = require('../services/community.service');
const { stripHtml } = require('../services/contentSanitizer');
const {
  COLLECTIONS,
  CONTENT_STATES,
  CONTENT_STATE_VALUES,
  COUNTABLE_STATES,
  REPORT_STATUSES,
  MODERATION_ACTIONS,
  RESTRICTION_TYPES,
  APPEAL_STATUSES,
  LIMITS,
} = require('../models/CommunityContent');

router.use(userExtractionMiddleware, authRequired, attachViewer);

/**
 * Sort, filter and paginate an in-memory list for the admin tables.
 * @param {Object[]} items Records.
 * @param {Object} query Express query object.
 * @param {Function} [matcher] Optional free-text matcher.
 * @returns {{items: Object[], pagination: Object}} Page of records.
 */
function paginate(items, query, matcher) {
  let results = items;
  const search = String(query.q || '')
    .trim()
    .toLowerCase();
  if (search && typeof matcher === 'function') {
    results = results.filter(item => matcher(item, search));
  }
  const { page, limit, skip } = community.parsePagination(query);
  return {
    items: results.slice(skip, skip + limit),
    pagination: {
      page,
      limit,
      total: results.length,
      totalPages: Math.max(1, Math.ceil(results.length / limit)),
    },
  };
}

/**
 * Record a moderator decision with the acting moderator's identity.
 * @param {Object} req Express request.
 * @param {Object} input Action details.
 * @returns {Promise<void>} Resolves when written.
 */
async function audit(req, input) {
  await community.recordModerationAction({
    ...input,
    moderatorId: req.user.id,
    moderatorHandle: (req.dbUser && req.dbUser.communityHandle) || req.user.email || req.user.id,
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/dashboard
 * Community health metrics. These are operational measures, not vanity counts:
 * there is no member total, no "users online" and no raw post volume target.
 */
// skipcq: JS-R1005 -- The dashboard intentionally computes its metrics in one pass.
router.get('/dashboard', apiLimiter, requireModerator, async (req, res) => {
  try {
    const now = Date.now();
    const [discussions, replies, reports, appeals, restrictions, actions] = await Promise.all([
      dbUnified.find(COLLECTIONS.discussions, {}),
      dbUnified.find(COLLECTIONS.replies, {}),
      dbUnified.find(COLLECTIONS.reports, {}),
      dbUnified.find(COLLECTIONS.appeals, {}),
      dbUnified.find(COLLECTIONS.restrictions, { active: true }),
      dbUnified.find(COLLECTIONS.moderationActions, {}),
    ]);

    const published = (discussions || []).filter(item => item.state === CONTENT_STATES.PUBLISHED);
    const publishedReplies = (replies || []).filter(item => COUNTABLE_STATES.includes(item.state));
    const repliesByDiscussion = new Map();
    publishedReplies.forEach(reply => {
      const list = repliesByDiscussion.get(reply.discussionId) || [];
      list.push(reply);
      repliesByDiscussion.set(reply.discussionId, list);
    });

    const firstReplyDelays = published
      .map(discussion => {
        const list = (repliesByDiscussion.get(discussion.id) || []).sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        if (list.length === 0) {
          return null;
        }
        return new Date(list[0].createdAt).getTime() - new Date(discussion.createdAt).getTime();
      })
      .filter(value => value !== null);

    const medianHours = values => {
      if (values.length === 0) {
        return null;
      }
      const sorted = values.slice().sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
      return Math.round((median / (60 * 60 * 1000)) * 10) / 10;
    };

    const openReports = (reports || []).filter(
      item => item.status === 'open' || item.status === 'escalated'
    );
    const resolved = (reports || []).filter(item => item.resolvedAt);
    const resolutionTimes = resolved.map(
      item => new Date(item.resolvedAt).getTime() - new Date(item.createdAt).getTime()
    );

    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const activeContributors = new Set(
      [...published, ...publishedReplies]
        .filter(item => new Date(item.createdAt).getTime() >= thirtyDaysAgo)
        .map(item => item.authorId)
    );

    res.json({
      content: {
        discussions: published.length,
        replies: publishedReplies.length,
        quarantined: (discussions || [])
          .concat(replies || [])
          .filter(item => item.state === CONTENT_STATES.QUARANTINED).length,
        unanswered: published.filter(item => !(repliesByDiscussion.get(item.id) || []).length)
          .length,
        answeredPercentage:
          published.length === 0
            ? 0
            : Math.round(
                (published.filter(item => (repliesByDiscussion.get(item.id) || []).length > 0)
                  .length /
                  published.length) *
                  100
              ),
        helpfulAnswerRate:
          published.length === 0
            ? 0
            : Math.round(
                (published.filter(item => item.helpfulAnswerId).length / published.length) * 100
              ),
        officialAnswers: publishedReplies.filter(item => item.isOfficialAnswer).length,
        supplierContributions: publishedReplies.filter(
          item => item.author && item.author.isSupplier
        ).length,
      },
      responsiveness: {
        medianHoursToFirstReply: medianHours(firstReplyDelays),
        medianHoursToReportResolution: medianHours(resolutionTimes),
        activeContributors30Days: activeContributors.size,
      },
      safety: {
        openReports: openReports.length,
        urgentReports: openReports.filter(item => item.priority === 'urgent').length,
        escalatedReports: (reports || []).filter(item => item.status === 'escalated').length,
        spamPrevented: (actions || []).filter(
          item => item.action === 'quarantine' && String(item.reason || '').startsWith('automated')
        ).length,
        activeRestrictions: (restrictions || []).filter(item => !item.selfApplied).length,
        openAppeals: (appeals || []).filter(item => item.status === 'open').length,
      },
    });
  } catch (error) {
    logger.error('Could not build community admin dashboard:', error);
    res.status(500).json({ error: 'Could not load the dashboard' });
  }
});

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/categories
 * All categories including hidden and archived ones.
 */
router.get('/categories', apiLimiter, requireModerator, async (req, res) => {
  try {
    const categories = await community.listCategories({ includeHidden: true });
    res.json({ categories: categories.map(community.stripInternalFields) });
  } catch (error) {
    logger.error('Could not list community categories for admin:', error);
    res.status(500).json({ error: 'Could not load categories' });
  }
});

/**
 * POST /api/v1/admin/community/categories
 * Create a category.
 */
router.post(
  '/categories',
  writeLimiter,
  requireSeniorModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const name = stripHtml(String(req.body.name || '')).trim();
      if (name.length < 3) {
        return res.status(400).json({ error: 'Give the category a name.' });
      }
      const slug = community.slugify(req.body.slug || name);
      const existing = await dbUnified.findOne(COLLECTIONS.categories, { slug });
      if (existing) {
        return res.status(409).json({ error: 'A category with that address already exists.' });
      }

      const category = {
        id: community.createRecordId('ccat'),
        slug,
        name,
        description: stripHtml(String(req.body.description || '')).slice(0, 500),
        icon: stripHtml(String(req.body.icon || '💬')).slice(0, 8),
        order: Number(req.body.order) || 999,
        visible: req.body.visible !== false,
        archived: false,
        rules: stripHtml(String(req.body.rules || '')).slice(0, 2000) || null,
        officialSupport: Boolean(req.body.officialSupport),
        structuredRecommendations: Boolean(req.body.structuredRecommendations),
        marketplaceSafetyNotice: Boolean(req.body.marketplaceSafetyNotice),
        discussionCount: 0,
        followerCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.insertOne(COLLECTIONS.categories, category);
      await audit(req, { action: 'approve', targetType: 'category', targetId: category.id });
      res.status(201).json({ category });
    } catch (error) {
      logger.error('Could not create community category:', error);
      res.status(500).json({ error: 'Could not create category' });
    }
  }
);

/**
 * PATCH /api/v1/admin/community/categories/:id
 * Rename, reorder, hide or archive a category.
 */
router.patch(
  '/categories/:id',
  writeLimiter,
  requireSeniorModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const category = await dbUnified.findOne(COLLECTIONS.categories, { id: req.params.id });
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const update = { updatedAt: new Date().toISOString() };
      if (typeof req.body.name === 'string') {
        update.name = stripHtml(req.body.name).trim().slice(0, 120);
      }
      if (typeof req.body.description === 'string') {
        update.description = stripHtml(req.body.description).slice(0, 500);
      }
      if (typeof req.body.rules === 'string') {
        update.rules = stripHtml(req.body.rules).slice(0, 2000) || null;
      }
      if (typeof req.body.icon === 'string') {
        update.icon = stripHtml(req.body.icon).slice(0, 8);
      }
      if (req.body.order !== undefined) {
        update.order = Number(req.body.order) || 0;
      }
      if (req.body.visible !== undefined) {
        update.visible = Boolean(req.body.visible);
      }
      if (req.body.archived !== undefined) {
        update.archived = Boolean(req.body.archived);
      }

      await dbUnified.updateOne(COLLECTIONS.categories, { id: category.id }, { $set: update });
      await audit(req, { action: 'move', targetType: 'category', targetId: category.id });
      res.json({ category: { ...category, ...update } });
    } catch (error) {
      logger.error('Could not update community category:', error);
      res.status(500).json({ error: 'Could not update category' });
    }
  }
);

// ─── Content moderation ──────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/content
 * Discussions and replies in any state, including the risk signals that are
 * never exposed on the public API.
 */
router.get('/content', apiLimiter, requireModerator, async (req, res) => {
  try {
    const type = req.query.type === 'reply' ? 'reply' : 'discussion';
    const collection = type === 'reply' ? COLLECTIONS.replies : COLLECTIONS.discussions;
    const filter = {};
    if (CONTENT_STATE_VALUES.includes(req.query.state)) {
      filter.state = req.query.state;
    }
    const records = (await dbUnified.find(collection, filter)) || [];
    const sorted = records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const page = paginate(sorted, req.query, (item, search) =>
      `${item.title || ''} ${item.bodyText || ''} ${(item.author || {}).handle || ''}`
        .toLowerCase()
        .includes(search)
    );

    res.json({
      type,
      items: page.items.map(item => ({
        id: item.id,
        stableId: item.stableId || item.discussionStableId || null,
        title: item.title || null,
        excerpt: community.buildExcerpt(item.bodyText, 240),
        author: community.publicAuthor(item.author),
        authorId: item.authorId,
        state: item.state,
        categorySlug: item.categorySlug || null,
        createdAt: item.createdAt,
        riskScore: Number(item.riskScore || 0),
        riskSignals: item.riskSignals || [],
        url: item.stableId ? community.discussionPath(item) : null,
      })),
      pagination: page.pagination,
    });
  } catch (error) {
    logger.error('Could not list community content for admin:', error);
    res.status(500).json({ error: 'Could not load content' });
  }
});

/**
 * POST /api/v1/admin/community/content/:type/:id/action
 * Apply a moderator action to a discussion or reply.
 */
// skipcq: JS-R1005 -- One action table keeps every moderation transition auditable in one place.
router.post(
  '/content/:type/:id/action',
  writeLimiter,
  requireModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const type = req.params.type === 'reply' ? 'reply' : 'discussion';
      const collection = type === 'reply' ? COLLECTIONS.replies : COLLECTIONS.discussions;
      const action = String(req.body.action || '').trim();
      if (!MODERATION_ACTIONS.includes(action)) {
        return res.status(400).json({ error: 'Unknown moderation action' });
      }

      const record = await dbUnified.findOne(collection, { id: req.params.id });
      if (!record) {
        return res.status(404).json({ error: 'Content not found' });
      }

      const note = stripHtml(String(req.body.note || '')).slice(0, LIMITS.MODERATION_NOTE_MAX);
      const publicReason = stripHtml(String(req.body.publicReason || '')).slice(0, 200);
      const now = new Date().toISOString();
      const update = { updatedAt: now };

      const stateByAction = {
        hide: CONTENT_STATES.HIDDEN,
        remove: CONTENT_STATES.REMOVED,
        quarantine: CONTENT_STATES.QUARANTINED,
        approve: CONTENT_STATES.PUBLISHED,
        restore: CONTENT_STATES.PUBLISHED,
        archive: CONTENT_STATES.ARCHIVED,
        mark_spam: CONTENT_STATES.REMOVED,
      };

      if (stateByAction[action]) {
        update.state = stateByAction[action];
        update.moderationPublicReason = publicReason || null;
      }
      if (action === 'lock') {
        update.locked = true;
      }
      if (action === 'unlock') {
        update.locked = false;
      }
      if (action === 'pin') {
        update.pinned = true;
      }
      if (action === 'unpin') {
        update.pinned = false;
      }
      if (action === 'feature') {
        update.featured = true;
      }
      if (action === 'unfeature') {
        update.featured = false;
      }
      if (action === 'mark_spam') {
        update.moderationPenalty = Number(record.moderationPenalty || 0) + 1;
      }
      if (action === 'move' && type === 'discussion') {
        const category = await dbUnified.findOne(COLLECTIONS.categories, {
          slug: String(req.body.categorySlug || ''),
        });
        if (!category) {
          return res.status(400).json({ error: 'Unknown destination category' });
        }
        update.categorySlug = category.slug;
        update.categoryName = category.name;
      }
      if (action === 'supersede' && type === 'discussion') {
        const canonical = await dbUnified.findOne(COLLECTIONS.discussions, {
          stableId: String(req.body.canonicalStableId || ''),
        });
        if (!canonical) {
          return res.status(400).json({ error: 'Unknown canonical discussion' });
        }
        update.supersededBy = canonical.id;
        update.state = CONTENT_STATES.SUPERSEDED;
        update.locked = true;
        await dbUnified.insertOne(COLLECTIONS.canonicalLinks, {
          id: community.createRecordId('ccanon'),
          fromDiscussionId: record.id,
          toDiscussionId: canonical.id,
          createdBy: req.user.id,
          createdAt: now,
        });
      }
      if (action === 'redact') {
        // Redaction rewrites the stored body: the personal data is gone, and the
        // fact that a redaction happened is recorded in the audit trail.
        const redacted = stripHtml(String(req.body.body || '')).slice(0, LIMITS.BODY_MAX);
        if (!redacted) {
          return res.status(400).json({ error: 'Provide the redacted text.' });
        }
        update.bodyHtml = redacted;
        update.bodyText = redacted;
        update.excerpt = community.buildExcerpt(redacted);
        update.redactedAt = now;
      }
      if (typeof req.body.moderatorNotice === 'string' && type === 'discussion') {
        update.moderatorNotice = stripHtml(req.body.moderatorNotice).slice(0, 300) || null;
      }

      await dbUnified.updateOne(collection, { id: record.id }, { $set: update });

      const discussionId = type === 'reply' ? record.discussionId : record.id;
      await community.recalculateDiscussionCounters(discussionId);
      await audit(req, {
        action,
        targetType: type,
        targetId: record.id,
        reason: String(req.body.reason || '').slice(0, 120) || null,
        note,
      });

      if (record.authorId) {
        await community.createNotification({
          id: `cnotif_mod_${action}_${record.id}`,
          userId: record.authorId,
          type: 'community_moderation',
          title: moderationNoticeTitle(action),
          message: publicReason || 'You can appeal this decision from the community help page.',
          actionUrl: '/community/help#appeals',
          icon: '🛡️',
          priority: 'high',
        });
      }

      res.json({ applied: action, state: update.state || record.state });
    } catch (error) {
      logger.error('Could not apply community moderation action:', error);
      res.status(500).json({ error: 'Could not apply the action' });
    }
  }
);

/**
 * Human-readable heading for a moderation notification.
 * @param {string} action Moderation action key.
 * @returns {string} Notification title.
 */
function moderationNoticeTitle(action) {
  const titles = {
    hide: 'Your post has been hidden',
    remove: 'Your post has been removed',
    quarantine: 'Your post is being reviewed',
    approve: 'Your post is now published',
    restore: 'Your post has been restored',
    archive: 'Your discussion has been archived',
    lock: 'Your discussion has been locked',
    move: 'Your discussion has been moved',
    redact: 'Personal information was removed from your post',
    supersede: 'Your discussion now points to a newer one',
    mark_spam: 'Your post was removed as spam',
  };
  return titles[action] || 'A moderator has reviewed your post';
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/reports
 * The moderation queue, highest priority and oldest first.
 */
router.get('/reports', apiLimiter, requireModerator, async (req, res) => {
  try {
    const filter = {};
    if (REPORT_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const reports = (await dbUnified.find(COLLECTIONS.reports, filter)) || [];
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    const sorted = reports.sort((a, b) => {
      const byPriority = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
      return byPriority !== 0 ? byPriority : new Date(a.createdAt) - new Date(b.createdAt);
    });

    const page = paginate(sorted, req.query, (item, search) =>
      `${item.reasonLabel || ''} ${item.detail || ''} ${(item.snapshot || {}).title || ''}`
        .toLowerCase()
        .includes(search)
    );

    res.json({
      reports: page.items.map(community.stripInternalFields),
      pagination: page.pagination,
    });
  } catch (error) {
    logger.error('Could not load community reports:', error);
    res.status(500).json({ error: 'Could not load reports' });
  }
});

/**
 * PATCH /api/v1/admin/community/reports/:id
 * Assign, decide or escalate a report and tell the reporter the outcome.
 */
router.patch('/reports/:id', writeLimiter, requireModerator, csrfProtection, async (req, res) => {
  try {
    const report = await dbUnified.findOne(COLLECTIONS.reports, { id: req.params.id });
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (report.status === 'escalated' && !community.isSeniorModerator(req.viewer.user || {})) {
      return res
        .status(403)
        .json({ error: 'Forbidden', message: 'This report needs a senior moderator.' });
    }

    const update = { updatedAt: new Date().toISOString() };
    if (REPORT_STATUSES.includes(req.body.status)) {
      update.status = req.body.status;
      if (['actioned', 'dismissed'].includes(req.body.status)) {
        update.resolvedAt = new Date().toISOString();
      }
    }
    if (req.body.assignToMe === true) {
      update.assignedTo = req.user.id;
      update.status = update.status || 'in_review';
    }
    if (typeof req.body.decision === 'string') {
      update.decision = stripHtml(req.body.decision).slice(0, 120);
    }
    if (typeof req.body.decisionReason === 'string') {
      update.decisionReason = stripHtml(req.body.decisionReason).slice(0, 1000);
    }
    if (typeof req.body.actionTaken === 'string') {
      update.actionTaken = stripHtml(req.body.actionTaken).slice(0, 120);
    }

    await dbUnified.updateOne(COLLECTIONS.reports, { id: report.id }, { $set: update });

    // An upheld report counts against the reported member's standing, which is
    // what pulls their trust tier down.
    if (update.status === 'actioned' && report.reportedUserId) {
      await community.bumpUserStats(report.reportedUserId, { upheldReports: 1 });
    }

    if (report.reporterId && update.resolvedAt) {
      await community.createNotification({
        id: `cnotif_report_${report.id}`,
        userId: report.reporterId,
        type: 'community_report_outcome',
        title: 'Thank you for your report',
        message:
          update.status === 'actioned'
            ? 'We reviewed the content you reported and took action.'
            : 'We reviewed the content you reported and found it did not break our guidelines.',
        actionUrl: '/community/guidelines',
        icon: '🛡️',
      });
    }

    await audit(req, {
      action: update.status === 'actioned' ? 'approve' : 'restore',
      targetType: 'report',
      targetId: report.id,
      reason: update.decision || null,
      note: update.decisionReason || null,
    });

    res.json({ report: { ...community.stripInternalFields(report), ...update } });
  } catch (error) {
    logger.error('Could not update community report:', error);
    res.status(500).json({ error: 'Could not update report' });
  }
});

// ─── Members and restrictions ────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/members/:handle
 * Everything a moderator needs about one account: their posts, their reports
 * and their standing. Contact details are deliberately not included.
 */
router.get('/members/:handle', apiLimiter, requireModerator, async (req, res) => {
  try {
    const handle = String(req.params.handle || '').trim();
    const [discussions, replies] = await Promise.all([
      dbUnified.find(COLLECTIONS.discussions, { 'author.handle': handle }),
      dbUnified.find(COLLECTIONS.replies, { 'author.handle': handle }),
    ]);
    const sample = (discussions || [])[0] || (replies || [])[0];
    if (!sample) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const [stats, reports, restrictions] = await Promise.all([
      community.getUserStats(sample.authorId),
      dbUnified.find(COLLECTIONS.reports, { reportedUserId: sample.authorId }),
      dbUnified.find(COLLECTIONS.restrictions, { userId: sample.authorId }),
    ]);

    res.json({
      member: community.publicAuthor(sample.author),
      userId: sample.authorId,
      stats: community.stripInternalFields(stats),
      posts: [...(discussions || []), ...(replies || [])]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50)
        .map(item => ({
          id: item.id,
          type: item.discussionId ? 'reply' : 'discussion',
          title: item.title || null,
          excerpt: community.buildExcerpt(item.bodyText, 160),
          state: item.state,
          createdAt: item.createdAt,
          riskScore: Number(item.riskScore || 0),
          riskSignals: item.riskSignals || [],
        })),
      reports: (reports || []).map(community.stripInternalFields),
      restrictions: (restrictions || []).filter(item => !item.selfApplied),
    });
  } catch (error) {
    logger.error('Could not load community member for admin:', error);
    res.status(500).json({ error: 'Could not load member' });
  }
});

/**
 * POST /api/v1/admin/community/restrictions
 * Warn, mute, restrict or suspend a member. The member is always told.
 */
router.post('/restrictions', writeLimiter, requireModerator, csrfProtection, async (req, res) => {
  try {
    const type = String(req.body.type || '').trim();
    if (!RESTRICTION_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Unknown restriction type' });
    }
    if (type === 'suspended' && !community.isSeniorModerator(req.viewer.user || {})) {
      return res
        .status(403)
        .json({ error: 'Forbidden', message: 'Only a senior moderator can suspend an account.' });
    }

    const userId = String(req.body.userId || '').trim();
    const user = await dbUnified.findOne('users', { id: userId });
    if (!user) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const days = Number(req.body.days);
    const restriction = {
      id: community.createRecordId('crestrict'),
      userId,
      type,
      active: true,
      selfApplied: false,
      reason: stripHtml(String(req.body.reason || '')).slice(0, 200),
      publicReason: stripHtml(String(req.body.publicReason || '')).slice(0, 200) || null,
      note: stripHtml(String(req.body.note || '')).slice(0, LIMITS.MODERATION_NOTE_MAX),
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      expiresAt:
        Number.isFinite(days) && days > 0
          ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
          : null,
    };

    await dbUnified.insertOne(COLLECTIONS.restrictions, restriction);
    await audit(req, {
      action: 'restrict',
      targetType: 'member',
      targetId: userId,
      reason: restriction.reason,
      note: restriction.note,
    });

    // No shadow bans: the member is told what happened and how to appeal.
    await community.createNotification({
      id: `cnotif_restrict_${restriction.id}`,
      userId,
      type: 'community_moderation',
      title:
        type === 'warned'
          ? 'A moderator has sent you a warning'
          : 'Your community access has been restricted',
      message:
        restriction.publicReason || 'You can appeal this decision from the community help page.',
      actionUrl: '/community/help#appeals',
      icon: '🛡️',
      priority: 'high',
    });

    res.status(201).json({ restriction });
  } catch (error) {
    logger.error('Could not create community restriction:', error);
    res.status(500).json({ error: 'Could not apply restriction' });
  }
});

/**
 * DELETE /api/v1/admin/community/restrictions/:id
 * Lift a restriction.
 */
router.delete(
  '/restrictions/:id',
  writeLimiter,
  requireModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const restriction = await dbUnified.findOne(COLLECTIONS.restrictions, { id: req.params.id });
      if (!restriction || restriction.selfApplied) {
        return res.status(404).json({ error: 'Restriction not found' });
      }
      await dbUnified.updateOne(
        COLLECTIONS.restrictions,
        { id: restriction.id },
        { $set: { active: false, liftedBy: req.user.id, liftedAt: new Date().toISOString() } }
      );
      await audit(req, {
        action: 'unrestrict',
        targetType: 'member',
        targetId: restriction.userId,
      });
      res.json({ lifted: true });
    } catch (error) {
      logger.error('Could not lift community restriction:', error);
      res.status(500).json({ error: 'Could not lift restriction' });
    }
  }
);

// ─── Appeals ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/appeals
 * The appeals queue.
 */
router.get('/appeals', apiLimiter, requireSeniorModerator, async (req, res) => {
  try {
    const appeals = (await dbUnified.find(COLLECTIONS.appeals, {})) || [];
    const page = paginate(
      appeals.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      req.query,
      (item, search) =>
        String(item.message || '')
          .toLowerCase()
          .includes(search)
    );
    res.json({
      appeals: page.items.map(community.stripInternalFields),
      pagination: page.pagination,
    });
  } catch (error) {
    logger.error('Could not load community appeals:', error);
    res.status(500).json({ error: 'Could not load appeals' });
  }
});

/**
 * PATCH /api/v1/admin/community/appeals/:id
 * Resolve an appeal and tell the member the outcome.
 */
router.patch(
  '/appeals/:id',
  writeLimiter,
  requireSeniorModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const appeal = await dbUnified.findOne(COLLECTIONS.appeals, { id: req.params.id });
      if (!appeal) {
        return res.status(404).json({ error: 'Appeal not found' });
      }
      const status = String(req.body.status || '').trim();
      if (!APPEAL_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Unknown appeal status' });
      }

      const update = {
        status,
        decision: stripHtml(String(req.body.decision || '')).slice(0, 200),
        decisionReason: stripHtml(String(req.body.decisionReason || '')).slice(0, 1000),
        resolvedBy: req.user.id,
        resolvedAt: new Date().toISOString(),
      };
      await dbUnified.updateOne(COLLECTIONS.appeals, { id: appeal.id }, { $set: update });

      await community.createNotification({
        id: `cnotif_appeal_${appeal.id}`,
        userId: appeal.userId,
        type: 'community_appeal_outcome',
        title:
          status === 'overturned' ? 'Your appeal was successful' : 'We have reviewed your appeal',
        message: update.decisionReason || 'Thank you for taking the time to appeal.',
        actionUrl: '/community/help#appeals',
        icon: '⚖️',
        priority: 'high',
      });

      await audit(req, {
        action: status === 'overturned' ? 'restore' : 'approve',
        targetType: 'appeal',
        targetId: appeal.id,
        reason: update.decision,
      });

      res.json({ appeal: { ...community.stripInternalFields(appeal), ...update } });
    } catch (error) {
      logger.error('Could not resolve community appeal:', error);
      res.status(500).json({ error: 'Could not resolve appeal' });
    }
  }
);

// ─── Settings and audit ──────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/community/settings
 * Current community settings, including the domain allow and block lists.
 */
router.get('/settings', apiLimiter, requireSeniorModerator, async (req, res) => {
  try {
    const settings = await community.getSettings({ fresh: true });
    res.json({ settings });
  } catch (error) {
    logger.error('Could not load community settings:', error);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

/**
 * PATCH /api/v1/admin/community/settings
 * Update community settings.
 */
router.patch(
  '/settings',
  writeLimiter,
  requireSeniorModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const current = await community.getSettings({ fresh: true });
      const update = { ...current };

      const booleans = [
        'enabled',
        'requireVerifiedEmail',
        'requireAdultDeclaration',
        'quarantineLowTrustLinks',
      ];
      booleans.forEach(key => {
        if (req.body[key] !== undefined) {
          update[key] = Boolean(req.body[key]);
        }
      });

      const numbers = [
        'autoArchiveDays',
        'oldThreadWarningDays',
        'dormantThreadReviewDays',
        'maxDiscussionsPerDay',
        'maxRepliesPerHour',
        'minimumAgeYears',
      ];
      numbers.forEach(key => {
        if (req.body[key] !== undefined && Number.isFinite(Number(req.body[key]))) {
          update[key] = Number(req.body[key]);
        }
      });

      ['blockedDomains', 'allowedDomains'].forEach(key => {
        if (Array.isArray(req.body[key])) {
          update[key] = req.body[key]
            // Bound the input before any pattern runs: a hostname is never
            // longer than 253 characters, and truncating first means a very
            // long crafted string cannot drive backtracking.
            .map(value =>
              String(value || '')
                .trim()
                .toLowerCase()
                .slice(0, 253)
            )
            .map(value => {
              const withoutScheme = value.startsWith('https://')
                ? value.slice(8)
                : value.startsWith('http://')
                  ? value.slice(7)
                  : value;
              const withoutWww = withoutScheme.startsWith('www.')
                ? withoutScheme.slice(4)
                : withoutScheme;
              const slash = withoutWww.indexOf('/');
              return slash === -1 ? withoutWww : withoutWww.slice(0, slash);
            })
            .filter(Boolean)
            .slice(0, 2000);
        }
      });

      update.id = 'system';
      update.updatedAt = new Date().toISOString();
      update.updatedBy = req.user.id;

      const existing = await dbUnified.findOne(COLLECTIONS.settings, { id: 'system' });
      if (existing) {
        await dbUnified.updateOne(COLLECTIONS.settings, { id: 'system' }, { $set: update });
      } else {
        await dbUnified.insertOne(COLLECTIONS.settings, update);
      }
      community.invalidateSettingsCache();

      await audit(req, { action: 'approve', targetType: 'settings', targetId: 'system' });
      res.json({ settings: update });
    } catch (error) {
      logger.error('Could not update community settings:', error);
      res.status(500).json({ error: 'Could not update settings' });
    }
  }
);

/**
 * GET /api/v1/admin/community/audit
 * The moderation audit trail.
 */
router.get('/audit', apiLimiter, requireModerator, async (req, res) => {
  try {
    const actions = (await dbUnified.find(COLLECTIONS.moderationActions, {})) || [];
    const page = paginate(
      actions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      req.query,
      (item, search) =>
        `${item.action} ${item.targetId} ${item.moderatorHandle || ''} ${item.reason || ''}`
          .toLowerCase()
          .includes(search)
    );
    res.json({
      actions: page.items.map(community.stripInternalFields),
      pagination: page.pagination,
    });
  } catch (error) {
    logger.error('Could not load community audit trail:', error);
    res.status(500).json({ error: 'Could not load audit trail' });
  }
});

/**
 * POST /api/v1/admin/community/seed-categories
 * Re-run the idempotent category seed. Never overwrites operator edits and
 * never creates users, discussions or replies.
 */
router.post(
  '/seed-categories',
  writeLimiter,
  requireSeniorModerator,
  csrfProtection,
  async (req, res) => {
    try {
      const result = await community.seedCategories();
      await audit(req, { action: 'approve', targetType: 'category', targetId: 'seed' });
      res.json(result);
    } catch (error) {
      logger.error('Could not seed community categories:', error);
      res.status(500).json({ error: 'Could not seed categories' });
    }
  }
);

module.exports = router;
module.exports.__internal = { paginate, moderationNoticeTitle };
