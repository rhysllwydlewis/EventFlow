# EventFlow Community — Hitched forum audit

**Author:** Claude Code (autonomous implementation session)
**Date of research:** 3 August 2026
**Status:** Reference document for the EventFlow Community implementation

---

## 1. Methodology and its limits — read this first

This section is deliberately first, because the honesty of everything below
depends on it.

### What was asked for

The brief required live browser inspection of `https://forums.hitched.co.uk/`
and `https://event-flow.co.uk/` at five viewport widths, covering at least
thirty discussion threads, member profiles, moderation states and every
publicly observable interaction.

### What was actually possible

**Live inspection of both sites was not possible in this environment.** The
execution container's egress policy denies all outbound hosts other than a
small package-registry allow list. Every attempt was rejected at the proxy:

```
$ curl -sS -o /dev/null -w "%{http_code}" https://forums.hitched.co.uk/
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
"recentRelayFailures": [
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "forums.hitched.co.uk:443" },
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "event-flow.co.uk:443" },
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "web.archive.org:443" }
]
```

The managed fetch tool refused the same host independently
(`Claude Code is unable to fetch from forums.hitched.co.uk`), and web search
returned no substantive detail about the forum's structure. The Wayback Machine
was blocked too, so there was no archival substitute.

### What this document therefore is

Three kinds of statement appear below and each is labelled:

| Label           | Meaning                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[PATTERN]**   | A well-established pattern of legacy UK wedding-forum software, stated from general knowledge of that product category rather than from an observation of Hitched made during this session. |
| **[INFERENCE]** | A reasoned conclusion drawn from a **[PATTERN]** plus the brief's own description of the observed problems.                                                                                 |
| **[DECISION]**  | What EventFlow does, and why. These are verifiable — every one points at code and tests in this repository.                                                                                 |

**No statement in this document should be read as a first-hand observation of
Hitched made on 3 August 2026.** The brief's own account of the target product
(old threads revived by promotional replies, unanswered product questions in
"Feedback to Hitched", a dense dated desktop layout, empty "users online"
modules) has been taken as the operator's own field observation and treated as
the requirement it plainly is, but it has not been independently verified here.

### What must still be done by a human

The following work is **outstanding** and cannot be closed by this session:

1. Inspect the live Hitched forum at 1440 / 1024 / 768 / 390 px and around each
   observed breakpoint, capturing the page-by-page component map.
2. Review the thread sample the brief specifies (30+ threads, 10+ from the
   feedback category, 10+ resurfaced old threads, 5+ recommendation/wanted
   threads, 5+ media threads, a 3-page thread).
3. Confirm or correct each **[PATTERN]** and **[INFERENCE]** below.
4. Complete the "Evidence" column of
   `docs/research/eventflow-community-hitched-parity-matrix.md`, which currently
   cites EventFlow-side evidence only.

An operator with ordinary network access can do all four in a few hours. Until
then, this document is a design rationale with a clearly marked evidence gap —
not a competitive audit.

---

## 2. Feature inventory (page types)

The page types below are the ones the brief names, and they are what EventFlow
implements. Where a page's Hitched behaviour is asserted, it is marked.

| Page type                | Assumed reference behaviour                                                                                                                                                                                                                 | EventFlow equivalent                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forum home               | **[PATTERN]** Hero, search, "Start discussion", several stacked feed modules (recent discussions, recent comments, most popular, most viewed), a category/group index and sidebar modules including "users online" and "most active users". | `/community` — hero, search, start action, tabbed feed (latest activity / new / popular / most viewed / needs an answer / following), category index, and sidebar modules that render **only when they have content**. |
| Discussions index        | **[PATTERN]** A flat list with basic sorting and page-number pagination.                                                                                                                                                                    | `/community/discussions` — URL-backed filters (category, event type, UK region, answer state, freshness) and six sorts, with server pagination.                                                                        |
| Category / group landing | **[PATTERN]** Name, description, join button, member count, discussion list.                                                                                                                                                                | `/community/category/:slug` — name, description, icon, rules, follow with follower count, active contributors, pinned discussions, the shared filter set.                                                              |
| Thread                   | **[PATTERN]** Original post then flat chronological replies with quote and report.                                                                                                                                                          | `/community/discussion/:stableId/:slug` — original post, flat chronological replies, quote, reactions, helpful answer, official answer, save, follow, share, report, plus an age warning and related discussions.      |
| Composer                 | **[PATTERN]** Title, category, body.                                                                                                                                                                                                        | `/community/new` — the same required trio, plus optional event type, broad UK region, event month, tags, and live duplicate suggestions, category rules and a personal-information warning before posting.             |
| Member profile           | **[PATTERN]** Avatar, join date, post count, a volume-derived level.                                                                                                                                                                        | `/community/member/:handle` — public handle, optional bio, optional broad region and event type, discussions, replies, and a **quality-weighted** level.                                                               |
| Search                   | **[PATTERN]** Title-oriented search.                                                                                                                                                                                                        | `/community/search` — full text across titles, original posts, replies and tags, with facets and a freshness weighting.                                                                                                |
| Saved / following        | **[PATTERN]** Save and follow exist.                                                                                                                                                                                                        | `/community/saved`, `/community/following`.                                                                                                                                                                            |
| Guidelines / help        | **[PATTERN]** Rules exist somewhere in the footer.                                                                                                                                                                                          | `/community/guidelines`, `/community/help` — first-class pages covering conduct, supplier rules, moderation and appeals.                                                                                               |

---

## 3. Friction log

Each entry states the problem the brief describes, the reasoning, and what
EventFlow does about it.

### 3.1 Old threads revived by promotional replies

- **[PATTERN]** Legacy forum software orders threads by last reply, so any reply
  to a decade-old thread returns it to the top of the index.
- **[INFERENCE]** This is the single most valuable target for a competitor,
  because it combines a spam problem with a content-quality problem: the reply
  is unwanted _and_ the thread it resurfaces contains stale prices and defunct
  suppliers.
- **[DECISION]** EventFlow attacks it on four fronts:
  1. A reply from a low-trust account to a thread dormant ≥180 days that
     contains **any** external link is quarantined before public display
     (`assessContent`, `services/communityModeration.service.js`).
  2. Threads carry a visible age warning from 365 days with a "start a new
     discussion" action (`routes/community-pages.js`, `community/thread.js`).
  3. Search de-weights archived-freshness threads by 40 %
     (`routes/community-discovery.js`).
  4. Moderators can supersede an old thread with a current canonical one, which
     locks the old thread and links forward
     (`routes/admin-community.js`, action `supersede`).
- **Tests:** `tests/unit/community-moderation.test.js` ("holds a low-trust reply
  that adds a link to a dormant thread", "still publishes a link-free reply",
  "lets a trusted member link on a dormant thread"),
  `tests/integration/community-api.test.js`.

### 3.2 Reporting spam one post at a time

- **[PATTERN]** Report actions are per-post.
- **[INFERENCE]** A spam run of twenty posts costs a member twenty interactions,
  so most runs are under-reported.
- **[DECISION]** `POST /api/v1/community/reports/bulk` reports every public post
  by one handle in a single action, grouped under one `groupId` for the
  moderator.
- **Test:** "reports a whole spam run from one account in a single action".

### 3.3 No visible distinction between advice and promotion

- **[PATTERN]** A supplier reply looks like any other reply.
- **[DECISION]** Supplier replies carry a disclosure derived from authoritative
  supplier data, and self-recommendation is labelled explicitly: _"This supplier
  is recommending their own business."_ Badges only ever assert what EventFlow
  can prove — approved-supplier status and email/phone verification. They never
  imply insurance, vetting or qualifications.
- **Test:** "discloses when a supplier recommends their own business".

### 3.4 Product questions without official answers

- **[PATTERN]/[per the brief]** Feedback threads contain product questions and
  complaints with no clear, timely official reply.
- **[DECISION]** An **Official EventFlow answer** is a distinct state from a
  **Helpful answer**: only staff can set it, it carries a _last verified_ date,
  and the dashboard reports the median time to first reply and the count of
  official answers so the gap is measurable rather than anecdotal.
- **Tests:** "keeps official answers separate from helpful answers, and
  staff-only"; dashboard metrics test.

### 3.5 Vanity modules

- **[PATTERN]** "Users online" and member totals are prominent; they read as
  zero or near-zero on a quiet forum, which makes the community look dead.
- **[DECISION]** EventFlow publishes no online counter and no member total. The
  homepage sidebar shows published discussions, replies and the percentage of
  discussions with at least one reply. Every homepage module is omitted entirely
  when it has no genuine content — there are no decorative empty boxes.
- **Tests:** "serves the homepage payload without any vanity counters"; "serves
  health metrics to an admin, without vanity counts".

### 3.6 Wedding-only framing

- **[PATTERN]** Categories, copy and defaults assume a wedding with a bride.
- **[DECISION]** Thirteen event types spanning weddings, birthdays, parties,
  corporate events, conferences, festivals, charity events, baby showers,
  anniversaries, christenings, funerals and memorials, community events and
  other. Copy addresses "people planning events". No gendered role is assumed
  anywhere in the product.

### 3.7 Duplicate questions

- **[PATTERN]** Nothing intervenes between typing a title and publishing it.
- **[DECISION]** `GET /api/v1/community/similar` runs as the title is typed and
  surfaces existing discussions above the composer, with reply counts, solved
  state and an "older discussion" marker so the member can judge whether the
  existing answer is still current.

---

## 4. Moderation failure log

| Failure mode                    | **[INFERENCE]** why it persists                   | EventFlow control                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gambling / adult / piracy links | Blocklists are static and keyword-anchored        | Substring tokens for unambiguous terms plus boundary-anchored patterns for ambiguous ones, and an operator-managed allow/block list (`isBlockedDomain`)                                     |
| Link-dropping by fresh accounts | New accounts have full posting rights immediately | Progressive link privileges: restricted accounts get 0 links, new accounts get 1 non-clickable link, established 3 clickable, trusted 6 (`TRUST_POLICY`)                                    |
| Repetitive near-duplicate posts | Only exact-match detection, if any                | Word-trigram Jaccard similarity ≥0.85 against the author's last 24 hours holds the post for review                                                                                          |
| Slow report resolution          | No queue prioritisation                           | Reports carry a priority derived from their reason; six categories escalate automatically and quarantine the content pending senior review                                                  |
| Opaque outcomes                 | Reporters and authors are told nothing            | Both are notified: the reporter gets the outcome, the author gets what happened and an appeal link. **No shadow bans** — a held post is visible to its own author, marked "awaiting review" |
| Evidence lost to edits          | Reports reference live content                    | Every report stores a content snapshot at report time                                                                                                                                       |

---

## 5. Content-freshness analysis

**[DECISION]** Freshness is a first-class property, not a timestamp:

| Band        | Definition              | Effect                                    |
| ----------- | ----------------------- | ----------------------------------------- |
| `recent`    | Last activity ≤90 days  | Search relevance ×1.25                    |
| `current`   | Last activity ≤365 days | Neutral                                   |
| `archive`   | Last activity >365 days | Search relevance ×0.6                     |
| `isOld`     | Created ≥365 days ago   | Age warning banner on the thread          |
| `isDormant` | Last activity ≥180 days | Stricter moderation for low-trust replies |

Official answers additionally carry `officialAnswerVerifiedAt`, rendered as
"last verified <date>", so an authoritative answer states its own currency.

---

## 6. Mobile and accessibility analysis

**[PATTERN]** The reference product uses a dense desktop-first layout with small
metadata, and its filters are hard to operate on a phone.

**[DECISION]** EventFlow Community is mobile-first:

- Touch targets are ≥44 px (`.efc-action`, `.efc-tab`, form controls).
- Metadata is 13 px against a 4.5:1+ foreground, not 10 px grey.
- Filters collapse behind an accessible disclosure below 768 px; the toggle and
  the panel it controls are rendered together so `aria-controls` never dangles.
- A skip link is the first focusable element on every page.
- `prefers-reduced-motion` disables the skeleton shimmer.
- `prefers-contrast: more` darkens muted text and borders.
- Every public page is server-rendered and readable with JavaScript disabled.

**Verified in this session:** axe-core (WCAG 2.0/2.1 A and AA) reported **zero
violations** across all eleven community pages at 1440 px and 390 px. The
Playwright suite (`e2e/community.spec.js`, 22 tests) verifies no horizontal
overflow at 1440/1024/768/390 px, skip-link tab order, accessible names and
console health.

---

## 7. Features worth retaining, improving and omitting

**Retain (implemented as close equivalents):** forum home with multiple feeds;
category index and landing pages; follow/join a category with a follower count;
discussion index with sorting and pagination; flat chronological threads; quote;
save; follow; report; member profiles; recent-replies module; most-popular and
most-viewed feeds; media indication on cards.

**Improve (implemented, with the improvement documented in the parity matrix):**
search (full text + facets + freshness weighting); reputation (quality-weighted,
not volume); reporting (bulk + snapshots + outcomes); official answers (distinct
state + verification date); freshness (explicit bands + warnings + archiving);
supplier participation (disclosure + provable credentials only).

**Do not reproduce:** a "users online" counter; a member-total headline; an
unstructured for-sale board that bypasses the marketplace's protections;
volume-derived status labels; any engagement metric that rewards posting for its
own sake.

---

## 8. Evidence directory

No third-party screenshots were captured, because no third-party site was
reachable. EventFlow-side evidence captured in this session:

- axe-core results: zero WCAG 2.1 AA violations, 11 pages × 2 viewports.
- Playwright: `e2e/community.spec.js`, 22/22 passing against the static server.
- Jest: 326 community tests passing (`tests/unit/community-*.test.js`,
  `tests/integration/community-api.test.js`).
- Rendered pages reviewed at 1440 px and 390 px during implementation.

Deliberately, no copyrighted third-party markup, copy or imagery has been copied
into this repository. Every behaviour described here is independently
implemented.
