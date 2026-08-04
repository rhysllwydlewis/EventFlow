# EventFlow Community — architecture

**Date:** 3 August 2026
**Feature flag:** `COMMUNITY_ENABLED` (defaults to on; set to `false` to disable)

---

## 1. Principles

1. **Reuse, do not rebuild.** The community uses EventFlow's existing accounts,
   roles, JWT cookies, CSRF protection, rate limits, sanitiser, notifications,
   uploads and admin patterns. There is no second account system, password
   store, user database or notification centre.
2. **Every decision is server-side.** Trust tier, moderation state, badges,
   counters and permissions are computed on the server from authoritative data.
   Nothing the client sends about identity, standing or state is trusted.
3. **Public content is server-rendered.** Every public page produces indexable
   HTML with metadata and structured data before any JavaScript runs.
4. **No hidden signals.** Members can see their own held content and their own
   trust tier. Risk scores and moderation metadata never leave the server on a
   public endpoint.

---

## 2. Existing components reused

| Concern              | Reused from                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Authentication       | `middleware/auth.js` — `authRequired`, `requireVerifiedUser`, `userExtractionMiddleware`        |
| CSRF                 | `middleware/csrf.js` — `csrfProtection`                                                         |
| Rate limiting        | `middleware/rateLimits.js` — `writeLimiter`, `searchLimiter`, `publicReadLimiter`, `apiLimiter` |
| Sanitisation         | `services/contentSanitizer.js` — DOMPurify with the repository's allow list                     |
| Database access      | `db-unified.js` — the same MongoDB/local-store abstraction as every other feature               |
| Notifications        | The `notifications` collection and its existing document shape                                  |
| Navigation           | The shared `.ef-header`, burger menu and footer markup                                          |
| Design tokens        | `public/assets/css/tokens.css` — `--ef-primary`, spacing, radii, shadows                        |
| Static page pipeline | `utils/template-renderer.js` conventions and `express.static` ordering                          |

## 3. New modules

| File                                      | Responsibility                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/CommunityContent.js`              | Collection names, lifecycle states, taxonomy, limits, trust policy, seed categories, settings defaults                                                      |
| `services/communityModeration.service.js` | Pure moderation and anti-spam rules: link policy, domain blocking, duplicate detection, trust tiers, freshness, content assessment, personal-data detection |
| `services/community.service.js`           | Identity, settings, reputation, ranking, projections, view de-duplication, counters, notifications, seeding, filters                                        |
| `services/communityIndexes.service.js`    | Idempotent, named index bootstrap                                                                                                                           |
| `middleware/community.js`                 | Availability, viewer context, adult declaration, posting rights, moderator gates                                                                            |
| `routes/community.js`                     | Reference data, categories, home, discussion CRUD                                                                                                           |
| `routes/community-interactions.js`        | Replies, reactions, saves, follows, answers, polls, reports                                                                                                 |
| `routes/community-discovery.js`           | Search, duplicate suggestions, member profiles, the member's own data                                                                                       |
| `routes/admin-community.js`               | Dashboard, categories, content moderation, reports, members, restrictions, appeals, settings, audit                                                         |
| `routes/community-pages.js`               | Server-rendered pages, metadata, structured data, redirects                                                                                                 |
| `public/assets/js/community/*.js`         | Progressive-enhancement client views                                                                                                                        |
| `public/assets/css/community.css`         | Scoped `.efc-*` styles built on EventFlow tokens                                                                                                            |
| `scripts/generate-community-pages.mjs`    | Generates the twelve HTML shells from one template                                                                                                          |

## 4. Data model

Sixteen collections, all prefixed `community_`:

`categories`, `discussions`, `replies`, `reactions`, `bookmarks`, `follows`,
`reports`, `moderation_actions`, `appeals`, `user_stats`, `views`, `drafts`,
`settings`, `poll_votes`, `canonical_links`, `restrictions`.

### Discussion document

```
id                 internal record id
stableId           immutable 12-char public identity — routing keys off this
slug               readable, regenerated on title edit, decorative only
title, bodyHtml    sanitised content
bodyText           plain text for search, excerpts and duplicate detection
searchText         truncated plain text for the full-text index
excerpt            precomputed card summary
fingerprint        normalised-text hash for duplicate detection
authorId, author   author id plus a denormalised public author card
categorySlug/Name  category at time of posting, updated on move
eventType          one of 13 event types
region             one of 14 broad UK regions — never an address or postcode
eventDate          YYYY-MM only (month precision by design)
tags, attachments, poll, recommendationBrief
state              draft|pending_review|published|quarantined|hidden|removed|archived|superseded
pinned, featured, locked
helpfulAnswerId    chosen by the asker
officialAnswerIds  set by staff
replyCount, uniqueViews, helpfulVotes, saveCount, participants[]
hasSupplierReply, lastReply, lastActivityAt
createdAt, updatedAt, editedAt, removedAt
supersededBy       points at the canonical replacement
moderationPenalty  reduces popularity rather than hiding content
riskScore, riskSignals, moderation   never leave the server publicly
```

### Lifecycle

```
draft ──▶ pending_review ──▶ published ──▶ archived
              │                  │  ▲          │
              ▼                  ▼  │          ▼
         quarantined ──────▶ hidden─┘     superseded
              │                  │
              └──────▶ removed ◀─┘
```

`published` and `archived` count towards reply counters. `published`, `archived`
and `superseded` are publicly readable; the rest are visible only to the author
and to moderators.

## 5. Indexes

Every index is explicitly named so repeated deploys reconcile instead of
duplicating (`services/communityIndexes.service.js`, asserted by
`tests/unit/community-indexes.test.js`). Coverage:

- Unique: stable id, slug lookup, reaction (target+user+reaction), bookmark
  (user+discussion), follow (user+type+target), poll vote, canonical link,
  category slug, user stats.
- Query: category+activity, activity, created, author+date, state, pinned,
  event type, region, unanswered, reply chronology, report queue by
  priority+age, appeal queue, moderation audit by target and by actor.
- Full text: `title` (weight 10), `tags` (4), `searchText` (1).
- TTL: `community_views.expiresAt` with `expireAfterSeconds: 0`, so the viewer
  de-duplication record expires with its window.

## 6. Route design

```
GET    /api/v1/community/meta
GET    /api/v1/community/home
GET    /api/v1/community/categories
GET    /api/v1/community/categories/:slug
POST   /api/v1/community/categories/:id/follow
DELETE /api/v1/community/categories/:id/follow
GET    /api/v1/community/discussions
POST   /api/v1/community/discussions
GET    /api/v1/community/discussions/:stableId
PATCH  /api/v1/community/discussions/:id
DELETE /api/v1/community/discussions/:id
POST   /api/v1/community/discussions/:stableId/replies
PATCH  /api/v1/community/replies/:id
DELETE /api/v1/community/replies/:id
POST   |DELETE /api/v1/community/discussions/:stableId/save
POST   |DELETE /api/v1/community/discussions/:stableId/follow
POST   /api/v1/community/discussions/:stableId/solve
POST   /api/v1/community/discussions/:stableId/official-answer
POST   /api/v1/community/discussions/:stableId/poll-vote
POST   /api/v1/community/posts/:id/reactions
DELETE /api/v1/community/posts/:id/reactions/:reaction
POST   /api/v1/community/posts/:id/report
POST   /api/v1/community/reports/bulk
GET    /api/v1/community/report-reasons
GET    /api/v1/community/search
GET    /api/v1/community/similar
GET    /api/v1/community/members/:handle
GET    /api/v1/community/me
POST   /api/v1/community/me/adult-declaration
PATCH  /api/v1/community/me/profile
GET    /api/v1/community/me/saved | /following | /drafts | /export
PUT    /api/v1/community/me/drafts
DELETE /api/v1/community/me/drafts/:id
POST   /api/v1/community/me/mutes
DELETE /api/v1/community/me/mutes/:id
POST   /api/v1/community/me/appeals

GET    /api/v1/admin/community/dashboard | /categories | /content | /reports
       | /appeals | /members/:handle | /settings | /audit
POST   /api/v1/admin/community/categories | /content/:type/:id/action
       | /restrictions | /seed-categories
PATCH  /api/v1/admin/community/categories/:id | /reports/:id | /appeals/:id | /settings
DELETE /api/v1/admin/community/restrictions/:id
```

Pages: `/community`, `/community/discussions`, `/community/category/:slug`,
`/community/discussion/:stableId/:slug?`, `/community/new`,
`/community/member/:handle`, `/community/search`, `/community/saved`,
`/community/following`, `/community/guidelines`, `/community/help`,
`/admin/community`. `/forum` and `/forums` redirect 301 to `/community`.

## 7. Permissions

Global `customer`/`supplier`/`admin` roles are unchanged. A narrow community
role sits alongside them: `member`, `moderator`, `senior_moderator`. Global
admins are always senior moderators.

| Actor                    | May                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                   | Read published content, search, report content                                                                                                     |
| Verified member          | Create, reply, react, save, follow, report, edit and withdraw their own content, mute, export their data, appeal                                   |
| Approved supplier        | Member rights plus an accurate supplier badge and disclosure obligations                                                                           |
| Moderator                | Review reports, hide/restore/remove/quarantine/approve, lock, move, redact, warn, restrict, pin, feature, mark official answers, read risk signals |
| Senior moderator / admin | All of the above plus suspend, resolve appeals, manage settings, categories and domain lists, and read the full audit trail                        |

Every check runs server-side in `middleware/community.js` and the route
handlers. Object-level authorisation is asserted on every mutation.

## 8. Security boundaries

- CSRF on every mutation.
- Bodies pass through DOMPurify; arbitrary HTML is never stored.
- Anchors are rewritten: unsafe schemes stripped, blocked domains de-linked,
  external links forced to `rel="ugc nofollow noopener noreferrer"`.
- Ownership checked on edit and delete; moderator role checked on every
  moderator action.
- Discussion ids validated against `/^[a-f0-9]{6,32}$/i` and handles against
  `/^[a-zA-Z0-9]{2,32}$/` before any lookup.
- `stripInternalFields` removes `moderation`, `riskSignals`, `riskScore`,
  `fingerprint`, `authorTrustTier`, `searchText` and `reviewNotes` from every
  public response.
- Search snippets are escaped before highlighting.
- Rate limits on every write, plus per-member daily discussion and hourly reply
  ceilings from settings.
- No raw IP is stored for view counting; anonymous viewers are a salted HMAC
  truncated to 24 hex characters, expiring with the de-duplication window.

## 9. Moderation pipeline

```
submission
   │
   ├─ length and structure validation ─────────────▶ 400
   ├─ sanitise body, apply link policy
   ├─ assessContent(text, trust tier, thread, recent posts, settings)
   │     blocked domain ─────────────────────────────▶ 422 reject
   │     score ≥ 45 or restricted account ──────────▶ quarantined (author-visible)
   │     otherwise ─────────────────────────────────▶ published
   └─ moderation action recorded for every non-publish outcome
```

Reports enter a priority queue; six reasons escalate automatically and
quarantine the content pending senior review. Every decision writes to
`community_moderation_actions` and notifies the affected member with an appeal
route.

## 10. Notifications

Community notifications use the existing `notifications` collection and its
document shape, with `category: 'community'`. Ids are deterministic
(`cnotif_reply_<replyId>_<userId>`) so a retry cannot double-notify. Muted
discussions suppress delivery. Removed content is never previewed in a
notification.

## 11. SEO

- Server-rendered content, unique `<title>`, meta description, canonical,
  Open Graph and Twitter card on every public page.
- `DiscussionForumPosting` and `BreadcrumbList` JSON-LD, with `</script>`
  escaped.
- `rel=prev`/`rel=next` on paginated category pages.
- `noindex,follow` on search, composer, saved, following and any non-public
  content state.
- Sitemap includes `/community`, `/community/discussions`, the guidelines and
  help pages, every visible category and every published or archived
  discussion. `robots.txt` explicitly allows `/community`.

## 12. Migration and rollback

There is no migration: the feature adds new collections and touches no existing
document shape. Optional new fields on `users`
(`communityHandle`, `communityDisplayName`, `communityBio`, `communityRegion`,
`communityEventType`, `communityRole`, `communityNotificationPreferences`,
`adultDeclaration`, `communityAdultDeclaredAt`) are additive and read with
defaults.

**Rollback:** set `COMMUNITY_ENABLED=false`. Every API returns 404, the page
routes fall through, and the navigation link becomes a dead link that should be
removed in the same change if the disable is permanent. No data is destroyed.
Index creation and category seeding are idempotent, so re-enabling is safe.

## 13. Performance

- All list endpoints paginate; the page size is clamped to 50.
- Counters are denormalised on the discussion and recomputed from replies after
  any state change, so cards never require a per-row query.
- Category and settings reads are cached in-process for 30 seconds.
- Page shells are cached in memory for 5 minutes in production.
- Media is lazy-loaded; the thread loads 20 replies at a time.

**Known limitation:** several read paths load a collection and filter in
process (`loadPublicDiscussions`), matching the pattern used elsewhere in this
repository. This is correct and fast at current volumes and the indexes needed
to push the filters into MongoDB are already in place, but the query layer
should move to server-side filtering before the community exceeds roughly ten
thousand discussions. This is recorded as follow-up work rather than presented
as complete.
