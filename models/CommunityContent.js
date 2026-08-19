/**
 * EventFlow Community — shared domain constants
 *
 * Single source of truth for collection names, lifecycle states, taxonomy and
 * validation limits used by the community routes, services and admin centre.
 * Keeping these in one module means the API, the moderation engine, the seed
 * script and the tests cannot drift apart.
 */

'use strict';

// ─── Collections ─────────────────────────────────────────────────────────────

const COLLECTIONS = {
  categories: 'community_categories',
  discussions: 'community_discussions',
  replies: 'community_replies',
  reactions: 'community_reactions',
  bookmarks: 'community_bookmarks',
  follows: 'community_follows',
  reports: 'community_reports',
  moderationActions: 'community_moderation_actions',
  appeals: 'community_appeals',
  userStats: 'community_user_stats',
  views: 'community_views',
  drafts: 'community_drafts',
  settings: 'community_settings',
  pollVotes: 'community_poll_votes',
  canonicalLinks: 'community_canonical_links',
  restrictions: 'community_restrictions',
};

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Content lifecycle states. `published` is the only state visible to the public;
 * everything else is either awaiting a decision or has been withdrawn.
 */
const CONTENT_STATES = Object.freeze({
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  PUBLISHED: 'published',
  QUARANTINED: 'quarantined',
  HIDDEN: 'hidden',
  REMOVED: 'removed',
  ARCHIVED: 'archived',
  SUPERSEDED: 'superseded',
});

const CONTENT_STATE_VALUES = Object.freeze(Object.values(CONTENT_STATES));

/** States whose content may be served to anonymous visitors and search engines. */
const PUBLIC_STATES = Object.freeze([
  CONTENT_STATES.PUBLISHED,
  CONTENT_STATES.ARCHIVED,
  CONTENT_STATES.SUPERSEDED,
]);

/** States that still count towards reply counters and "answered" calculations. */
const COUNTABLE_STATES = Object.freeze([CONTENT_STATES.PUBLISHED, CONTENT_STATES.ARCHIVED]);

/** States that should never be indexed by search engines. */
const NOINDEX_STATES = Object.freeze([
  CONTENT_STATES.DRAFT,
  CONTENT_STATES.PENDING_REVIEW,
  CONTENT_STATES.QUARANTINED,
  CONTENT_STATES.HIDDEN,
  CONTENT_STATES.REMOVED,
  CONTENT_STATES.SUPERSEDED,
]);

// ─── Taxonomy ────────────────────────────────────────────────────────────────

/**
 * EventFlow serves the whole event market, so the community taxonomy is not
 * wedding-only. These values mirror the event types already used across the
 * planner, marketplace and public calendar.
 */
const EVENT_TYPES = Object.freeze([
  'wedding',
  'birthday',
  'party',
  'corporate',
  'conference',
  'festival',
  'charity',
  'baby-shower',
  'anniversary',
  'christening',
  'funeral-memorial',
  'community-event',
  'other',
]);

const EVENT_TYPE_LABELS = Object.freeze({
  wedding: 'Wedding',
  birthday: 'Birthday',
  party: 'Party',
  corporate: 'Corporate event',
  conference: 'Conference',
  festival: 'Festival',
  charity: 'Charity event',
  'baby-shower': 'Baby shower',
  anniversary: 'Anniversary',
  christening: 'Christening or naming day',
  'funeral-memorial': 'Funeral or memorial',
  'community-event': 'Community event',
  other: 'Other',
});

/**
 * Broad UK regions only. Exact venues, addresses and postcodes are never stored
 * on a community post — see docs/compliance/community-dpia.md.
 */
const REGIONS = Object.freeze([
  'london',
  'south-east',
  'south-west',
  'east-of-england',
  'east-midlands',
  'west-midlands',
  'yorkshire-and-the-humber',
  'north-west',
  'north-east',
  'wales',
  'scotland',
  'northern-ireland',
  'channel-islands-and-isle-of-man',
  'outside-uk',
]);

const REGION_LABELS = Object.freeze({
  london: 'London',
  'south-east': 'South East',
  'south-west': 'South West',
  'east-of-england': 'East of England',
  'east-midlands': 'East Midlands',
  'west-midlands': 'West Midlands',
  'yorkshire-and-the-humber': 'Yorkshire and the Humber',
  'north-west': 'North West',
  'north-east': 'North East',
  wales: 'Wales',
  scotland: 'Scotland',
  'northern-ireland': 'Northern Ireland',
  'channel-islands-and-isle-of-man': 'Channel Islands and Isle of Man',
  'outside-uk': 'Outside the UK',
});

// ─── Reputation ──────────────────────────────────────────────────────────────

/**
 * Quality-weighted community levels. Thresholds deliberately require helpful
 * answers as well as posts so raw volume alone cannot buy status, and any
 * upheld report holds a member at New member until it ages out.
 */
const COMMUNITY_LEVELS = Object.freeze([
  { key: 'new_member', label: 'New member', minPosts: 0, minHelpful: 0, minDays: 0 },
  { key: 'contributor', label: 'Contributor', minPosts: 5, minHelpful: 1, minDays: 3 },
  { key: 'regular', label: 'Regular', minPosts: 25, minHelpful: 5, minDays: 21 },
  { key: 'trusted_member', label: 'Trusted member', minPosts: 75, minHelpful: 20, minDays: 90 },
  {
    key: 'community_expert',
    label: 'Community expert',
    minPosts: 200,
    minHelpful: 60,
    minDays: 180,
  },
]);

const COMMUNITY_ROLES = Object.freeze(['member', 'moderator', 'senior_moderator']);

// ─── Reports ─────────────────────────────────────────────────────────────────

const REPORT_REASONS = Object.freeze([
  { key: 'spam', label: 'Spam or unwanted promotion', priority: 'normal' },
  { key: 'scam', label: 'Scam or fraud', priority: 'high' },
  { key: 'harassment', label: 'Harassment or bullying', priority: 'high' },
  { key: 'hate', label: 'Hate or discrimination', priority: 'high' },
  { key: 'violence', label: 'Threats or violence', priority: 'urgent' },
  { key: 'sexual', label: 'Sexual or adult content', priority: 'high' },
  { key: 'child_safety', label: 'Child safety', priority: 'urgent' },
  { key: 'terrorism', label: 'Terrorism or extremism', priority: 'urgent' },
  { key: 'self_harm', label: 'Encouraging serious self-harm', priority: 'urgent' },
  { key: 'personal_information', label: 'Personal information', priority: 'high' },
  { key: 'impersonation', label: 'Impersonation', priority: 'normal' },
  { key: 'copyright', label: 'Copyright or intellectual property', priority: 'normal' },
  { key: 'illegal_goods', label: 'Illegal goods or services', priority: 'urgent' },
  { key: 'underage', label: 'Underage user concern', priority: 'urgent' },
  { key: 'other', label: 'Something else', priority: 'normal' },
]);

const REPORT_REASON_KEYS = Object.freeze(REPORT_REASONS.map(reason => reason.key));

/** Reasons that must be escalated to a named operator rather than closed by a moderator. */
const ESCALATION_REASONS = Object.freeze([
  'child_safety',
  'terrorism',
  'violence',
  'self_harm',
  'illegal_goods',
  'underage',
]);

const REPORT_STATUSES = Object.freeze(['open', 'in_review', 'actioned', 'dismissed', 'escalated']);

const REPORT_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);

const MODERATION_ACTIONS = Object.freeze([
  'hide',
  'restore',
  'remove',
  'quarantine',
  'approve',
  'lock',
  'unlock',
  'archive',
  'pin',
  'unpin',
  'feature',
  'unfeature',
  'move',
  'redact',
  'warn',
  'restrict',
  'unrestrict',
  'supersede',
  'mark_spam',
]);

const RESTRICTION_TYPES = Object.freeze(['warned', 'read_only', 'suspended', 'link_blocked']);

const APPEAL_STATUSES = Object.freeze(['open', 'upheld', 'overturned', 'withdrawn']);

// ─── Reactions ───────────────────────────────────────────────────────────────

/**
 * `helpful` is the only reaction that feeds reputation. The rest are social
 * signals so that appreciation does not silently become ranking power.
 */
const REACTIONS = Object.freeze([
  { key: 'helpful', label: 'Helpful', emoji: '👍', countsTowardsReputation: true },
  { key: 'thanks', label: 'Thanks', emoji: '🙏', countsTowardsReputation: false },
  { key: 'congratulations', label: 'Congratulations', emoji: '🎉', countsTowardsReputation: false },
  { key: 'support', label: 'Support', emoji: '💜', countsTowardsReputation: false },
]);

const REACTION_KEYS = Object.freeze(REACTIONS.map(reaction => reaction.key));

// ─── Sorting and filtering ───────────────────────────────────────────────────

const SORT_OPTIONS = Object.freeze([
  'latest-activity',
  'newest',
  'most-replies',
  'most-viewed',
  'popular',
  'unanswered',
  'oldest',
]);

const ANSWER_FILTERS = Object.freeze(['all', 'solved', 'unanswered', 'official', 'supplier']);

const FRESHNESS_FILTERS = Object.freeze(['all', 'current', 'recent', 'archive']);

// ─── Limits ──────────────────────────────────────────────────────────────────

const LIMITS = Object.freeze({
  TITLE_MIN: 8,
  TITLE_MAX: 160,
  BODY_MIN: 20,
  BODY_MAX: 20000,
  REPLY_MIN: 2,
  REPLY_MAX: 10000,
  TAG_MAX_LENGTH: 32,
  TAGS_MAX: 6,
  ATTACHMENTS_MAX: 8,
  POLL_OPTIONS_MIN: 2,
  POLL_OPTIONS_MAX: 8,
  POLL_OPTION_MAX_LENGTH: 120,
  BIO_MAX: 500,
  HANDLE_MIN: 3,
  HANDLE_MAX: 30,
  REPORT_DETAIL_MAX: 1000,
  MODERATION_NOTE_MAX: 2000,
  APPEAL_MAX: 1500,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 50,
  REPLY_PAGE_SIZE: 20,
  SEARCH_QUERY_MAX: 120,
});

/**
 * A discussion whose last activity is older than this is treated as dormant:
 * the thread shows an age warning, and replies from low-trust accounts are held
 * for review instead of being published. This is the direct answer to the
 * old-thread promotional spam pattern documented in the Hitched audit.
 */
const FRESHNESS = Object.freeze({
  OLD_THREAD_DAYS: 365,
  DORMANT_THREAD_DAYS: 180,
  CURRENT_ADVICE_DAYS: 365,
  RECENT_ADVICE_DAYS: 90,
  AUTO_ARCHIVE_DAYS: 1095,
  VIEW_DEDUPE_HOURS: 24,
});

/**
 * Trust tiers govern what a member may do. They are derived server-side from
 * account age, verification and standing — never sent by the client.
 */
const TRUST_TIERS = Object.freeze({
  RESTRICTED: 'restricted',
  NEW: 'new',
  ESTABLISHED: 'established',
  TRUSTED: 'trusted',
  STAFF: 'staff',
});

const TRUST_POLICY = Object.freeze({
  [TRUST_TIERS.RESTRICTED]: { maxLinks: 0, linksClickable: false, requiresReview: true },
  [TRUST_TIERS.NEW]: { maxLinks: 1, linksClickable: false, requiresReview: false },
  [TRUST_TIERS.ESTABLISHED]: { maxLinks: 3, linksClickable: true, requiresReview: false },
  [TRUST_TIERS.TRUSTED]: { maxLinks: 6, linksClickable: true, requiresReview: false },
  [TRUST_TIERS.STAFF]: { maxLinks: 20, linksClickable: true, requiresReview: false },
});

// ─── Seed categories ─────────────────────────────────────────────────────────

/**
 * Initial category structure. Seeding is idempotent: existing categories are
 * never overwritten, so operator edits made in the admin centre survive deploys.
 */
const SEED_CATEGORIES = Object.freeze([
  {
    slug: 'planning-and-budgets',
    name: 'Planning & budgets',
    description: 'Timelines, budgets, spreadsheets and keeping the whole thing on track.',
    icon: '🗓️',
    order: 10,
  },
  {
    slug: 'venues',
    name: 'Venues',
    description: 'Finding, viewing, comparing and booking venues of every size.',
    icon: '🏛️',
    order: 20,
  },
  {
    slug: 'catering-and-cakes',
    name: 'Catering & cakes',
    description: 'Menus, dietary requirements, bars, street food and cakes.',
    icon: '🍽️',
    order: 30,
  },
  {
    slug: 'photography-and-video',
    name: 'Photography & video',
    description: 'Briefing photographers and videographers, shot lists and delivery.',
    icon: '📷',
    order: 40,
  },
  {
    slug: 'entertainment-and-music',
    name: 'Entertainment & music',
    description: 'Bands, DJs, speakers, performers and running order.',
    icon: '🎵',
    order: 50,
  },
  {
    slug: 'styling-decor-and-flowers',
    name: 'Styling, décor & flowers',
    description: 'Themes, florals, lighting, hire items and setting the room.',
    icon: '💐',
    order: 60,
  },
  {
    slug: 'fashion-and-beauty',
    name: 'Fashion & beauty',
    description: 'Outfits, alterations, hair, make-up and getting-ready plans.',
    icon: '👗',
    order: 70,
  },
  {
    slug: 'invitations-and-stationery',
    name: 'Invitations & stationery',
    description: 'Save the dates, invitations, signage and on-the-day paper.',
    icon: '✉️',
    order: 80,
  },
  {
    slug: 'event-websites-and-technology',
    name: 'Event websites & technology',
    description: 'Event websites, RSVPs, ticketing, AV and streaming.',
    icon: '💻',
    order: 90,
  },
  {
    slug: 'transport',
    name: 'Transport',
    description: 'Getting guests, kit and yourself where they need to be.',
    icon: '🚐',
    order: 100,
  },
  {
    slug: 'travel-and-accommodation',
    name: 'Travel & accommodation',
    description: 'Room blocks, guest travel, destination events and honeymoons.',
    icon: '🧳',
    order: 110,
  },
  {
    slug: 'parties-and-pre-events',
    name: 'Parties & pre-events',
    description: 'Launch parties, rehearsals, hen and stag dos, welcome drinks.',
    icon: '🥂',
    order: 120,
  },
  {
    slug: 'etiquette-and-advice',
    name: 'Etiquette & advice',
    description: 'Guest lists, awkward conversations, family dynamics and manners.',
    icon: '🤝',
    order: 130,
  },
  {
    slug: 'accessibility-and-inclusive-events',
    name: 'Accessibility & inclusive events',
    description: 'Access, dietary, sensory, faith and inclusion considerations.',
    icon: '♿',
    order: 140,
  },
  {
    slug: 'diy-and-inspiration',
    name: 'DIY & inspiration',
    description: 'Make-it-yourself projects, mood boards and clever savings.',
    icon: '🎨',
    order: 150,
  },
  {
    slug: 'recommendations-wanted',
    name: 'Recommendations wanted',
    description: 'Ask for supplier recommendations with your date, area and budget.',
    icon: '📍',
    order: 160,
    structuredRecommendations: true,
  },
  {
    slug: 'real-events',
    name: 'Real events',
    description: 'Share how it actually went — photos, timings and lessons learned.',
    icon: '🎉',
    order: 170,
  },
  {
    slug: 'ask-verified-suppliers',
    name: 'Ask approved suppliers',
    description: 'Questions answered by approved EventFlow suppliers in their field.',
    icon: '💬',
    order: 180,
  },
  {
    slug: 'marketplace-help-and-wanted',
    name: 'Marketplace help & wanted items',
    description: 'Buying and selling safely through the EventFlow marketplace.',
    icon: '🏷️',
    order: 190,
    marketplaceSafetyNotice: true,
  },
  {
    slug: 'corporate-and-charity-events',
    name: 'Corporate & charity events',
    description: 'Conferences, away days, fundraisers, awards and sponsorship.',
    icon: '🏢',
    order: 200,
  },
  {
    slug: 'feedback-to-eventflow',
    name: 'Feedback to EventFlow',
    description: 'Product questions, bug reports and ideas. The EventFlow team replies here.',
    icon: '📣',
    order: 210,
    officialSupport: true,
  },
  {
    slug: 'general-event-chat',
    name: 'General event chat',
    description: 'Everything else — introductions, celebrations and off-topic chat.',
    icon: '☕',
    order: 220,
  },
]);

// ─── Settings defaults ───────────────────────────────────────────────────────

const DEFAULT_SETTINGS = Object.freeze({
  id: 'system',
  enabled: true,
  requireVerifiedEmail: true,
  requireAdultDeclaration: true,
  minimumAgeYears: 18,
  autoArchiveDays: FRESHNESS.AUTO_ARCHIVE_DAYS,
  oldThreadWarningDays: FRESHNESS.OLD_THREAD_DAYS,
  dormantThreadReviewDays: FRESHNESS.DORMANT_THREAD_DAYS,
  quarantineLowTrustLinks: true,
  blockedDomains: [],
  allowedDomains: [],
  maxDiscussionsPerDay: 10,
  maxRepliesPerHour: 30,
  updatedAt: null,
});

module.exports = {
  COLLECTIONS,
  CONTENT_STATES,
  CONTENT_STATE_VALUES,
  PUBLIC_STATES,
  COUNTABLE_STATES,
  NOINDEX_STATES,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  REGIONS,
  REGION_LABELS,
  COMMUNITY_LEVELS,
  COMMUNITY_ROLES,
  REPORT_REASONS,
  REPORT_REASON_KEYS,
  ESCALATION_REASONS,
  REPORT_STATUSES,
  REPORT_PRIORITIES,
  MODERATION_ACTIONS,
  RESTRICTION_TYPES,
  APPEAL_STATUSES,
  REACTIONS,
  REACTION_KEYS,
  SORT_OPTIONS,
  ANSWER_FILTERS,
  FRESHNESS_FILTERS,
  LIMITS,
  FRESHNESS,
  TRUST_TIERS,
  TRUST_POLICY,
  SEED_CATEGORIES,
  DEFAULT_SETTINGS,
};
