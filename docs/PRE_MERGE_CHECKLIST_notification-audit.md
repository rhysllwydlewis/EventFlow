# Pre-Merge Checklist — `copilot/audit-notification-system`

This document is the final go/no-go gate for merging PR branch `copilot/audit-notification-system` into `main`. Each item has been verified in the session that produced the final commit; re-verify before merge if the branch has moved on.

---

## 🟢 Build & Test

- [x] `npm install` succeeds on a clean clone (verified).
- [x] Full jest suite green: **4995 passed, 0 failed, 231 skipped** (`npx jest --no-coverage`).
- [x] Prettier: all PR-touched files pass `npx prettier --check` after the lint-staged pass at commit time.
- [x] ESLint: all PR-touched JS passes (`npx eslint public/assets/js/notification-system.js` clean). Pre-existing warnings in unrelated files are not in scope.
- [x] Server boots successfully with a fresh `JWT_SECRET` (smoke-tested via curl against `/api/v1/maintenance/message` and `/api/maintenance/message`).
- [x] No new dependencies added — `package.json` diff is limited to the new `preflight` npm script.

## 🟢 Correctness — backend

- [x] `routes/misc.js` split into `captcha.js`, `contact.js`, `maintenance.js`, `csp.js`. Each module exports an `initializeDependencies(deps)` that mirrors the pre-split contract and throws on missing deps.
- [x] `routes/index.js` wires each new router on **both** `/api/v1` and legacy `/api`, matching the existing compatibility policy.
- [x] `middleware/legacyApiDeprecation.js` is applied only on the unversioned mount AND guards against Express's prefix-match (`/api` also matches `/api/v1/…`). Regression test locked in `tests/integration/legacy-api-deprecation.test.js`.
- [x] Live curl verification: `/api/v1/maintenance/message` returns **no** `Deprecation`/`Sunset` headers; `/api/maintenance/message` returns both plus `Link; rel="successor-version"`.
- [x] `scripts/preflight.mjs` exits 1 in `NODE_ENV=production` on each of: missing required env, short secret, `REPLACE_ME_` placeholder, forbidden default secret — and exits 0 when config is valid. Verified by 6 integration tests.
- [x] `tests/integration/pexels-video-fallback.test.js` writes a complete fresh settings doc per test instead of mutating prior state — eliminates the "passes in isolation, fails in full suite" flake class.

## 🟢 Correctness — frontend

- [x] `public/assets/js/notification-system.js`: `Esc` dismisses the top toast. Verified live that 4 toasts → 3 after `Escape`.
- [x] Esc handler **yields** to native handlers when an `<input>`, `<textarea>`, `<select>`, or contentEditable is focused. Verified live (3 toasts before & after Esc while textarea focused).
- [x] No `addEventListener('keydown', …)` leak — the listener is registered once per `NotificationSystem` instance via `init()`, which is itself guarded by `if (this.container) return;`.
- [x] **Reviewer-raised a11y fix**: removed `aria-live="polite"` from the `.ef-notification-container`. Each toast already sets its own `role` (`alert` or `status`), and older screen readers (notably JAWS) honour the nearest ancestor's `aria-live` over a descendant's implicit value — which would have silently downgraded error toasts from assertive to polite. Container keeps `role="region"` + `aria-label="Notifications"` for landmark semantics. Inline comments explain the rationale.
- [x] **Reviewer-raised URL check**: `services/notification.service.js` uses `/dashboard/supplier#reviews` (not the old `/supplier-dashboard`). Verified consistent — `services/actionPromptService.js` also uses `/dashboard/supplier`, and `server.js` issues a 301 from the old path. All remaining `supplier-dashboard` matches in the repo are CSS/JS filenames, not URL paths.

## 🟢 Accessibility / Visual polish (this session)

- [x] `:focus-visible` ring added to `.ef-notification__close` — 2px solid `#3B82F6` with 2px offset and a subtle blue-tinted background. Live-verified: tabbed to a close button, computed `outline` = `rgb(59, 130, 246) solid 2px`.
- [x] `@media (prefers-reduced-motion: reduce)` block disables slide-in / hiding transforms, the shake animation, and hover/active scale transforms. Keeps the opacity fade because it carries information about toast appearance, which matches WCAG 2.3.3 guidance.
- [x] `public/test-notifications.html` documents the three new a11y features (Esc shortcut, focus ring, reduced-motion) in the "What to Look For" list, with a small `<kbd>` chip style for the `Esc` callout.
- [x] Before/after screenshots captured (attached in PR description).

## 🟢 Security

- [x] CodeQL: 2 informational alerts on `routes/captcha.js` + `routes/contact.js` (`js/missing-rate-limiting`). Both are **false positives** — the routes apply `writeLimiter` via the `applyWriteLimiter` DI helper, identical to the pre-split `misc.js` (which was unflagged). CodeQL's data flow doesn't trace the helper indirection. Inlining the middleware would break the repo-wide DI pattern. Documented in PR body.
- [x] No secrets or placeholder values committed. `scripts/preflight.mjs` now actively prevents placeholders from being deployed.
- [x] No new external HTTP calls from any added code paths.

## 🟢 Docs

- [x] `docs/api-deprecation.md` — new policy doc covering the unversioned `/api` → `/api/v1` deprecation (sunset 2026-12-31, removal in v20.0.0). Referenced from the middleware's `Link` header.
- [x] Header of each new route file explains the split (Effort 3.1).
- [x] Header of `middleware/legacyApiDeprecation.js` cites the RFCs (8594 Sunset, 9745 Deprecation) it implements.
- [x] Header of `scripts/preflight.mjs` shows example wiring into a deploy pipeline.
- [x] Comments in `components.css` explain why `!important` is needed on the focus-ring (matches the existing block's convention and pre-existing explanatory comment).

## 🟡 Explicitly deferred to follow-up PRs

Each of these was scoped out with rationale in the PR description and does **not** block this merge:

- **Effort 1** full NotificationDispatcher + ESLint custom rule — multi-day design.
- **Effort 2** global CSS reset (invert `button:not(...)` → opt-in `.ef-cta`) — requires visual regression baseline first (Effort 5.3).
- **Effort 5.2** 9-suite / 231-test skip triage — multi-day audit.
- **Effort 5.3** Playwright visual regression baseline — multi-day.
- **Effort 6** full WebSocket handler audit + onDisconnect/onReconnect toasts — should follow Effort 1.
- **Effort 9.3** axe-core CI integration — new dependency + Playwright plumbing.

## ✅ Follow-up PR — mop-up

- [x] ESLint hardening (`show` + `clearAll`) and direct-caller cleanup completed ([resolved in follow-up PR](#)).
- [x] Notification dispatcher surface extended with `show()` + `clearAll()` passthroughs ([resolved in follow-up PR](#)).
- [x] Browser/server notification type enum drift guard test added for dispatcher parity ([resolved in follow-up PR](#)).
- [x] Visual-regression soft-fail expiry gate added to prevent indefinite non-blocking state ([resolved in follow-up PR](#)).
- [x] Button B2 opt-out additions now pinned by snapshot checker in CI (`check:button-opt-out`) ([resolved in follow-up PR](#)).
- [x] Audit docs/changelog updated to capture the mop-up state and remaining explicit follow-ups ([resolved in follow-up PR](#)).

## Rollback plan

If the deployed branch misbehaves, the full set of changes reverts cleanly with `git revert <merge-sha> -m 1`. The additions are almost entirely:

- **Additive** (new route files, new middleware, new docs, new scripts, new tests) — revert is safe.
- **Pure refactor** (`routes/misc.js` split) — old file content is reconstructible from the four new files (concatenate + re-add the single shared `initializeDependencies`).
- **Additive a11y CSS** (focus-visible + reduced-motion) — cosmetic; no behaviour change for default users.

The only non-additive change in the whole PR is the `Deprecation`/`Sunset` headers on `/api/...`. These are advisory HTTP headers that browsers & clients should ignore if they don't understand them, so a revert has no functional impact on downstream clients.
