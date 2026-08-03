# EventFlow Community — EventFlow platform audit

**Date:** 3 August 2026

## Methodology

The brief asked for a live inspection of `https://event-flow.co.uk`. **That host
was unreachable from this environment** (`403 request rejected: host not
permitted` at the egress proxy — see the audit methodology section for the
transcript).

The substitute used here is stronger than a screenshot review would have been:
this repository _is_ the production application, deployed to Railway from the
default branch. Everything below was read directly from the code that serves the
live site, and the community pages were rendered and screenshotted against a
locally running instance of `server.js` at 1440 px and 390 px during
implementation.

What this substitute cannot show: production content volume, real user data,
CDN and caching behaviour, and any operator configuration that differs from the
committed defaults. Those remain for operator verification.

---

## 1. Visual language and design tokens

Source: `public/assets/css/tokens.css`.

| Token                | Value            | Community usage                                                  |
| -------------------- | ---------------- | ---------------------------------------------------------------- |
| `--ef-primary`       | `#0B8073` (teal) | `--efc-accent`: active tabs, focus rings, links, primary buttons |
| `--ef-primary-light` | `#F2FBF9`        | Community hero gradient                                          |
| `--ef-accent`        | `#13B6A2`        | Hero gradient terminus                                           |
| `--ef-surface`       | `#FFFFFF`        | Cards                                                            |
| `--ef-bg-muted`      | `#F9FAFB`        | Page background                                                  |
| `--ef-radius-lg`     | `14px`           | Card radius                                                      |
| `--ef-shadow-sm/md`  | —                | Card elevation                                                   |
| `--ef-text-*`        | `clamp()` scale  | Community typography follows the same fluid scale                |

The community stylesheet defines no global rules. Every selector is scoped to
`.efc-*` and every colour resolves from an EventFlow token with a literal
fallback.

**Correction made during implementation:** the first draft used a purple accent
(`#6d28d9`) via a `--color-primary` variable that does not exist in this
codebase, so the community rendered off-brand against the teal navbar. It now
reads `--ef-primary` and matches the rest of the site.

## 2. Shared navigation

Source: the `.ef-header` block, duplicated per page, plus
`public/assets/js/navbar.js`.

- Desktop: `.ef-nav-desktop` with `Plan / Suppliers / Events / Marketplace /
Guides` (and `Pricing` on some pages).
- Mobile: `#ef-mobile-menu` with a longer list including For Suppliers and FAQ.
- Auth state is applied client-side by `navbar.js` from `AuthStateManager`.
- Some pages carry `#ef-bottom-menu`; the brief warns against overcrowding it.

**Community integration:** `Community` inserted after `Marketplace` in the
desktop nav on 41 pages and in the burger menu on 40, and added to the public
destinations footer. The bottom navigation is deliberately untouched. Enforced by
`tests/unit/community-navigation.test.js`, which fails if any page carrying the
shared nav is missed.

**Inconsistency found:** the navigation markup is copied into every HTML file
rather than injected from one partial, so it drifts (`event-detail.html` uses a
single-line minified variant, `faq.html` has a different footer link list). The
community pages are generated from one template
(`scripts/generate-community-pages.mjs`) to avoid adding twelve more copies. A
site-wide navigation partial is recommended follow-up work, out of scope here.

## 3. Authentication and accounts

Source: `middleware/auth.js`.

- JWT in an httpOnly, SameSite=Lax cookie named `token`.
- `authRequired` re-reads the user on every request, so a deleted account cannot
  ride a valid token.
- `requireVerifiedUser` gates on `user.verified`.
- Roles: `customer`, `supplier`, `admin`.
- CSRF via `middleware/csrf.js`; the client reads `/api/v1/csrf-token`.

**Community integration:** all four reused unchanged. The community adds a
narrow `communityRole` alongside the global role rather than a parallel system.

## 4. Suppliers and trust

Source: `routes/suppliers*.js`, `services/supplier*.js`, `docs/BADGES.md`.

Provable facts: `approved`/`status === 'approved'`, `user.verified` (email),
`user.phoneVerified`. Not provable: insurance, qualifications, identity, vetting.

**Community integration:** `buildAuthorCard` emits only the provable set. The
guidelines state in terms that a supplier badge is not a statement about
insurance, qualifications, vetting or identity.

## 5. Marketplace, public calendar and guides

- Marketplace: `routes/marketplace.js`, `/marketplace`.
- Public calendar: `routes/public-calendar.js`, `/public-calendar`, `/events/:slug`.
- Guides: static articles under `public/articles/`, indexed by
  `public/assets/data/guides.json`.

**Community integration:** threads link to all three from the "Take it further"
panel; the marketplace category carries a safety notice pointing at
`/marketplace` so informal classified posts do not bypass its protections.

## 6. Notifications

Source: `routes/notifications.js`, the `notifications` collection, and the
insert pattern in `routes/customer-calendar.js`.

Document shape: `{ id, userId, type, title, message, actionUrl, actionText,
icon, priority, category, metadata, read, createdAt }`, with deterministic ids
used for de-duplication.

**Community integration:** the same collection and shape, `category:
'community'`, deterministic ids (`cnotif_reply_<replyId>_<userId>`). No new
notification store.

## 7. Legal and policy surface

- `/legal` — legal hub; `/terms`; `/privacy`; `/data-rights`.
- `docs/LEGAL_COMPLIANCE_CHECKLIST.md`.

**Age policy inconsistency confirmed in the repository:** the terms describe an
18+ service while other wording is less explicit. The community resolves this on
its own surface by requiring an explicit 18+ self-declaration before a member can
post (`requireAdultDeclaration`, `POST /me/adult-declaration`), and says so on
the guidelines page. **Reconciling the wording across Terms, Privacy and the
Legal Hub is an operator task** recorded in
`docs/compliance/community-child-access-assessment.md`; this session did not
rewrite those approved documents.

## 8. Static page pipeline

Source: `server.js`, `utils/template-renderer.js`, `scripts/serve-static.js`.

`templateMiddleware()` runs before `express.static`; anonymous requests to
certain public pages are sanitised; canonical `.html` URLs 301 to extensionless
ones.

**Community integration:** `routes/community-pages.js` is mounted _before_
`templateMiddleware` in `server.js` so community shells are served with their
content, metadata and structured data rather than as raw files with unfilled
placeholders. `scripts/serve-static.js` gained an equivalent stand-in so the
browser suite can run without a database. Ordering is asserted by
`tests/unit/community-navigation.test.js`.

## 9. Testing and CI

- Jest: `tests/unit`, `tests/integration`, `forceExit`, coverage thresholds.
- Playwright: `e2e/` in static and full-backend modes; `tests/visual` for
  regression and axe.
- CI: `ci.yml`, `test.yml`, `e2e.yml`, `backend-e2e.yml`,
  `visual-regression.yml` (blocking), `coverage-gate.yml`, `codeql.yml`.

**Community integration:** 326 Jest tests and 22 Playwright tests added, all
passing locally. Visual baselines are affected by the navigation change — see
the pull request for how that is handled.

## 10. Opportunities recorded but not taken

1. Extract the navigation into a shared partial (site-wide, out of scope).
2. Push community list filtering into MongoDB queries before ~10k discussions.
3. Reconcile the age wording across Terms, Privacy and the Legal Hub.
4. Add community events to the existing background-job digest scheduler for
   daily and weekly email digests (preferences are stored; the sender is not
   wired up).
