/**
 * EventFlow Community — data service
 *
 * Shared helpers for identity, ranking, projections, counters, view
 * de-duplication, reputation and notifications. The route layer stays thin and
 * every rule that a test might want to assert lives here.
 */

'use strict';

const crypto = require('crypto');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { stripHtml } = require('./contentSanitizer');
const { assessFreshness, computeTrustTier } = require('./communityModeration.service');
const {
  COLLECTIONS,
  CONTENT_STATES,
  PUBLIC_STATES,
  COUNTABLE_STATES,
  COMMUNITY_LEVELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  REGIONS,
  REGION_LABELS,
  ANSWER_FILTERS,
  FRESHNESS_FILTERS,
  SEED_CATEGORIES,
  DEFAULT_SETTINGS,
  LIMITS,
  FRESHNESS,
} = require('../models/CommunityContent');

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * Create a stable, immutable public identifier for a discussion. Titles can be
 * edited freely without breaking links because routing keys off this value and
 * treats the slug as decoration.
 * @returns {string} 12-character lower-case identifier.
 */
function createStableId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Create an internal record id following the repository's prefix convention.
 * @param {string} prefix Short record-type prefix.
 * @returns {string} Unique id.
 */
function createRecordId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

/**
 * Trim leading and trailing '-' characters from a string.
 *
 * CodeQL flags `.replace(/^-+|-+$/g, '')` (and the trailing-only variant
 * below) as a possible polynomial regular expression on strings with many
 * repetitions of '-'. Measured directly in this runtime both are linear —
 * 5-8ms at 5,000,000 characters — so the alert does not describe an
 * exploitable behaviour here. Rewritten anyway: a direct character scan
 * carries no ambiguity for a static analyser to flag, and needs no
 * re-verification if the engine ever changes.
 * @param {string} value Candidate string.
 * @returns {string} Value with leading/trailing '-' removed.
 */
function trimHyphens(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charAt(start) === '-') {
    start += 1;
  }
  while (end > start && value.charAt(end - 1) === '-') {
    end -= 1;
  }
  return value.slice(start, end);
}

/**
 * Build a readable URL slug from arbitrary text.
 * @param {string} input Source text.
 * @param {number} [maxLength] Maximum slug length.
 * @returns {string} Slug, or 'discussion' when nothing usable remains.
 */
function slugify(input, maxLength = 80) {
  const slug = trimHyphens(
    trimHyphens(
      stripHtml(String(input || ''))
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
    ).slice(0, maxLength)
  );
  return slug || 'discussion';
}

/**
 * Canonical path for a discussion.
 * @param {Object} discussion Discussion document.
 * @returns {string} Application-relative URL.
 */
function discussionPath(discussion) {
  if (!discussion || !discussion.stableId) {
    return '/community';
  }
  const slug = discussion.slug || slugify(discussion.title);
  return `/community/discussion/${discussion.stableId}/${slug}`;
}

/**
 * Derive a unique public handle for a member, avoiding collisions with existing
 * handles. Handles are deliberately separate from the legal account name.
 * @param {Object} user User record.
 * @param {Set<string>} taken Handles already in use, lower-cased.
 * @returns {string} Public handle.
 */
function deriveHandle(user, taken = new Set()) {
  const source =
    user.communityHandle ||
    user.displayName ||
    user.firstName ||
    (user.name ? String(user.name).split(' ')[0] : '') ||
    'member';
  const base = slugify(source, LIMITS.HANDLE_MAX).replace(/-/g, '') || 'member';
  const padded =
    base.length >= LIMITS.HANDLE_MIN ? base : `${base}member`.slice(0, LIMITS.HANDLE_MAX);

  if (!taken.has(padded.toLowerCase())) {
    return padded;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${padded.slice(0, LIMITS.HANDLE_MAX - 4)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${padded.slice(0, 20)}${crypto.randomBytes(3).toString('hex')}`;
}

// ─── Settings ────────────────────────────────────────────────────────────────

let settingsCache = null;
let settingsCacheExpiry = 0;

/**
 * Read community settings, merged over the documented defaults.
 * @param {Object} [options] Read options.
 * @param {boolean} [options.fresh] Bypass the short-lived cache.
 * @returns {Promise<Object>} Effective settings.
 */
async function getSettings(options = {}) {
  const now = Date.now();
  if (!options.fresh && settingsCache && now < settingsCacheExpiry) {
    return settingsCache;
  }
  let stored = null;
  try {
    stored = await dbUnified.findOne(COLLECTIONS.settings, { id: 'system' });
  } catch (error) {
    logger.warn('Community settings unavailable, using defaults:', error.message);
  }
  settingsCache = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  settingsCacheExpiry = now + 30 * 1000;
  return settingsCache;
}

/** Drop the settings cache after an admin write. */
function invalidateSettingsCache() {
  settingsCache = null;
  settingsCacheExpiry = 0;
}

/**
 * Whether the community is switched on. The flag gates routing only; it never
 * hides half-finished behaviour.
 * @returns {Promise<boolean>} True when enabled.
 */
async function isCommunityEnabled() {
  if (String(process.env.COMMUNITY_ENABLED || '').toLowerCase() === 'false') {
    return false;
  }
  const settings = await getSettings();
  return settings.enabled !== false;
}

// ─── Reputation ──────────────────────────────────────────────────────────────

/**
 * Compute a member's community level from quality-weighted signals. Volume
 * alone never confers status: helpful answers and account age are required, and
 * upheld reports hold a member back.
 * @param {Object} stats Community stats document.
 * @param {Object} [user] User record, for account age.
 * @param {Date} [now] Clock injection for tests.
 * @returns {{key: string, label: string}} Level.
 */
function computeLevel(stats = {}, user = {}, now = new Date()) {
  const upheld = Number(stats.upheldReports || 0);
  if (upheld >= 2) {
    return { key: COMMUNITY_LEVELS[0].key, label: COMMUNITY_LEVELS[0].label };
  }

  const posts = Number(stats.discussions || 0) + Number(stats.replies || 0);
  const helpful = Number(stats.helpfulAnswers || 0);
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;
  const days =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS)
      : 0;

  let level = COMMUNITY_LEVELS[0];
  COMMUNITY_LEVELS.forEach(candidate => {
    if (
      posts >= candidate.minPosts &&
      helpful >= candidate.minHelpful &&
      days >= candidate.minDays
    ) {
      level = candidate;
    }
  });
  return { key: level.key, label: level.label };
}

/**
 * Load or lazily create the stats document for a member.
 * @param {string} userId User id.
 * @returns {Promise<Object>} Stats document.
 */
async function getUserStats(userId) {
  const existing = await dbUnified.findOne(COLLECTIONS.userStats, { userId });
  if (existing) {
    return existing;
  }
  return {
    id: createRecordId('cstat'),
    userId,
    discussions: 0,
    replies: 0,
    helpfulAnswers: 0,
    helpfulVotesReceived: 0,
    officialAnswers: 0,
    upheldReports: 0,
    rejectedContent: 0,
    lastPostAt: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Apply an increment to a member's stats, creating the document when needed.
 * @param {string} userId User id.
 * @param {Object} increments Field increments.
 * @param {Object} [set] Fields to set outright.
 * @returns {Promise<void>} Resolves when written.
 */
async function bumpUserStats(userId, increments = {}, set = {}) {
  if (!userId) {
    return;
  }
  const existing = await dbUnified.findOne(COLLECTIONS.userStats, { userId });
  if (!existing) {
    const base = await getUserStats(userId);
    Object.entries(increments).forEach(([key, value]) => {
      base[key] = Number(base[key] || 0) + Number(value || 0);
    });
    await dbUnified.insertOne(COLLECTIONS.userStats, { ...base, ...set });
    return;
  }
  const update = {};
  if (Object.keys(increments).length > 0) {
    update.$inc = increments;
  }
  if (Object.keys(set).length > 0) {
    update.$set = set;
  }
  if (Object.keys(update).length === 0) {
    return;
  }
  await dbUnified.updateOne(COLLECTIONS.userStats, { userId }, update);
}

// ─── Restrictions and community roles ────────────────────────────────────────

/**
 * Find any active restriction for a member.
 * @param {string} userId User id.
 * @param {Date} [now] Clock injection for tests.
 * @returns {Promise<Object|null>} Active restriction or null.
 */
async function getActiveRestriction(userId, now = new Date()) {
  if (!userId) {
    return null;
  }
  const restrictions = await dbUnified.find(COLLECTIONS.restrictions, { userId, active: true });
  const live = (restrictions || []).filter(item => {
    if (!item.expiresAt) {
      return true;
    }
    return new Date(item.expiresAt).getTime() > now.getTime();
  });
  return live[0] || null;
}

/**
 * A member's effective community role. Global admins are always senior
 * moderators; everyone else takes the role stored on their user record.
 * @param {Object} user User record.
 * @returns {string} Community role.
 */
function communityRoleFor(user = {}) {
  if (user.role === 'admin') {
    return 'senior_moderator';
  }
  const stored = user.communityRole;
  return stored === 'moderator' || stored === 'senior_moderator' ? stored : 'member';
}

/**
 * Whether a member may take moderator actions.
 * @param {Object} user User record.
 * @returns {boolean} True for moderators and above.
 */
function isModerator(user = {}) {
  const role = communityRoleFor(user);
  return role === 'moderator' || role === 'senior_moderator';
}

/**
 * Whether a member may take senior-moderator-only actions.
 * @param {Object} user User record.
 * @returns {boolean} True for senior moderators and admins.
 */
function isSeniorModerator(user = {}) {
  return communityRoleFor(user) === 'senior_moderator';
}

/**
 * Assemble the full posting context for a member: trust tier, restriction,
 * stats and community role. Used by every write endpoint.
 * @param {Object} user User record.
 * @param {Date} [now] Clock injection for tests.
 * @returns {Promise<Object>} Posting context.
 */
async function getPostingContext(user, now = new Date()) {
  if (!user) {
    return { user: null, trustTier: 'restricted', stats: null, restriction: null, role: 'member' };
  }
  const [stats, restriction] = await Promise.all([
    getUserStats(user.id),
    getActiveRestriction(user.id, now),
  ]);
  const role = communityRoleFor(user);
  const trustTier = computeTrustTier({
    user,
    stats,
    restriction,
    isStaff: role !== 'member',
    now,
  });
  return { user, stats, restriction, role, trustTier };
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

/**
 * Transparent popularity score with time decay.
 *
 * Every input is an organic community signal. No subscription tier, payment or
 * supplier ranking factor takes part, and moderation penalties push content
 * down rather than quietly hiding it.
 * @param {Object} discussion Discussion document.
 * @param {Date} [now] Clock injection for tests.
 * @returns {number} Score, higher is more popular.
 */
function popularityScore(discussion = {}, now = new Date()) {
  const replies = Number(discussion.replyCount || 0);
  const participants = Array.isArray(discussion.participants)
    ? discussion.participants.length
    : Number(discussion.participantCount || 0);
  const helpful = Number(discussion.helpfulVotes || 0);
  const saves = Number(discussion.saveCount || 0);
  const views = Number(discussion.uniqueViews || 0);
  const penalties = Number(discussion.moderationPenalty || 0);

  const base =
    replies * 4 + participants * 3 + helpful * 5 + saves * 2 + Math.min(views, 5000) * 0.05;
  const bonus = discussion.helpfulAnswerId ? 8 : 0;
  const official = discussion.officialAnswerIds && discussion.officialAnswerIds.length ? 6 : 0;

  const lastActivity = discussion.lastActivityAt
    ? new Date(discussion.lastActivityAt).getTime()
    : new Date(discussion.createdAt || now).getTime();
  const ageDays = Math.max(0, (now.getTime() - lastActivity) / DAY_MS);
  const decay = 1 / Math.pow(ageDays + 2, 0.55);

  return Math.max(0, (base + bonus + official - penalties * 25) * decay);
}

/**
 * Comparator factory for the supported sort options.
 * @param {string} sort Sort key.
 * @param {Date} [now] Clock injection for tests.
 * @returns {Function} Array comparator.
 */
function comparatorFor(sort, now = new Date()) {
  const time = value => (value ? new Date(value).getTime() : 0);
  switch (sort) {
    case 'newest':
      return (a, b) => time(b.createdAt) - time(a.createdAt);
    case 'oldest':
      return (a, b) => time(a.createdAt) - time(b.createdAt);
    case 'most-replies':
      return (a, b) => Number(b.replyCount || 0) - Number(a.replyCount || 0);
    case 'most-viewed':
      return (a, b) => Number(b.uniqueViews || 0) - Number(a.uniqueViews || 0);
    case 'popular':
      return (a, b) => popularityScore(b, now) - popularityScore(a, now);
    case 'unanswered':
      return (a, b) => time(b.createdAt) - time(a.createdAt);
    case 'latest-activity':
    default:
      return (a, b) =>
        time(b.lastActivityAt || b.createdAt) - time(a.lastActivityAt || a.createdAt);
  }
}

// ─── Views ───────────────────────────────────────────────────────────────────

/**
 * Build a privacy-conscious viewer key.
 *
 * Raw IP addresses are never stored. Signed-in members are keyed by user id;
 * anonymous visitors are keyed by a salted, truncated hash that expires with
 * the view record, so it cannot be used to re-identify anyone later.
 * @param {Object} req Express request.
 * @returns {string} Opaque viewer key.
 */
function viewerKey(req) {
  if (req.user && req.user.id) {
    return `u:${req.user.id}`;
  }
  const salt = process.env.COMMUNITY_VIEW_SALT || process.env.JWT_SECRET || 'community-views';
  const material = `${req.ip || ''}|${req.get ? req.get('user-agent') || '' : ''}`;
  return `a:${crypto.createHmac('sha256', salt).update(material).digest('hex').slice(0, 24)}`;
}

/**
 * Record a unique view for a discussion, de-duplicated per viewer per window.
 * @param {string} discussionId Discussion id.
 * @param {Object} req Express request.
 * @returns {Promise<boolean>} True when a new unique view was recorded.
 */
async function recordView(discussionId, req) {
  try {
    const key = viewerKey(req);
    const windowStart = new Date(Date.now() - FRESHNESS.VIEW_DEDUPE_HOURS * 60 * 60 * 1000);
    const existing = await dbUnified.findOne(COLLECTIONS.views, { discussionId, viewerKey: key });

    if (existing && new Date(existing.viewedAt).getTime() >= windowStart.getTime()) {
      return false;
    }

    const expiresAt = new Date(Date.now() + FRESHNESS.VIEW_DEDUPE_HOURS * 60 * 60 * 1000);
    // `expiresAt` must be a BSON date: MongoDB's TTL monitor ignores strings, so
    // storing an ISO string here would retain viewer keys indefinitely.
    if (existing) {
      await dbUnified.updateOne(
        COLLECTIONS.views,
        { discussionId, viewerKey: key },
        { $set: { viewedAt: new Date(), expiresAt } }
      );
    } else {
      await dbUnified.insertOne(COLLECTIONS.views, {
        id: createRecordId('cview'),
        discussionId,
        viewerKey: key,
        viewedAt: new Date(),
        expiresAt,
      });
    }

    await dbUnified.updateOne(
      COLLECTIONS.discussions,
      { id: discussionId },
      { $inc: { uniqueViews: 1 } }
    );
    return true;
  } catch (error) {
    logger.warn('Could not record community view:', error.message);
    return false;
  }
}

// ─── Projections ─────────────────────────────────────────────────────────────

const MODERATION_ONLY_FIELDS = Object.freeze([
  'moderation',
  'riskSignals',
  'riskScore',
  'fingerprint',
  'authorTrustTier',
  'searchText',
  'reviewNotes',
]);

/**
 * Strip every moderation and risk field from a document before it leaves the
 * server. Moderators receive these fields through the admin API instead.
 * @param {Object} doc Stored document.
 * @returns {Object} Public-safe copy.
 */
function stripInternalFields(doc) {
  if (!doc || typeof doc !== 'object') {
    return doc;
  }
  const copy = { ...doc };
  delete copy._id;
  MODERATION_ONLY_FIELDS.forEach(field => {
    delete copy[field];
  });
  return copy;
}

/**
 * Public author card. Never includes email, phone, address, exact date of birth
 * or any risk signal.
 * @param {Object} author Author summary stored on the post.
 * @returns {Object} Author card.
 */
function publicAuthor(author = {}) {
  return {
    handle: author.handle || null,
    displayName: author.displayName || 'EventFlow member',
    avatarUrl: author.avatarUrl || null,
    accountType: author.accountType || 'customer',
    level: author.level || 'new_member',
    levelLabel: author.levelLabel || 'New member',
    isSupplier: Boolean(author.isSupplier),
    supplierId: author.supplierId || null,
    supplierCategory: author.supplierCategory || null,
    supplierApproved: Boolean(author.supplierApproved),
    isOfficial: Boolean(author.isOfficial),
    isModerator: Boolean(author.isModerator),
    region: author.region || null,
    eventType: author.eventType || null,
    deleted: Boolean(author.deleted),
  };
}

/**
 * Shape a discussion for a list view.
 * @param {Object} discussion Discussion document.
 * @param {Object} [options] View options.
 * @param {Object} [options.category] Resolved category document.
 * @param {Date} [options.now] Clock injection for tests.
 * @returns {Object} Discussion card.
 */
function toDiscussionCard(discussion, options = {}) {
  const { category = null, now = new Date() } = options;
  const freshness = assessFreshness(discussion, now);

  return {
    stableId: discussion.stableId,
    slug: discussion.slug,
    url: discussionPath(discussion),
    title: discussion.title,
    excerpt: discussion.excerpt || '',
    category: category
      ? { slug: category.slug, name: category.name, icon: category.icon }
      : { slug: discussion.categorySlug, name: discussion.categoryName || '', icon: null },
    author: publicAuthor(discussion.author),
    eventType: discussion.eventType || null,
    eventTypeLabel: discussion.eventType ? EVENT_TYPE_LABELS[discussion.eventType] : null,
    region: discussion.region || null,
    regionLabel: discussion.region ? REGION_LABELS[discussion.region] : null,
    tags: Array.isArray(discussion.tags) ? discussion.tags : [],
    replyCount: Number(discussion.replyCount || 0),
    uniqueViews: Number(discussion.uniqueViews || 0),
    helpfulVotes: Number(discussion.helpfulVotes || 0),
    saveCount: Number(discussion.saveCount || 0),
    participantCount: Array.isArray(discussion.participants) ? discussion.participants.length : 0,
    solved: Boolean(discussion.helpfulAnswerId),
    hasOfficialAnswer: Boolean(
      Array.isArray(discussion.officialAnswerIds) && discussion.officialAnswerIds.length
    ),
    hasSupplierReply: Boolean(discussion.hasSupplierReply),
    hasMedia: Boolean(Array.isArray(discussion.attachments) && discussion.attachments.length),
    hasPoll: Boolean(discussion.poll),
    pinned: Boolean(discussion.pinned),
    featured: Boolean(discussion.featured),
    locked: Boolean(discussion.locked),
    state: discussion.state,
    createdAt: discussion.createdAt,
    lastActivityAt: discussion.lastActivityAt || discussion.createdAt,
    lastReply: discussion.lastReply || null,
    freshness: freshness.freshness,
    isOld: freshness.isOld,
    ageDays: freshness.ageDays,
    dormantDays: freshness.dormantDays,
    supersededBy: discussion.supersededBy || null,
  };
}

/**
 * Shape a reply for public display. Withdrawn content keeps its position in the
 * conversation but never leaks its body.
 * @param {Object} reply Reply document.
 * @param {Object} [options] View options.
 * @returns {Object} Reply view model.
 */
function toReplyView(reply, options = {}) {
  const { viewerId = null } = options;
  const withdrawn = reply.state === CONTENT_STATES.REMOVED || reply.state === CONTENT_STATES.HIDDEN;

  return {
    id: reply.id,
    discussionId: reply.discussionStableId,
    author: publicAuthor(reply.author),
    body: withdrawn ? null : reply.bodyHtml || '',
    withdrawn,
    withdrawnReason: withdrawn ? reply.moderationPublicReason || 'Removed by moderators' : null,
    quotedReplyId: reply.quotedReplyId || null,
    quotedExcerpt: reply.quotedExcerpt || null,
    reactions: reply.reactionCounts || {},
    helpfulVotes: Number((reply.reactionCounts || {}).helpful || 0),
    isHelpfulAnswer: Boolean(reply.isHelpfulAnswer),
    isOfficialAnswer: Boolean(reply.isOfficialAnswer),
    officialAnswerVerifiedAt: reply.officialAnswerVerifiedAt || null,
    supplierDisclosure: reply.supplierDisclosure || null,
    createdAt: reply.createdAt,
    editedAt: reply.editedAt || null,
    edited: Boolean(reply.editedAt),
    isOwn: Boolean(viewerId && reply.authorId === viewerId),
    state: reply.state,
    pendingReview: reply.state === CONTENT_STATES.QUARANTINED,
  };
}

/**
 * Build a short plain-text excerpt for cards and meta descriptions.
 * @param {string} text Plain-text body.
 * @param {number} [length] Maximum characters.
 * @returns {string} Excerpt.
 */
function buildExcerpt(text, length = 200) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1).replace(/\s+\S*$/, '')}…`;
}

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * Seed the initial category structure. Idempotent: an existing category is
 * never overwritten, so operator edits survive redeploys.
 * @param {Object} [options] Seed options.
 * @param {boolean} [options.force] Reserved for future use.
 * @returns {Promise<{created: number, existing: number}>} Seed summary.
 */
async function seedCategories(options = {}) {
  void options;
  const existing = await dbUnified.find(COLLECTIONS.categories, {});
  const bySlug = new Map((existing || []).map(item => [item.slug, item]));
  let created = 0;

  for (const definition of SEED_CATEGORIES) {
    if (bySlug.has(definition.slug)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- seeding is a one-off startup task
    await dbUnified.insertOne(COLLECTIONS.categories, {
      id: createRecordId('ccat'),
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      order: definition.order,
      visible: true,
      archived: false,
      rules: definition.rules || null,
      officialSupport: Boolean(definition.officialSupport),
      structuredRecommendations: Boolean(definition.structuredRecommendations),
      marketplaceSafetyNotice: Boolean(definition.marketplaceSafetyNotice),
      discussionCount: 0,
      followerCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    created += 1;
  }

  return { created, existing: (existing || []).length };
}

/**
 * Load visible categories in display order.
 * @param {Object} [options] Read options.
 * @param {boolean} [options.includeHidden] Include hidden and archived entries.
 * @returns {Promise<Object[]>} Categories.
 */
async function listCategories(options = {}) {
  const all = (await dbUnified.find(COLLECTIONS.categories, {})) || [];
  const filtered = options.includeHidden
    ? all
    : all.filter(item => item.visible !== false && item.archived !== true);
  return filtered.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * Create a community notification, de-duplicated by deterministic id so a
 * retry or a double-submit cannot produce two alerts.
 * @param {Object} input Notification input.
 * @returns {Promise<Object|null>} The created notification, or null when skipped.
 */
async function createNotification(input) {
  const {
    id,
    userId,
    type,
    title,
    message,
    actionUrl,
    actionText = 'View discussion',
    icon = '💬',
    priority = 'normal',
    metadata = {},
  } = input || {};

  if (!userId || !title) {
    return null;
  }

  const notificationId = id || createRecordId('cnotif');

  try {
    const existing = await dbUnified.findOne('notifications', { id: notificationId });
    if (existing) {
      return null;
    }
    const notification = {
      id: notificationId,
      userId,
      type: type || 'community',
      title,
      message: message || '',
      actionUrl: actionUrl || '/community',
      actionText,
      icon,
      priority,
      category: 'community',
      metadata,
      read: false,
      createdAt: new Date().toISOString(),
    };
    await dbUnified.insertOne('notifications', notification);
    return notification;
  } catch (error) {
    logger.warn('Could not create community notification:', error.message);
    return null;
  }
}

// ─── Counters ────────────────────────────────────────────────────────────────

/**
 * Recompute the denormalised counters on a discussion from its replies. Called
 * after any state change so the cards can never drift from reality.
 * @param {string} discussionId Discussion id.
 * @returns {Promise<Object|null>} Updated counter values.
 */
async function recalculateDiscussionCounters(discussionId) {
  const replies = (await dbUnified.find(COLLECTIONS.replies, { discussionId })) || [];
  const countable = replies.filter(reply => COUNTABLE_STATES.includes(reply.state));

  const participants = new Set(countable.map(reply => reply.authorId).filter(Boolean));
  const helpfulVotes = countable.reduce(
    (total, reply) => total + Number((reply.reactionCounts || {}).helpful || 0),
    0
  );
  const sorted = countable
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const last = sorted[sorted.length - 1] || null;

  const update = {
    replyCount: countable.length,
    helpfulVotes,
    hasSupplierReply: countable.some(reply => reply.author && reply.author.isSupplier),
    officialAnswerIds: countable.filter(reply => reply.isOfficialAnswer).map(reply => reply.id),
    lastReply: last
      ? {
          replyId: last.id,
          author: publicAuthor(last.author),
          createdAt: last.createdAt,
          excerpt: buildExcerpt(last.bodyText, 120),
        }
      : null,
  };

  const discussion = await dbUnified.findOne(COLLECTIONS.discussions, { id: discussionId });
  if (!discussion) {
    return null;
  }

  update.participants = Array.from(
    new Set([...(discussion.participants || []), ...Array.from(participants)])
  );
  update.lastActivityAt = last ? last.createdAt : discussion.createdAt;

  if (discussion.helpfulAnswerId) {
    const helpfulStillValid = countable.some(reply => reply.id === discussion.helpfulAnswerId);
    if (!helpfulStillValid) {
      update.helpfulAnswerId = null;
    }
  }

  await dbUnified.updateOne(COLLECTIONS.discussions, { id: discussionId }, { $set: update });
  return update;
}

// ─── Query helpers ───────────────────────────────────────────────────────────

/**
 * Whether a viewer may see a piece of content in its current state.
 * @param {Object} doc Discussion or reply.
 * @param {Object} [viewer] Viewer context from getPostingContext.
 * @returns {boolean} True when visible.
 */
function canView(doc, viewer = null) {
  if (!doc) {
    return false;
  }
  if (PUBLIC_STATES.includes(doc.state)) {
    return true;
  }
  if (!viewer || !viewer.user) {
    return false;
  }
  if (viewer.role === 'moderator' || viewer.role === 'senior_moderator') {
    return true;
  }
  // Authors can see their own held or withdrawn content so the pending state is
  // never a silent shadow ban.
  return doc.authorId === viewer.user.id;
}

/**
 * Load every discussion the public may see.
 * @returns {Promise<Object[]>} Discussions in publicly visible states.
 */
async function loadPublicDiscussions() {
  const discussions = await dbUnified.find(COLLECTIONS.discussions, {
    state: { $in: PUBLIC_STATES },
  });
  return discussions || [];
}

/**
 * Apply the list filters shared by the discussion index, category pages and
 * search. Every filter is URL-backed so a filtered view can be shared.
 * @param {Object[]} discussions Candidate discussions.
 * @param {Object} query Express query object.
 * @param {Date} [now] Clock injection for tests.
 * @returns {Object[]} Filtered discussions.
 */
// skipcq: JS-R1005 -- One readable filter pipeline beats a dozen tiny predicates.
function applyFilters(discussions, query = {}, now = new Date()) {
  let results = Array.isArray(discussions) ? discussions : [];

  const category = String(query.category || '').trim();
  if (category) {
    results = results.filter(item => item.categorySlug === category);
  }

  const eventType = String(query.eventType || '').trim();
  if (eventType && EVENT_TYPES.includes(eventType)) {
    results = results.filter(item => item.eventType === eventType);
  }

  const region = String(query.region || '').trim();
  if (region && REGIONS.includes(region)) {
    results = results.filter(item => item.region === region);
  }

  const tag = String(query.tag || '')
    .trim()
    .toLowerCase();
  if (tag) {
    results = results.filter(item => (item.tags || []).some(value => value.toLowerCase() === tag));
  }

  const answer = String(query.answer || 'all');
  if (ANSWER_FILTERS.includes(answer) && answer !== 'all') {
    const predicates = {
      solved: item => Boolean(item.helpfulAnswerId),
      unanswered: item => Number(item.replyCount || 0) === 0,
      official: item => Array.isArray(item.officialAnswerIds) && item.officialAnswerIds.length > 0,
      supplier: item => Boolean(item.hasSupplierReply),
    };
    results = results.filter(predicates[answer]);
  }

  const freshness = String(query.freshness || 'all');
  if (FRESHNESS_FILTERS.includes(freshness) && freshness !== 'all') {
    results = results.filter(item => assessFreshness(item, now).freshness === freshness);
  }

  if (query.media === 'true') {
    results = results.filter(
      item => Array.isArray(item.attachments) && item.attachments.length > 0
    );
  }

  const days = parseInt(String(query.since || ''), 10);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = now.getTime() - days * DAY_MS;
    results = results.filter(item => new Date(item.createdAt).getTime() >= cutoff);
  }

  return results;
}

/**
 * Allocate a member's public handle once and persist it.
 *
 * Handles are the identity used by `/community/member/:handle`, the moderator
 * member view and bulk reporting, so two members must never share one. The
 * handle is derived from the display name, made unique against the handles
 * already taken, and then stored on the user record so it is stable for the
 * life of the account.
 * @param {Object} user User record.
 * @returns {Promise<string>} The member's unique public handle.
 */
async function ensureHandle(user) {
  if (user.communityHandle) {
    return user.communityHandle;
  }

  const existing = (await dbUnified.find('users', { communityHandle: { $type: 'string' } })) || [];
  const taken = new Set(
    existing
      .map(item => item.communityHandle)
      .filter(Boolean)
      .map(value => String(value).toLowerCase())
  );

  const handle = deriveHandle(user, taken);
  try {
    await dbUnified.updateOne('users', { id: user.id }, { $set: { communityHandle: handle } });
    // Keep the in-memory record in step so the rest of the request agrees.
    user.communityHandle = handle;
  } catch (error) {
    logger.warn('Could not persist a community handle:', error.message);
  }
  return handle;
}

/**
 * Build the denormalised author card stored on a post.
 *
 * Only credentials EventFlow can actually prove are included. Nothing here
 * implies vetting, insurance or identity verification.
 * @param {Object} user User record.
 * @param {Object} context Posting context from getPostingContext.
 * @returns {Promise<Object>} Author card.
 */
async function buildAuthorCard(user, context = {}) {
  const stats = context.stats || (await getUserStats(user.id));
  const level = computeLevel(stats, user);
  const role = context.role || communityRoleFor(user);
  const handle = await ensureHandle(user);

  let supplier = null;
  if (user.role === 'supplier') {
    supplier =
      (await dbUnified.findOne('suppliers', { ownerId: user.id })) ||
      (await dbUnified.findOne('suppliers', { userId: user.id }));
  }

  let accountType = 'customer';
  if (user.role === 'supplier') {
    accountType = 'supplier';
  } else if (user.role === 'admin') {
    accountType = 'official';
  }

  return {
    handle,
    displayName:
      user.communityDisplayName ||
      user.displayName ||
      user.firstName ||
      user.name ||
      'EventFlow member',
    avatarUrl: user.avatarUrl || user.photoUrl || null,
    accountType,
    level: level.key,
    levelLabel: level.label,
    isSupplier: Boolean(supplier),
    supplierId: supplier ? supplier.id : null,
    supplierCategory: supplier ? supplier.category || null : null,
    supplierApproved: Boolean(
      supplier && (supplier.approved === true || supplier.status === 'approved')
    ),
    emailVerified: Boolean(user.verified),
    phoneVerified: Boolean(user.phoneVerified),
    isOfficial: user.role === 'admin',
    isModerator: role === 'moderator' || role === 'senior_moderator',
    region: user.communityRegion || null,
    eventType: user.communityEventType || null,
  };
}

/**
 * Fetch a member's posts from the last 24 hours for duplicate and velocity
 * checks.
 * @param {string} userId User id.
 * @returns {Promise<Array<{text: string, createdAt: string}>>} Recent posts.
 */
async function recentPostsFor(userId) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [discussions, replies] = await Promise.all([
    dbUnified.find(COLLECTIONS.discussions, { authorId: userId, createdAt: { $gte: since } }),
    dbUnified.find(COLLECTIONS.replies, { authorId: userId, createdAt: { $gte: since } }),
  ]);
  return [...(discussions || []), ...(replies || [])]
    .map(item => ({ text: item.bodyText || '', createdAt: item.createdAt }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
}

/**
 * Append an entry to the immutable moderation audit trail.
 * @param {Object} input Action details.
 * @returns {Promise<void>} Resolves when written.
 */
async function recordModerationAction(input = {}) {
  try {
    await dbUnified.insertOne(COLLECTIONS.moderationActions, {
      id: createRecordId('cmod'),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      moderatorId: input.moderatorId || 'system',
      moderatorHandle: input.moderatorHandle || 'automated',
      reason: input.reason || null,
      note: input.note || null,
      signals: input.signals || [],
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn('Could not record community moderation action:', error.message);
  }
}

/**
 * Parse and clamp pagination parameters.
 * @param {Object} query Express query object.
 * @returns {{page: number, limit: number, skip: number}} Pagination.
 */
function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const requested = parseInt(query.limit, 10) || LIMITS.PAGE_SIZE_DEFAULT;
  const limit = Math.min(Math.max(1, requested), LIMITS.PAGE_SIZE_MAX);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = {
  createStableId,
  createRecordId,
  slugify,
  discussionPath,
  deriveHandle,
  ensureHandle,
  getSettings,
  invalidateSettingsCache,
  isCommunityEnabled,
  computeLevel,
  getUserStats,
  bumpUserStats,
  getActiveRestriction,
  communityRoleFor,
  isModerator,
  isSeniorModerator,
  getPostingContext,
  popularityScore,
  comparatorFor,
  viewerKey,
  recordView,
  stripInternalFields,
  publicAuthor,
  toDiscussionCard,
  toReplyView,
  buildExcerpt,
  seedCategories,
  listCategories,
  createNotification,
  recalculateDiscussionCounters,
  canView,
  parsePagination,
  loadPublicDiscussions,
  applyFilters,
  buildAuthorCard,
  recentPostsFor,
  recordModerationAction,
  MODERATION_ONLY_FIELDS,
};
