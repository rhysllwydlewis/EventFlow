# 📸 EventFlow - Comprehensive Event Services Marketplace

A production-ready, feature-rich platform connecting event service suppliers (photographers, venues, caterers, entertainment, etc.) with customers planning events. Built with Node.js, Express, and MongoDB, EventFlow has grown from a simple listings marketplace into a full platform: real-time messaging, a community forum, a partner/referral program, Stripe-powered subscriptions, wedding websites with RSVPs, and a UK-wide location hub — all sitting behind a 100+ route, 100+ service module backend.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-22.x%20LTS-brightgreen)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0%2B-green)](https://www.mongodb.com/)

---

## 📋 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
  - [Local Development](#local-development)
  - [Production Deployment](#production-deployment)
- [Tech Stack](#️-tech-stack)
- [Background Jobs & Queue Architecture](#-background-jobs--queue-architecture)
- [Environment Variables](#-environment-variables)
- [API Endpoints](#-api-endpoints)
- [User Flows & Pages](#-user-flows--pages)
- [Project Structure](#-project-structure)
- [Database Schema](#️-database-schema)
- [Deployment](#-deployment)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [MongoDB Atlas Webhooks](#-mongodb-atlas-webhooks)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)
- [Support](#-support)

---

## 🌟 Features

EventFlow is organized into a handful of major product areas. The list below is grouped by system rather than a flat feature dump — each area has its own routes, services, and (where noted) a dedicated doc under [`docs/`](#-documentation).

### Core Marketplace

- ✅ **Multi-Step Planning Wizard** — Interactive wizard for creating event plans with package selection
- ✅ **Supplier Profiles & Packages** — Rich profiles with galleries, packages, services, and a verification state machine
- ✅ **Advanced Search & Discovery** — Full-text and ranked supplier search, filters, trending, personalised recommendations, and a separate classifieds-style marketplace for second-hand event items (geodistance search)
- ✅ **Reviews & Ratings (v2)** — 5-star ratings, verified-customer badges, trust scores, moderation, sentiment analysis, and secure Postmark-delivered review-request links
- ✅ **Photo Management** — Upload, optimize, and moderate photos, stored on **Cloudinary** (not local disk)
- ✅ **Public Calendar** — Shared calendar of wedding fayres, open days, and showcases with a publisher-permission model (see below)
- ✅ **User Authentication** — JWT-based auth with role-based access (customer, supplier, admin), Google and Facebook sign-in, TOTP two-factor authentication, and email/phone verification
- ✅ **Admin Dashboard (v2)** — RBAC-based admin panel (Owner/Admin/Moderator/Support roles) across ~36 admin pages
- ✅ **API Documentation** — Interactive Swagger UI at `/api-docs`

### Messaging — Messenger v4

Real-time conversations between customers and suppliers over Socket.IO, with unread counts, blocking, search, attachments, and message reporting. Delivery is queue-backed (BullMQ/Redis — see [Background Jobs](#-background-jobs--queue-architecture)): an HTTP send emits over the socket immediately, then a deterministic notification job fans out in-app + email notifications idempotently, with a durable-recovery reconciler that replays anything missed if the worker restarts. Admins get oversight endpoints (`/admin/conversations`, `/admin/metrics`). See [docs/messenger/](docs/messenger/).

### Community & Forums

A full discussion-forum system — categories, discussions, replies, reactions, bookmarks, follows, polls — gated behind the `COMMUNITY_ENABLED` feature flag and requiring verified email + an adult declaration to post. Public pages are server-rendered for SEO. Because it's UK-facing user-generated content, it ships with a real compliance package: a child-access assessment, a DPIA, a moderation policy, an incident runbook, and transparency records (see [`docs/compliance/`](docs/compliance/)) alongside trust tiers and an appeals process for moderation actions.

### Partner & Referral Program

A private `/partner` portal for referrers (community partners, creators, group admins) who introduce genuine suppliers to EventFlow and earn points at signup/first-package/first-booking milestones. Backed by a substantial anti-fraud stack — device/IP risk scoring, CAPTCHA, reward integrity checks and clawback, and locked cashout operations — plus an admin moderation and cashout-approval workflow. See [docs/PARTNER_PORTAL.md](docs/PARTNER_PORTAL.md) and [docs/PARTNER_CASHOUT_SOP.md](docs/PARTNER_CASHOUT_SOP.md).

### Subscriptions & Billing

Stripe-only supplier billing (no Google Pay) across three tiers — **Starter** (free), **Professional**, and **Professional Plus** — each available monthly or yearly, with feature gating enforced server-side (e.g. package-listing limits unwind automatically on downgrade). Upgrades apply an immediate prorated charge; downgrades are scheduled at period end. Supports free trials and an introductory-pricing coupon flow for the Professional plan, with the full subscription lifecycle (activated/renewal-reminder/trial-ending/payment-failed/cancelled) wired to Postmark emails. See [docs/STRIPE_SUBSCRIPTION_GUIDE.md](docs/STRIPE_SUBSCRIPTION_GUIDE.md) and [docs/SUBSCRIPTION-TIERS.md](docs/SUBSCRIPTION-TIERS.md).

### Wedding Planning Tools

- **Wedding Websites & RSVPs** — Customers can publish a public wedding microsite (`/wedding/:slug`) with password/private-link/public visibility modes, theme customisation, RSVP collection (deduplicated by email/name), and a basic seating-table planner. Stored as sub-documents on the customer's `plans` record, not a standalone collection. See [docs/WEDDING_WEBSITE_FEATURE.md](docs/WEDDING_WEBSITE_FEATURE.md) for what's shipped vs. not yet built (e.g. drag-and-drop seating, invite emails/QR codes are still open).
- **Guest Management** — RSVP status tracking (`pending`/`attending`/`declined`/`maybe`), a guest summary/table view, and CSV export.
- **Quote Requests & Lead Scoring** — A structured customer→supplier enquiry flow feeding a 0–100 lead-quality score (timeline realism, contact completeness, spam signals) — see [docs/LEAD-SCORING.md](docs/LEAD-SCORING.md).

### Location Hub Pages

A UK "hub-and-spoke" location section — `/locations` plus a spoke page per city (`/locations/:citySlug`) — backed by an authoritative city registry, with an editorial publication-state machine (draft → review → pilot → published → retired) and an SEO quality gate that decides indexability independently of publish state. See [docs/uk-city-hub-and-spoke.md](docs/uk-city-hub-and-spoke.md).

### Trust & Safety

- **Two-Factor Authentication** — TOTP via `speakeasy`, QR-code setup, 10 backup codes, encrypted secrets
- **Email & Phone Verification** — 24-hour email verification tokens; SMS OTP phone verification via Twilio
- **Supplier Verification** — A dedicated verification state machine plus trust badges on supplier profiles
- **Content Moderation** — Photo/review/community moderation queues, spam detection, and an audit log of every admin action

### Admin Dashboard

- **User Management** — Edit, delete, suspend, ban users
- **Admin Privilege Control** — Grant/revoke admin access with owner protection, backed by the v2 RBAC permission model
- **Supplier Management** — Edit, approve, verify, delete suppliers
- **Manual Verification** — Admin can manually verify user emails and supplier identities
- **Package Management** — Edit, approve, feature, delete packages
- **Photo & Review Moderation** — Batch approve/reject queues
- **Smart Tagging** — Automatically generate relevant tags for suppliers based on descriptions
- **Public Calendar Override** — Force-grant or force-deny calendar publishing rights per supplier (see below)
- **Partner & Cashout Moderation** — Review referral fraud signals and approve/reject partner cashout requests
- **Community Moderation** — Review reports, apply moderation actions, and handle appeals
- **Comprehensive Audit Log** — Track all admin actions with timestamps
- **Data Export** — CSV and JSON exports for users, marketing lists, full database
- **Analytics Dashboard** — User signups, activity metrics, per-supplier performance analytics, and a PostHog integration layer
- **GDPR Compliance** — User data management and privacy controls

### Supplier Types

Suppliers are classified into the following categories (available in signup and profile forms):

| Category          | Publisher? |
| ----------------- | ---------- |
| Venues            | No         |
| Catering          | No         |
| Photography       | No         |
| Videography       | No         |
| Entertainment     | No         |
| Music/DJ          | No         |
| Florist           | No         |
| Decor             | No         |
| Transport         | No         |
| Cake              | No         |
| Stationery        | No         |
| Hair & Makeup     | No         |
| Beauty            | No         |
| Bridalwear        | No         |
| Jewellery         | No         |
| Celebrant         | No         |
| **Event Planner** | **Yes**    |
| **Wedding Fayre** | **Yes**    |
| Planning          | No         |
| Other             | No         |

"Publisher" suppliers can create, edit and delete events on the shared Public Calendar (see below).

### Public Calendar & Publishing Permissions

EventFlow includes a shared public calendar at `/public-calendar` where wedding fayres, open days, supplier showcases, workshops, venue tours, planning events and similar public events can be listed.

#### Permission overview

| User type              | View public events | Save events | Create events | Edit own events | Edit all events |
| ---------------------- | -----------------: | ----------: | ------------: | --------------: | --------------: |
| Public visitor         |                Yes |          No |            No |              No |              No |
| Customer               |                Yes |         Yes |            No |              No |              No |
| Non-publisher supplier |                Yes |         Yes |            No |              No |              No |
| Publisher supplier     |                Yes |         Yes |           Yes |             Yes |              No |
| Admin                  |                Yes |         Yes |           Yes |             Yes |             Yes |

#### Who can publish?

- **Event Planner** and **Wedding Fayre** suppliers can create/update/delete public calendar events by default.
- Suppliers with `publicCalendarPublisherOverride === true` can publish regardless of category.
- Suppliers with `publicCalendarPublisherOverride === false` cannot publish regardless of category.
- Customers, public visitors and non-publisher suppliers cannot publish.
- Permissions are **enforced at the API layer** — frontend messaging is helpful, but the server remains authoritative.

#### Request publishing access workflow

Non-publisher suppliers can request shared calendar publishing access from the supplier/public calendar UI. Requests collect the reason, intended event types, an example event title, expected frequency, optional supporting URL and notes.

Request statuses are:

- `pending`
- `approved`
- `rejected`
- `cancelled`

Admins can review requests, approve them, or reject them with a reason. Approval sets the supplier's `publicCalendarPublisherOverride` to `true`; rejection does not force-deny the supplier unless an admin separately sets the override to `false`.

#### Event lifecycle and visibility

Public calendar events support lifecycle status values including:

- `draft`
- `pending_review`
- `published`
- `rejected`
- `cancelled`
- `expired`

Current public listings show only `published` future/current events by default. Past events can be included with the `includePast=true` API filter. Draft, rejected and cancelled events are hidden from default public listings; direct detail pages can show a cancelled event with a clear cancellation notice when the viewer is allowed to see it. Older events with no `status` are treated as `published` for backward compatibility.

#### Rich event details

Public events can include richer marketplace information such as event type, venue/address fields, county/postcode, online event URL, free/paid/donation price type, ticket price, booking-required status, external booking URL, capacity, organiser name, contact details, accessibility notes, parking information, featured image/gallery URLs and a stable slug.

Backward-compatible fallbacks are preserved:

- `featuredImageUrl` falls back to existing `imageUrl`.
- `externalBookingUrl` falls back to existing `externalUrl`.
- `eventType` falls back to `category` or `Other`.
- Missing `slug` is generated safely at runtime.

#### Add to calendar / `.ics` export

Public events expose a simple `.ics` download endpoint so visitors and logged-in users can add an event to common calendar apps without Google Calendar API integration or OAuth scopes. The export includes the event title, dates, description, location, organiser where available and a link back to EventFlow.

#### Customer "Save to my calendar"

Logged-in customers (and other users) can click **Save** on any published public event. Saved events appear on the **customer dashboard calendar** (purple colour). Saving the same event twice is idempotent — no duplicate is created. Users can also remove a saved event via the **Saved** toggle.

#### Ownership and admin controls

Publisher suppliers can edit, cancel or delete only their **own** events. Admins can manage any event, filter by status/supplier/date/event type via the API, review publishing requests, and use the Admin → Supplier Detail tri-state override controls:

| Value            | Effect                                         |
| ---------------- | ----------------------------------------------- |
| `true`           | Supplier can publish regardless of category    |
| `false`          | Supplier cannot publish regardless of category |
| `null` (default) | Derive from category (see table above)         |

### Admin Authentication

EventFlow implements a gold-standard admin authentication system with two mechanisms:

**1. Protected Owner Account**

- Single, protected admin account that cannot be deleted or demoted
- Automatically created on server startup
- Pre-verified (no email verification required)
- Configured via environment variables (OWNER_EMAIL, OWNER_PASSWORD)

**2. Domain-Based Admin Promotion**

- Automatic admin role for verified emails from trusted domains
- Configured via ADMIN_DOMAINS environment variable (e.g., `your-company.com`)
- Requires email verification before promotion (security)
- Supports multiple domains (comma-separated)

**Quick Setup:**

```bash
# .env
OWNER_EMAIL=admin@your-company.com
OWNER_PASSWORD=your-strong-password
ADMIN_DOMAINS=your-company.com
```

📚 **[Complete Admin Setup Guide →](docs/ADMIN_SETUP.md)** · **[Admin API v2 / RBAC Reference →](docs/api/ADMIN_API_V2.md)**

### 🔒 Security

EventFlow implements industry-standard security practices:

#### HTTPS & Transport Security

- **HTTPS Enforcement**: All HTTP requests are redirected to HTTPS in production
- **HSTS**: HTTP Strict Transport Security enabled with 1-year max-age
- **Secure Cookies**: Authentication cookies use `httpOnly`, `secure` (production), and `sameSite` flags

#### Security & Performance

- ✅ **Rate Limiting** - Protects against abuse with endpoint-specific limits (~15 distinct limiters across the API)
  - Authentication: 10 requests / 15 minutes
  - File Uploads: 20 requests / 15 minutes
  - Search/Discovery: 30 requests / minute
  - Notifications: 50 requests / 5 minutes
- ✅ **Input Validation** - Express-validator for all user inputs
- ✅ **Security Headers** - Helmet.js with CSP, HSTS, and other protections
- ✅ **API Versioning** - `/api/v1/` prefix with backward-compatible unversioned aliases
- ✅ **CSRF Protection** - Token-based protection for all state-changing operations
- ✅ **MongoDB Sanitization** - Prevents NoSQL injection attacks
- ✅ **Password Hashing** - Bcrypt with salt rounds
- ✅ **Partner Anti-Abuse** - Device/IP risk scoring and reward-integrity checks on the referral program (see [Partner & Referral Program](#partner--referral-program))
- 📚 **[Full Security Documentation →](docs/SECURITY_FEATURES.md)**

#### Security Headers (via Helmet)

- **Content Security Policy (CSP)**: Restricts resource loading to trusted domains
- **X-Frame-Options**: Prevents clickjacking with `DENY`
- **X-Content-Type-Options**: Prevents MIME-sniffing with `nosniff`
- **Referrer-Policy**: Set to `strict-origin-when-cross-origin`

#### Input Validation & Sanitization

- MongoDB query sanitization via `express-mongo-sanitize`
- Input validation using `validator` library
- Rate limiting on authentication and write endpoints

#### Monitoring

- CSP violation reporting endpoint at `/api/csp-report`
- Sentry integration for error tracking (both server and browser)
- Audit logging for admin actions

### ⚡ Performance

EventFlow implements comprehensive performance optimizations for production deployments:

#### Compression Strategy

- **Brotli Compression**: Primary compression method (15-20% better than gzip)
- **Gzip Fallback**: Automatic fallback for older clients
- **Selective Compression**: Only compresses text-based content > 1KB
- **Quality Tuning**: Balanced compression levels for optimal speed/size ratio
  - Brotli quality: 4 (good for dynamic content)
  - Gzip level: 6 (default balanced setting)

**Verify Compression:**

```bash
curl -H "Accept-Encoding: br" -I https://yourdomain.com/
# Should return: Content-Encoding: br
```

#### Caching Strategy

EventFlow uses a multi-tier caching strategy for optimal performance:

- **HTML Pages**: 5-minute cache (`max-age=300, must-revalidate`)
- **Versioned Assets** (hashed filenames): 1-year cache (`max-age=31536000, immutable`)
- **Static Assets** (CSS/JS/images): 1-week cache (`max-age=604800, must-revalidate`)
- **User Uploads**: 1-year cache (`max-age=31536000, immutable`)

**Verify Caching:**

```bash
curl -I https://yourdomain.com/assets/css/styles.css
# Should return: Cache-Control: public, max-age=604800, must-revalidate
```

#### Asset Optimization

- **Minified Assets**: CSS and JS bundles are production-ready
- **Optimized Favicon**: SVG favicon, extremely small
- **Deferred Loading**: JavaScript loads with `defer` attribute
- **Lazy Loading**: Images load on-demand as they enter viewport

#### Performance Verification

EventFlow includes a built-in performance verification endpoint:

```bash
# Check compression and caching configuration
curl http://localhost:3000/api/performance
```

**Response includes:**

- Client compression support (Brotli, gzip, deflate)
- Server compression configuration
- Caching strategy documentation
- Performance recommendations

**Full Testing Guide:** See [docs/PERFORMANCE_TESTING.md](docs/PERFORMANCE_TESTING.md) and [docs/guides/PERFORMANCE_OPTIMIZATION.md](docs/guides/PERFORMANCE_OPTIMIZATION.md)

#### Image Optimization

- **Sharp** library for server-side image processing before upload
- **Cloudinary** for storage, on-the-fly transforms, and CDN delivery
- Automatic thumbnail generation on upload

#### CDN Recommendation

For production deployments, we recommend adding Cloudflare in front of Railway for global edge caching, DDoS protection, and automatic Brotli compression. See [docs/guides/CLOUDFLARE_SETUP.md](docs/guides/CLOUDFLARE_SETUP.md).

---

## 🚀 Quick Start

### Local Development

#### Prerequisites

- Node.js 22.x and npm (use the exact version pinned in `.node-version`)
- **Optional:** MongoDB 6.0+ (local or Atlas) for production deployments

**Note:** EventFlow uses file-based JSON storage by default for zero-configuration setup. MongoDB is available for production use - see [MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md).

#### Installation

```bash
# Clone repository
git clone https://github.com/rhysllwydlewis/EventFlow.git
cd EventFlow

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration (MongoDB is optional)

# Start server (no migration needed for file-based storage)
npm start

# Optional: Migrate to MongoDB (for production)
# npm run migrate
```

Visit http://localhost:3000

#### Docker Quick Start

```bash
# Start all services (app + MongoDB + Mongo Express)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Services:**

- App: http://localhost:3000
- API Docs: http://localhost:3000/api-docs
- MongoDB UI: http://localhost:8081

See the Docker Compose commands above, or `docker-compose.yml`, for the full service definitions.

### Production Deployment

**Deploying to production (Railway, Heroku, etc.)?** Follow these steps to avoid 502 errors:

#### Prerequisites

- ✅ Node.js 22.x (use the exact version pinned in `.node-version`)
- ✅ **MongoDB Atlas account (free tier available)** ← Most important!
- ✅ Deployment platform account (Railway, Heroku, etc.)

#### Essential Steps (15 minutes)

1. **Set up MongoDB Atlas** (Required - app won't start without this!)
   - 📚 **[Follow our simple step-by-step guide →](.github/docs/MONGODB_SETUP_SIMPLE.md)** (no technical knowledge needed)
   - 📚 Or see [MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md) for technical details
   - Get your connection string from MongoDB Atlas

2. **Configure Environment Variables** on your deployment platform:

   ```bash
   # Required
   MONGODB_URI=mongodb+srv://your-actual-connection-string
   JWT_SECRET=your-random-secret-min-32-chars
   NODE_ENV=production
   BASE_URL=https://yourdomain.com
   REDIS_URL=redis://default:password@redis-host:6379
   POSTMARK_API_KEY=your-server-token

   # Recommended
   EMAIL_ENABLED=true
   POSTMARK_FROM=admin@yourdomain.com
   ```

3. **Deploy your app** - Push to your platform (Railway, Heroku, etc.)

4. **Run a dedicated worker process in production** (required for messaging/notification/email queue fanout — see [Background Jobs & Queue Architecture](#-background-jobs--queue-architecture)):

   ```bash
   node scripts/worker.js
   ```

   - `Procfile` already defines the worker process and its health-check mode
   - Railway users should deploy a second service with `railway.worker.json`
   - In production, worker startup fails fast unless MongoDB, Redis, HTTPS `BASE_URL`, and Postmark are ready
   - If deployments share Redis, set a unique `EVENTFLOW_QUEUE_NAMESPACE` for each environment

5. **Verify it works** - Visit `https://yourdomain.com/api/ready`
   - It should return 200 and show both queue producer and worker delivery as ready

#### Troubleshooting 502 Errors

Getting "502 Bad Gateway" or "connection refused" errors? This usually means MongoDB isn't configured:

| Error Message                                    | Solution                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Invalid scheme, expected connection string..."   | You're using the placeholder from `.env.example`. Get your real connection string from MongoDB Atlas - [see guide](.github/docs/MONGODB_SETUP_SIMPLE.md) |
| "Authentication failed" or "bad auth"             | Wrong password in connection string. Reset it in MongoDB Atlas → Database Access                                                                         |
| "Connection timeout" or "ENOTFOUND"               | IP not whitelisted. Add `0.0.0.0/0` in MongoDB Atlas → Network Access                                                                                     |
| "No cloud database configured"                    | `MONGODB_URI` environment variable not set on your deployment platform                                                                                    |

**📚 Detailed troubleshooting:** See [MONGODB_SETUP_SIMPLE.md](.github/docs/MONGODB_SETUP_SIMPLE.md#common-problems-and-solutions)

---

## 🛠️ Tech Stack

**Backend:**

- Node.js & Express.js
- MongoDB — the official `mongodb` Node driver (no ORM), with JSON-schema validators and indexes defined in `models/index.js`
- JWT authentication (`jsonwebtoken`, `bcryptjs`)
- Multer (uploads, in-memory) + Sharp (image processing) + Cloudinary (image storage & CDN)
- Socket.IO (`socket.io`) — real-time messaging, presence, typing indicators, read receipts

**Background jobs:**

- BullMQ + ioredis — durable, retrying job queues for notification/email fan-out (see [Background Jobs & Queue Architecture](#-background-jobs--queue-architecture))
- `node-schedule` — in-process scheduled/cron-style jobs (digests, cleanup, reminders)

**Payments:**

- Stripe (`stripe`) — subscriptions, proration, webhooks; no other payment provider is integrated

**Auth providers:**

- Google Identity Services, Facebook Login (Graph API), Apple Sign In (implemented, currently disabled — see [Environment Variables](#-environment-variables))
- `speakeasy` + `qrcode` (TOTP two-factor auth), Twilio (SMS phone verification)

**Email:**

- Postmark (`postmark`) — transactional email delivery, used exclusively (no SES/SMTP fallback)
- Local HTML templates in `email-templates/` (no hosted templates required)

**Security:**

- Helmet (security headers), `express-mongo-sanitize`, `express-rate-limit`, `express-validator`
- `altcha-lib` (proof-of-work CAPTCHA), DOMPurify + `jsdom` (server-side sanitisation)

**Monitoring:**

- Winston (structured logging), Morgan (HTTP logging), Sentry (`@sentry/node` + `@sentry/browser`)

**Documentation:**

- Swagger/OpenAPI 3.0 (`swagger-jsdoc`, `swagger-ui-express`)

**Testing:**

- Jest + Supertest, Playwright (+ `@axe-core/playwright` for accessibility), Artillery (load testing), `mongodb-memory-server`

**Notably *not* used**, despite older docs or `.env.example` entries suggesting otherwise: Mongoose (native driver only), AWS SDK/S3 (Cloudinary is the image store), and OpenAI (the in-app AI planning assistant was retired — see [API Endpoints](#-api-endpoints)).

## 🔁 Background Jobs & Queue Architecture

EventFlow runs two processes in production: the web process (`server.js`) and a dedicated worker process (`scripts/worker.js`), connected through two BullMQ queues — `notifications` and `email` — backed by Redis.

- **Deterministic, idempotent jobs**: job IDs are SHA-256 hashes derived from the message/recipient, so re-enqueuing the same logical job is a no-op. This is what lets a durable-recovery reconciler safely replay any notification fan-out that was missed if the worker restarts mid-flight.
- **Dev/no-Redis fallback**: if `REDIS_URL` is unset outside production, queue calls resolve to an in-process synchronous stub that runs the handler inline — no Redis needed for local development. **Production refuses to start without `REDIS_URL`.**
- **Retry policy**: 5 attempts with exponential backoff; failed email jobs are kept (up to 500) for inspection, failed notification jobs are dropped once their state is persisted on the message document itself.
- **Worker heartbeat**: the worker writes a heartbeat to Redis every 10s (45s TTL). `/api/ready` requires a heartbeat younger than 30s to report ready, so a stalled worker fleet is detectable from outside the process.
- **Message flow**: HTTP send → immediate Socket.IO emit → one deterministic notification job enqueued → notification worker does idempotent in-app fan-out → one deterministic email job enqueued per recipient → email worker sends via Postmark with its own retry/backoff.
- **Namespacing**: set a unique `EVENTFLOW_QUEUE_NAMESPACE` per environment if multiple EventFlow deployments share the same Redis instance.

`Procfile` already defines both processes:

```
web: node server.js
worker: EVENTFLOW_PROCESS_TYPE=worker node scripts/worker.js
```

📚 Full detail: [docs/messenger/queue.md](docs/messenger/queue.md) and [docs/messenger/transactions.md](docs/messenger/transactions.md).

## 🔧 Environment Variables

`.env.example` documents ~80 variables in full; the blocks below cover the ones you actually need to get a production deployment working.

**Required for Production:**

```env
# Database - MOST IMPORTANT! App won't start without this
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow
# 👆 Get this from MongoDB Atlas - see .github/docs/MONGODB_SETUP_SIMPLE.md

# Security
JWT_SECRET=your-secret-key-min-32-chars

# Environment
NODE_ENV=production
BASE_URL=https://yourdomain.com
```

**Required if you run the worker process (queues/real-time delivery):**

```env
REDIS_URL=redis://default:password@redis-host:6379
EVENTFLOW_QUEUE_NAMESPACE=production   # only needed if multiple deployments share one Redis
```

**Recommended (Email functionality):**

```env
EMAIL_ENABLED=true
POSTMARK_API_KEY=your-server-token
POSTMARK_FROM=admin@yourdomain.com
```

**Photo storage (Cloudinary):**

```env
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
```

**Optional — Stripe (subscriptions & billing):**

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_PRO_PLUS_PRICE_ID=price_...
STRIPE_PRO_PLUS_YEARLY_PRICE_ID=price_...
# Optional: trial length, automatic tax, and an intro-pricing coupon for Professional
STRIPE_SUBSCRIPTION_TRIAL_DAYS=0
STRIPE_AUTOMATIC_TAX_ENABLED=false
STRIPE_PRO_INTRO_COUPON_ID=
```

Without Stripe keys configured, billing endpoints fall back gracefully (subscriptions simply aren't available) rather than crashing the app. See [docs/guides/STRIPE_INTEGRATION_GUIDE.md](docs/guides/STRIPE_INTEGRATION_GUIDE.md) and [docs/guides/STRIPE_INTRO_PRICING_SETUP.md](docs/guides/STRIPE_INTRO_PRICING_SETUP.md).

**Optional — Social sign-in:**

```env
# Google Identity Services — shows the "Sign in with Google" buttons and verifies ID tokens server-side
GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
# GOOGLE_CLIENT_IDS=web-client-id,ios-client-id   # optional, comma-separated extra client IDs

# Facebook Login — shows "Continue with Facebook" and verifies access tokens via the Graph API server-side
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Apple Sign In — fully implemented but currently switched OFF at the frontend
# (button is hidden pending a paid Apple Developer account). Setting these does
# NOT re-enable it by itself — see docs/APPLE_SIGN_IN_WITH_APPLE.md.
# APPLE_CLIENT_ID=uk.co.event-flow.web
```

Google sign-in uses Google Identity Services (`https://accounts.google.com/gsi/client`) for the branded login/sign-up buttons and server-verified ID tokens. Facebook Login uses an OAuth authorization-code redirect flow (no client-side JS SDK); the access token is exchanged and verified server-side via the Graph API. Apple Sign In's backend and frontend code are both complete and wired up, but the button is hidden behind a frontend flag because Apple requires a paid Developer Program membership that hasn't been purchased yet — flipping the flag and setting `APPLE_CLIENT_ID` is enough to re-enable it once that's sorted.

**Optional — Phone verification (Twilio) & Two-Factor Auth:**

```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+441234567890

# 2FA secrets are encrypted at rest; falls back to JWT_SECRET if unset
ENCRYPTION_KEY=your_encryption_key_here
```

**⚠️ Common mistake:** Using the placeholder value from `.env.example` will cause 502 errors!
Get your real connection string: **[MongoDB Setup Guide](.github/docs/MONGODB_SETUP_SIMPLE.md)**

See [.env.example](.env.example) for all options, including community/partner-program salts, external-contact-integration secrets, and per-feature rate-limit overrides.

### Database Configuration

**EventFlow uses MongoDB Atlas as the primary database for production deployments:**

1. **MongoDB Atlas (PRIMARY - Recommended for Production)**
   - The system automatically prioritizes MongoDB over local storage
   - All data stored in MongoDB Atlas across ~75 collections (see [Database Schema](#️-database-schema))
   - Configured in `db-unified.js` to try MongoDB first
   - Set `MONGODB_URI` in environment variables with your Atlas connection string

   **Setup Instructions:**
   - Create a free MongoDB Atlas account at https://cloud.mongodb.com/
   - Follow the [MongoDB Setup Guide](.github/docs/MONGODB_SETUP_SIMPLE.md) for step-by-step instructions
   - Get your connection string and configure it in Railway or your hosting platform
   - **Important**: Never commit your actual connection string to git

   ```env
   # Production MongoDB Configuration
   MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=eventflow
   ```

2. **Local Storage (Development Only)**
   - If MongoDB is not configured, falls back to local file storage
   - **Not suitable for production** - data is stored in JSON files
   - Useful for quick local development and testing

3. **Photo Storage**
   - Photos are uploaded in-memory via Multer, processed with Sharp, and stored on **Cloudinary** — there is no local-filesystem or AWS S3 storage path in the current codebase (older `/uploads/` URLs are legacy and no longer written to)
   - Set the `CLOUDINARY_*` variables above to enable uploads

4. **How Database Priority Works**:
   - On startup, `db-unified.js` attempts MongoDB connection first (PRIMARY)
   - If MongoDB is not available, falls back to local files (dev only)
   - Check logs on startup for connection status:
     - `✅ Using MongoDB for data storage (PRIMARY)` - Production ready
     - `⚠️  Using local file storage` - Development only, not for production

**To verify your database is connected**: Check server logs after starting the app, or visit `/api/health` endpoint. You should see MongoDB status, not local storage in production.

**Production Deployment Checklist**:

- ✅ MongoDB Atlas account created and cluster configured
- ✅ Database user with read/write permissions created
- ✅ Network access configured (IP whitelist or allow all)
- ✅ `MONGODB_URI` environment variable set in Railway/hosting platform
- ✅ Connection string uses actual credentials (not placeholders)
- ✅ Never commit real credentials to git - use environment variables only

### Email Configuration

EventFlow uses **Postmark exclusively** for all transactional emails:

1. Sign up at https://postmarkapp.com
2. Get your Server API Token from the dashboard
3. Verify your sender domain or email address
4. Create message streams: `outbound` (default), `password-reset`, `broadcasts`
5. Add to `.env`:
   ```bash
   POSTMARK_API_KEY=your-server-token
   POSTMARK_FROM=admin@yourdomain.com
   EMAIL_ENABLED=true
   ```

**📖 Full Setup Guide:** [docs/guides/POSTMARK_SETUP.md](docs/guides/POSTMARK_SETUP.md). **Admin Email Tools:** [docs/EMAIL_CENTRE.md](docs/EMAIL_CENTRE.md) covers the admin email activity, campaign, and template-preview console at `/admin-emails`.

During development without Postmark configured, emails are saved to `/outbox` folder for inspection.

**Production Email Checklist**:

- ✅ Postmark account created
- ✅ Server API token obtained
- ✅ Sender domain/email verified in Postmark
- ✅ Message streams configured (outbound, password-reset, broadcasts)
- ✅ `POSTMARK_API_KEY` environment variable set
- ✅ `POSTMARK_FROM` set to verified sender address (e.g. `admin@yourdomain.com`)
- ✅ Webhooks configured for delivery tracking (optional but recommended)
- ✅ Never commit API keys to git - use environment variables only

**Webhook URL (optional):** `https://yourdomain.com/api/webhooks/postmark`

## 📖 API Endpoints

EventFlow's API spans **106 route modules**. The groups below are a starting-point sample, not the full surface — treat the interactive [Swagger UI](#-api-documentation) at `/api-docs` as the source of truth for the complete, always-current reference.

### Authentication

```text
POST   /api/auth/register        - Register new user
POST   /api/auth/login           - Login
POST   /api/auth/logout          - Logout
GET    /api/auth/me              - Get current user
GET    /api/auth/verify          - Verify email with token
POST   /api/auth/resend-verification - Resend verification email
POST   /api/auth/forgot          - Request password reset
POST   /api/v1/me/2fa/setup      - Begin TOTP setup (returns QR code)
POST   /api/v1/me/2fa/verify     - Confirm TOTP code and enable 2FA
GET    /api/v1/me/2fa/status     - Check whether 2FA is enabled
```

### Search & Discovery

```text
GET    /api/search/suppliers     - Advanced supplier search
GET    /api/search/categories    - Get all categories
GET    /api/search/amenities     - Get all amenities
GET    /api/discovery/trending   - Trending suppliers
GET    /api/discovery/new        - New suppliers
GET    /api/discovery/recommendations - Personalized recommendations
```

### Reviews & Ratings

```text
POST   /api/reviews              - Create review
GET    /api/reviews/supplier/:id - Get supplier reviews
GET    /api/reviews/supplier/:id/distribution - Rating distribution
POST   /api/reviews/:id/helpful  - Mark review helpful
DELETE /api/reviews/:id          - Delete review
```

### Packages

```text
GET    /api/packages/featured    - Get featured packages
GET    /api/packages/search      - Search packages
GET    /api/packages/:slug       - Get package details by slug
```

### Photo Management

```text
POST   /api/photos/upload        - Upload single photo
POST   /api/photos/upload/batch  - Upload multiple photos
DELETE /api/photos/delete        - Delete photo
POST   /api/photos/crop          - Crop image
GET    /api/photos/pending       - Get pending photos (admin)
POST   /api/photos/approve       - Approve/reject photo (admin)
```

### Messenger v4

```text
GET    /api/v4/messenger/conversations       - List conversations
GET    /api/v4/messenger/conversations/:id   - Get a conversation
GET    /api/v4/messenger/unread-count        - Total unread count
GET    /api/v4/messenger/contacts            - List messageable contacts
POST   /api/v4/messenger/block               - Block a user
GET    /api/v4/messenger/admin/conversations - Admin: view all conversations
```

### Subscriptions & Billing (API)

```text
GET    /api/v2/subscriptions/plans           - List available plans (Starter/Pro/Pro Plus)
GET    /api/v2/subscriptions/me              - Current user's subscription
GET    /api/v2/subscriptions/upcoming-invoice - Preview the next invoice
POST   /api/v2/subscriptions/:id/cancel      - Cancel a subscription
GET    /api/v2/invoices                      - List invoices
GET    /api/v2/admin/subscriptions           - Admin: list all subscriptions
```

### Community

```text
GET    /api/v1/community/categories          - List forum categories
GET    /api/v1/community/discussions         - List/search discussions
GET    /api/v1/community/home                - Community home feed
GET    /api/v1/admin/community/...           - Admin moderation endpoints
```

### Partner / Referral Program

```text
POST   /api/v1/partner/register              - Apply to become a partner
GET    /api/v1/partner/me                    - Partner profile & status
GET    /api/v1/partner/referrals             - List referrals
GET    /api/v1/partner/stats                 - Points/reward summary
GET    /api/v1/admin/partners/...            - Admin partner management
GET    /api/v1/admin/partner-abuse/...       - Admin anti-abuse review queue
```

### Wedding Websites, Guests & Quote Requests

```text
GET    /api/v1/me/plans/:planId/wedding-website     - Get a customer's wedding website
GET    /api/public/wedding-websites/:slug           - Public wedding website by slug
POST   /api/public/wedding-websites/:slug/rsvp       - Submit an RSVP
GET    /api/v1/me/plans/:planId/guests               - List guests
GET    /api/v1/me/plans/:planId/guests/export.csv    - Export guest list as CSV
POST   /api/v1/quote-requests                        - Submit a quote request
```

### Locations

```text
GET    /api/v1/locations/featured             - Featured location hub pages
GET    /locations/:citySlug                   - City hub page (server-rendered)
GET    /locations/:citySlug/:categorySlug     - City × category spoke page
```

### AI Planning Assistant — retired

`POST /api/ai/suggestions` and `POST /api/ai/plan` now return `410 Gone` — the legacy OpenAI-backed in-app planning assistant has been retired. Its replacement, **JadeAssist**, is a separately deployed chat widget (its own Railway service) embedded via a self-hosted script; it is not part of this repo's own API surface.

### Admin Endpoints

```text
GET    /api/admin/users          - List all users
PUT    /api/admin/users/:id      - Edit user profile
DELETE /api/admin/users/:id      - Delete user
POST   /api/admin/users/:id/verify           - Manually verify user email
POST   /api/admin/users/:id/grant-admin      - Grant admin privileges
POST   /api/admin/users/:id/revoke-admin     - Revoke admin privileges
GET    /api/admin/suppliers      - List all suppliers
PUT    /api/admin/suppliers/:id  - Edit supplier
DELETE /api/admin/suppliers/:id  - Delete supplier
POST   /api/admin/suppliers/:id/verify       - Manually verify supplier identity
POST   /api/admin/suppliers/smart-tags       - Generate smart tags for suppliers
GET    /api/admin/packages       - List all packages
PUT    /api/admin/packages/:id   - Edit package
DELETE /api/admin/packages/:id   - Delete package
GET    /api/admin/metrics        - Get dashboard metrics
GET    /api/admin/users-export   - Export users (CSV)
GET    /api/admin/export/all     - Export all data (JSON)
```

### Messaging Endpoints (legacy v1)

```text
GET    /api/messages/threads                      - List conversation threads
POST   /api/messages/threads                      - Create new conversation
GET    /api/messages/threads/:id                  - Get thread details
GET    /api/messages/threads/:id/messages         - Get messages in thread
POST   /api/messages/threads/:id/messages         - Send message in thread
POST   /api/messages/threads/:id/mark-read        - Mark thread as read
GET    /api/messages/drafts                       - Get draft messages
PUT    /api/messages/:id                          - Update draft message
DELETE /api/messages/:id                          - Delete draft message
```

New frontend code should use [Messenger v4](#messenger-v4) instead — see [docs/guides/MESSENGER_V4_MIGRATION.md](docs/guides/MESSENGER_V4_MIGRATION.md).

See the interactive [Swagger UI](#-api-documentation) at `/api-docs`, [docs/api/API_DOCUMENTATION.md](docs/api/API_DOCUMENTATION.md), and [docs/api/ADMIN_API_V2.md](docs/api/ADMIN_API_V2.md) for the complete, always-current API reference.

## 📱 User Flows & Pages

The frontend has around 100 top-level HTML pages (roughly a third of them under `admin-*.html`), plus dedicated SPA-style subdirectories for the partner portal (`public/partner/`), the v4 messenger (`public/messenger/`), and supplier onboarding tools (`public/supplier/`). Two of the most-touched flows are documented in detail below; browse `public/` for the rest.

### Email Verification Flow

EventFlow implements a secure email verification system for new user accounts:

**User Journey:**

1. User registers for an account at `/auth.html`
2. System sends verification email with a unique 24-hour token via Postmark
3. User clicks verification link in email → redirects to `/verify.html?token=<token>`
4. Page automatically calls `/api/auth/verify` API with the token
5. System displays branded verification status:
   - ✅ **Success**: "Email Verified!" with auto-redirect to appropriate dashboard
   - ❌ **Expired**: Shows expiration message with resend form
   - ❌ **Invalid**: Shows invalid token message with resend form
   - ⚠️ **No Token**: Shows instructions with resend form
6. After successful verification, user is redirected to:
   - Admin users → `/admin.html`
   - Supplier users → `/dashboard-supplier.html`
   - Customer users → `/dashboard-customer.html`

**Features:**

- Token-based verification with 24-hour expiration for security
- Branded UI with appropriate icons and messages for all states
- Resend verification email functionality
- Auto-redirect after successful verification
- Manual navigation buttons (Go to Dashboard, Go to Home)
- Email validation and error handling

**Screenshot:**
![Email Verification Page](https://github.com/user-attachments/assets/ca0d5df7-24cd-45f9-8c80-ed7c4f38a0c1)

### Package Detail Page Flow

Users can browse and view detailed information about service packages:

**User Journey:**

1. User discovers packages on homepage featured carousel or category pages
2. Clicks on package card → navigates to `/package.html?slug=<package-slug>`
3. Page loads full package details via `/api/packages/:slug` API
4. User views comprehensive package information and supplier details
5. User can:
   - Browse package photo gallery
   - Read full description and pricing
   - View tags and categories
   - See supplier profile information
   - Message the supplier (requires authentication)
   - Navigate to supplier's other packages

**Package Detail Features:**

- **Image Gallery**: Multiple photos with thumbnail navigation and full-screen view
- **Package Information**:
  - Title, description, and detailed information
  - Pricing (or "Contact for price")
  - Location with map icon
  - Categories and tags
  - Featured badge (if applicable)
- **Supplier Card**:
  - Supplier logo and name
  - Business description
  - Contact information (email, phone)
  - Location
  - Link to view all supplier packages
- **Message Panel**: Auth-gated messaging system to contact supplier
- **Breadcrumb Navigation**: Home → Category → Package
- **Responsive Design**: Mobile-friendly layout

**Linking from Homepage:**

- Package cards on the homepage automatically link to detail pages
- Implemented via `PackageList` component: `window.location.href = '/package.html?slug=${pkg.slug}'`
- Featured packages carousel also links to detail pages
- All package cards are clickable with hover effects

**Screenshot:**
![Package Detail Page](https://github.com/user-attachments/assets/5a312a8d-0f34-4c54-9e27-895ed06b9c91)

**Technical Implementation:**

- URL Pattern: `/package.html?slug=<package-slug>`
- API Endpoint: `GET /api/packages/:slug`
- JavaScript Handler: `/assets/js/pages/package-init.js` (inline in package.html)
- Components Used:
  - `PackageGallery` - Image gallery component
  - `SupplierCard` - Supplier information display
  - `MessageSupplierPanel` - Messaging interface
- Authentication: Required only for messaging functionality

## 📁 Project Structure

```text
eventflow/
├── routes/            # 106 Express route modules — one per feature area:
│   ├── auth.js, google-redirect-auth.js, facebook-redirect-auth.js,
│   │   apple-redirect-auth.js, twoFactor.js, phoneVerification.js
│   ├── admin*.js      # ~26 admin route modules (users, suppliers, community,
│   │                  #   partners, cashout, email centre, webhooks test, ...)
│   ├── messenger-v4.js, community*.js, partner*.js, subscriptions-v2.js,
│   │   wedding-websites.js, guests.js, quote-requests.js, locations.js, ...
│   └── suppliers.js, packages.js, reviews-v2.js, search.js, discovery.js, ...
├── services/          # ~100 business-logic modules, incl. queue/ (BullMQ),
│   │                  #   ~25 partner anti-abuse/reward-integrity services,
│   │                  #   messenger, community, location, billing, notification
│   │                  #   fan-out, search ranking, and scheduled-job runners
│   └── queue/
│       ├── index.js           # Queue setup, health, dev fallback
│       └── workers/           # notification.worker.js, email.worker.js
├── middleware/         # 29 modules — JWT auth, CSRF, rate limiting, sanitize,
│                        #   RBAC permissions, subscription gating, feature
│                        #   flags, A/B testing, API versioning/deprecation
├── models/             # 17 schema/constant definitions + index.js
│                        #   (Mongo JSON-schema validators & index creation)
├── config/             # billingPlans.js, stripe.js, database.js, email.js,
│                        #   storage.js, adminRegistry.js, messagingLimits.js
├── utils/               # ~55 shared helpers — encryption, logging, Sentry,
│                        #   geocoding, lead scoring, sentiment analysis, badges
├── public/              # Frontend — ~100 top-level .html pages, plus:
│   ├── assets/         #   css/ (130+ files), js/ (325+ files: components/,
│   │                   #   pages/, config/, vendor/, community/)
│   ├── articles/       #   33 SEO guide articles
│   ├── messenger/      #   Messenger v4 SPA shell
│   ├── partner/        #   Partner portal (dashboard, media pack, terms)
│   ├── supplier/       #   Marketplace listing form, profile customisation
│   └── newsletter/     #   Confirm/expired/unsubscribe pages
├── email-templates/     # 24 Postmark-rendered transactional email templates
├── data/                # JSON data storage (development fallback only)
├── tests/               # Jest unit/integration/a11y/load/visual suites
├── e2e/                 # 67 Playwright specs
├── scripts/             # 45 ops/CLI scripts — worker.js, migrations, audits,
│                        #   sitemap generation, preflight, release tagging
├── docs/                # 130+ reference docs across api/, guides/, features/,
│                        #   architecture/, compliance/, messenger/, marketplace/
├── server.js            # Main application server (route mounting, ~82KB)
├── db-unified.js        # MongoDB collection-access abstraction layer (PRIMARY)
├── websocket-server.js / websocket-server-v2.js  # Socket.IO servers (v1/v2)
└── package.json         # Dependencies and scripts
```

**WebSocket Server Modes:**

EventFlow includes two Socket.IO-based real-time servers. Only ONE can run at a time (configured via `WEBSOCKET_MODE` environment variable):

- **v2** (default, recommended): Modern real-time server with messaging, presence tracking, typing indicators, read receipts, and emoji reactions
- **v1** (legacy): Basic real-time server for notifications only (backwards compatibility)
- **off**: Disables real-time servers (not recommended - disables all real-time features)

⚠️ **Important**: Running both v1 and v2 simultaneously will cause crashes with "server.handleUpgrade() was called more than once" errors. The `WEBSOCKET_MODE` environment variable ensures only one server attaches to the HTTP server.

## 🗄️ Database Schema

EventFlow uses the native MongoDB driver (no ORM) with roughly **75 collections** across the following domains. All collections use JSON-schema validation, optimized indexes, and automatic timestamps (`models/index.js`).

**Core marketplace:** `users`, `suppliers`, `packages`, `plans` (also holds embedded `weddingWebsite` and `guests`/`guestList` sub-documents — these are not separate collections), `categories`, `events`, `bookings`

**Classifieds marketplace:** `marketplace_listings`, `marketplace_images`

**Messaging (Messenger v4):** `conversations`, `messages`, `conversation_counters`, `messageFolders`, `messageLabels`, `messageOperations`, `blockedUsers`, plus legacy `threads`/`chat_messages`

**Reviews:** `reviews`, `reviewVotes`, `reviewModerations`, `reviewRequests`

**Community:** `community_discussions`, `community_categories`, `community_replies`, `community_reactions`, `community_bookmarks`, `community_follows`, `community_reports`, `community_moderation_actions`, `community_appeals`, `community_user_stats`, `community_views`, `community_drafts`, `community_settings`, `community_poll_votes`, `community_restrictions` (~15 collections total)

**Partner / referral program:** `partners`, `partner_referrals`, `partner_credit_transactions`, `partner_cashout_requests`, `partner_cashout_operation_locks`, `partner_abuse_appeals`, `partner_abuse_events`, `partner_fraud_assessments`, `partner_reward_integrity_events`, `referrals` (~13 collections total)

**Billing:** `subscriptions`, `payments`, `invoices`

**Location hub pages:** `location_pages`

**Support & ops:** `tickets`, `notifications`, `contact_enquiries`, `enquiries`, `quoteRequests`, `reports`

**Email infrastructure:** `email_logs`, `email_bounces`, `email_clicks`, `email_complaints`, `email_opens`

**Public calendar:** `customer_calendar_entries`, `public_calendar_events`, `public_calendar_saves`

**Content & admin:** `badges`, `photos`, `content_review_settings`, `content_review_tasks`, `audit_logs`, `system_checks`, `background_job_runs`, `scheduler_locks`, `mongodb_webhook_log`

**Search & discovery:** `searchHistory`, `savedSearches`, `popularSearches`, `savedItems`, `shortlists`

## 🚢 Deployment

**⚠️ First-time deploying?** See [Quick Start → Production Deployment](#production-deployment).

### Railway

```bash
railway login
railway init
# Set environment variables (use your REAL MongoDB connection string!)
railway variables set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
railway up
```

Deploy a **second Railway service** for the worker process using `railway.worker.json` — see [Background Jobs & Queue Architecture](#-background-jobs--queue-architecture).

### Heroku

```bash
heroku create eventflow-app
# Set environment variables (use your REAL MongoDB connection string!)
heroku config:set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
git push heroku main
```

### DigitalOcean App Platform

```bash
# Configure via dashboard or doctl CLI
doctl apps create --spec .do/app.yaml
```

### AWS EC2 / VPS

See [docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md](docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md) for detailed instructions.

## 🧪 Testing & Quality Assurance

EventFlow includes a comprehensive testing framework to ensure code quality and reliability.

### Test Infrastructure

- **Framework:** Jest with Supertest for integration testing
- **Coverage Target:** 70% for all code (branches, functions, lines, statements)
- **Test Types:** Unit, integration, end-to-end (Playwright), visual regression, accessibility (axe-core), mutation testing (Stryker), and fuzz testing

### Running Tests

```bash
# Run all tests with coverage
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run e2e tests with Playwright (67 spec files)
npm run test:e2e

# Full e2e suite: static + backend-driven
npm run test:e2e:full

# Accessibility, visual regression, and mutation testing
npm run test:a11y
npm run test:visual
npm run test:mutation
```

### Test Structure

```text
tests/
├── fixtures/           # Test data (users, packages, suppliers)
├── utils/               # Test helpers and mock data generators
├── integration/          # Integration tests for routes (40+ files)
├── unit/                  # Unit tests for utilities
├── a11y/                   # Accessibility tests
├── load/                    # Artillery load-test scenarios
└── visual/                    # Visual regression baselines

e2e/                      # 67 Playwright specs — admin, auth, community,
                           #   messaging, homepage, navigation, SEO, supplier
                           #   onboarding, wedding website, visual regression
```

### Integration Test Examples

```javascript
// tests/integration/auth.test.js validates:
// ✓ Registration endpoint structure
// ✓ Login authentication flow
// ✓ Rate limiting enforcement
// ✓ Input validation (email, password)
// ✓ CSRF protection
// ✓ Secure cookie options
// ✓ Password hashing (bcrypt)
// ✓ JWT token generation
```

### Load Testing

EventFlow includes Artillery for load testing critical endpoints.

```bash
# Run load tests against local/staging server
npm run load-test

# Generate HTML report
npm run load-test:report
```

**Load Test Scenarios (tests/load/load-test.yml):**

- Authentication flows (registration, login)
- Search & discovery endpoints
- Package CRUD operations
- File uploads
- Real-time notifications
- Mixed traffic patterns (realistic user journeys)

**Load Test Configuration:**

- Warm-up: 60s @ 10 req/s
- Sustained: 120s @ 50 req/s
- Spike: 60s @ 100 req/s

### Operational Audits

Beyond functional tests, a set of `npm run audit:*` scripts check production readiness before a deploy: `audit:golive` (go-live checklist), `audit:action-pins` (pinned GitHub Actions), `audit:orphan-supplier-data`, and `audit:articles`. `npm run preflight` runs the standard pre-deploy check bundle.

### 📊 Monitoring & Logging

#### Winston Logger

Structured logging with multiple transports:

```javascript
const logger = require('./utils/logger');

// Log levels: error, warn, info, debug
logger.info('Server starting...');
logger.error('An error occurred', { error: err });
```

**Features:**

- Console output (colorized in development)
- File rotation (5 files × 5MB each)
- JSON format for structured logs
- Environment-aware logging levels
- Automatic error stack traces

#### Morgan HTTP Logging

HTTP request/response logging middleware:

```bash
# Development format (concise)
GET /api/packages 200 45.123 ms

# Production format (detailed)
2026-02-10T16:49:12.481Z GET /api/packages 200 45.123 ms - 1234
```

**Features:**

- Request method, URL, status code
- Response time tracking
- Content-length tracking
- ISO timestamps in production
- Custom tokens for extended info

#### Log Files

```text
logs/
├── error.log      # Error-level logs only
└── combined.log   # All logs (info, warn, error)
```

**Configuration:**

- Logs directory automatically created
- Files rotate at 5MB
- Keep 5 recent files
- Excluded from git (.gitignore)

#### Health Monitoring

```bash
# Check API health
curl https://yourdomain.com/api/health

# Response includes:
# - Status (ok/degraded)
# - Database connection status
# - Uptime
# - Memory usage
# - Environment
```

Also see `GET /api/ready`, which additionally reports queue-producer and worker-delivery health (see [Background Jobs & Queue Architecture](#-background-jobs--queue-architecture)) — this is the endpoint to point deployment-platform health checks at if you need to confirm the worker fleet is alive, not just the web process.

### 📖 API Documentation

Interactive API documentation powered by Swagger/OpenAPI 3.0:

- **URL:** `https://yourdomain.com/api-docs`
- **Format:** OpenAPI 3.0
- **Features:**
  - Try-it-out functionality
  - Request/response examples
  - Authentication flows
  - Schema definitions

#### Documented Endpoints

- Authentication (registration, login, password reset, 2FA)
- Discovery (trending, new arrivals, popular)
- Packages (CRUD operations)
- Suppliers (management, search)
- Reviews & Ratings
- Subscriptions & billing
- Admin operations (v2 RBAC)

## 🍃 MongoDB Atlas Webhooks

EventFlow supports receiving real-time change events from MongoDB Atlas via **Database Triggers** or **App Services HTTP Endpoints**.

### Endpoint

```text
POST /api/webhooks/mongodb
```

### How It Works

When a document in your Atlas cluster changes (insert, update, delete, etc.), Atlas can call this endpoint with a [change event](https://www.mongodb.com/docs/manual/reference/change-events/) payload. EventFlow verifies the payload signature, logs the event, and runs any registered handlers.

### Configuration

| Environment variable      | Description                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `MONGODB_WEBHOOK_SECRET`  | **Required in production.** Shared HMAC-SHA256 secret. Set in both `.env` and Atlas Trigger settings.   |
| `MONGODB_WEBHOOK_ENABLED` | Set to `false` to disable the endpoint entirely (default: `true`).                                       |

Generate a strong secret:

```bash
openssl rand -hex 32
```

### Setting Up in MongoDB Atlas

1. Open **Atlas App Services** → **Triggers** → **Add Trigger** (choose _Database_ trigger).
2. Configure the trigger for the collection(s) you want to watch.
3. In **Event Type**, tick the operations you care about (Insert, Update, Delete, etc.).
4. Under **Function / HTTP Endpoint**, choose _Send an HTTP request_ and set the URL to:
   ```text
   https://yourdomain.com/api/webhooks/mongodb
   ```
5. Add a custom header:
   - **Name:** `X-MongoDB-Webhook-Signature`
   - **Value:** `sha256=${HMAC-SHA256(body, MONGODB_WEBHOOK_SECRET)}`
     > Atlas supports custom headers and secrets via the _Secrets_ feature in App Services.
6. Save the trigger. EventFlow will verify every incoming request against the secret.

> **In development** (when `MONGODB_WEBHOOK_SECRET` is not set) requests are processed with a warning — verification is not enforced outside of production.

### Idempotency

The handler records processed event IDs in the `mongodb_webhook_events` collection (TTL 7 days). Retried deliveries from Atlas are automatically deduplicated.

### Testing from Admin Debug

Navigate to **Admin → Debug → Webhooks** tab and click **Test All Webhooks**. This sends a signed probe request to the MongoDB (and all other configured) webhook endpoints and surfaces pass/fail results in the UI.

## 📚 Documentation

`docs/` holds 130+ files. Many are point-in-time planning/audit/status scratch docs (`*_AUDIT.md`, `*_SUMMARY.md`, `*_STATUS.md`, `PRE_MERGE_CHECKLIST*.md`, roadmap files) that are useful history but not current reference material — the tables below link only the maintained reference docs, organised by subdirectory.

### Quick Links

- **[Quick Start](#-quick-start)** - Get running in minutes
- **[MongoDB Setup (Simple Guide)](.github/docs/MONGODB_SETUP_SIMPLE.md)** - For non-technical users
- **[Troubleshooting 502 Errors](#troubleshooting-502-errors)** - Common deployment issues
- **[Interactive API Docs](http://localhost:3000/api-docs)** - Swagger UI (when running locally)

### API & Admin

| Document                                                                   | Description                                |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| [Swagger UI](http://localhost:3000/api-docs)                                | Complete, always-current API reference      |
| [docs/api/API_DOCUMENTATION.md](docs/api/API_DOCUMENTATION.md)              | Static API reference with examples          |
| [docs/api/ADMIN_API.md](docs/api/ADMIN_API.md)                              | Admin API endpoint documentation (v1)       |
| [docs/api/ADMIN_API_V2.md](docs/api/ADMIN_API_V2.md)                        | Admin API v2 — RBAC/permission model        |
| [docs/guides/ADMIN_GUIDE.md](docs/guides/ADMIN_GUIDE.md)                    | Admin dashboard user guide                  |
| [docs/ADMIN_PANEL_GUIDE.md](docs/ADMIN_PANEL_GUIDE.md)                      | Admin panel structure & page index          |
| [docs/ADMIN_SETUP.md](docs/ADMIN_SETUP.md)                                  | Owner account & domain-based admin setup    |

### Billing, Partners & Growth

| Document                                                                             | Description                                |
| --------------------------------------------------------------------------------------| ------------------------------------------- |
| [docs/guides/STRIPE_INTEGRATION_GUIDE.md](docs/guides/STRIPE_INTEGRATION_GUIDE.md)    | Stripe.js integration setup                 |
| [docs/STRIPE_SUBSCRIPTION_GUIDE.md](docs/STRIPE_SUBSCRIPTION_GUIDE.md)                | Stripe subscription system guide            |
| [docs/guides/STRIPE_INTRO_PRICING_SETUP.md](docs/guides/STRIPE_INTRO_PRICING_SETUP.md)| Introductory pricing / coupon setup         |
| [docs/SUBSCRIPTION-TIERS.md](docs/SUBSCRIPTION-TIERS.md)                              | Supplier subscription tiers & pricing       |
| [docs/PARTNER_PORTAL.md](docs/PARTNER_PORTAL.md)                                      | Partner/referral portal and workflow        |
| [docs/PARTNER_CASHOUT_SOP.md](docs/PARTNER_CASHOUT_SOP.md)                            | Partner cashout operating procedure         |
| [docs/PARTNER_ANTI_ABUSE.md](docs/PARTNER_ANTI_ABUSE.md)                              | Partner referral anti-fraud system          |
| [docs/LEAD-SCORING.md](docs/LEAD-SCORING.md)                                          | Quote-request lead-quality scoring          |

### Feature Guides

| Document                                                                           | Description                                |
| -------------------------------------------------------------------------------------| ------------------------------------------- |
| [docs/WEDDING_WEBSITE_FEATURE.md](docs/WEDDING_WEBSITE_FEATURE.md)                  | Wedding websites, RSVPs, and guest lists    |
| [docs/uk-city-hub-and-spoke.md](docs/uk-city-hub-and-spoke.md)                      | Location hub-and-spoke pages                |
| [docs/2FA_IMPLEMENTATION_GUIDE.md](docs/2FA_IMPLEMENTATION_GUIDE.md)                | Two-factor authentication (TOTP)            |
| [docs/VERIFICATION_SYSTEMS_GUIDE.md](docs/VERIFICATION_SYSTEMS_GUIDE.md)            | Phone & email verification systems          |
| [docs/features/REVIEWS_SYSTEM.md](docs/features/REVIEWS_SYSTEM.md)                  | Reviews system (v2) architecture            |
| [docs/architecture/eventflow-community-architecture.md](docs/architecture/eventflow-community-architecture.md) | Community/forum system architecture |
| [docs/marketplace/ARCHITECTURE.md](docs/marketplace/ARCHITECTURE.md)                | Classifieds marketplace architecture        |
| [docs/EMAIL_CENTRE.md](docs/EMAIL_CENTRE.md)                                        | Admin transactional email console           |

### Compliance & Security

| Document                                                                     | Description                                |
| --------------------------------------------------------------------------------| ------------------------------------------- |
| [docs/guides/GDPR_COMPLIANCE.md](docs/guides/GDPR_COMPLIANCE.md)               | Data protection and privacy                 |
| [docs/LEGAL_COMPLIANCE_CHECKLIST.md](docs/LEGAL_COMPLIANCE_CHECKLIST.md)       | Legal compliance checklist                  |
| [docs/SECURITY_FEATURES.md](docs/SECURITY_FEATURES.md)                        | Full security documentation                 |
| [docs/guides/SECURITY.md](docs/guides/SECURITY.md)                             | Security policy & reporting                 |
| [docs/compliance/](docs/compliance/)                                           | Community DPIA, child-access assessment, moderation policy, incident runbook, transparency records |

### Deployment & Operations

| Document                                                                              | Description                                |
| ----------------------------------------------------------------------------------------| ------------------------------------------- |
| [docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md](docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md)     | Production deployment instructions          |
| [docs/guides/CLOUDFLARE_SETUP.md](docs/guides/CLOUDFLARE_SETUP.md)                     | Cloudflare CDN setup                        |
| [docs/guides/RAILWAY_SETUP_GUIDE.md](docs/guides/RAILWAY_SETUP_GUIDE.md)               | Railway-specific deployment setup           |
| [docs/guides/POSTMARK_SETUP.md](docs/guides/POSTMARK_SETUP.md)                         | Transactional email configuration           |
| [docs/PERFORMANCE_TESTING.md](docs/PERFORMANCE_TESTING.md)                             | Performance verification and QA procedures  |
| [docs/guides/PERFORMANCE_OPTIMIZATION.md](docs/guides/PERFORMANCE_OPTIMIZATION.md)     | Performance optimisation reference          |
| [docs/PWA_ICONS.md](docs/PWA_ICONS.md)                                                 | PWA icon assets and regeneration steps      |
| [docs/mongodb-migration.md](docs/mongodb-migration.md)                                 | MongoDB migration guide with architecture   |
| [.github/docs/MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md)                         | MongoDB technical configuration guide       |
| [.github/docs/MONGODB_SETUP_SIMPLE.md](.github/docs/MONGODB_SETUP_SIMPLE.md)           | MongoDB setup for non-technical users        |

### Messenger v4 Docs

| Document                                                                                                     | Description                                |
| ---------------------------------------------------------------------------------------------------------------| ------------------------------------------- |
| [docs/guides/MESSENGER_V4_MIGRATION.md](docs/guides/MESSENGER_V4_MIGRATION.md)                                | Migrating off legacy v1 messaging endpoints |
| [docs/messenger/queue.md](docs/messenger/queue.md)                                                             | Messenger BullMQ queue architecture         |
| [docs/messenger/transactions.md](docs/messenger/transactions.md)                                               | Messenger transaction flag and rollout      |
| [docs/messenger/step-1-reconciliation.md](docs/messenger/step-1-reconciliation.md)                             | Messenger reconnection + sinceSeq catch-up  |
| [docs/messenger/step-2-readby-modal.md](docs/messenger/step-2-readby-modal.md)                                 | Messenger group read-by UX                  |
| [docs/messenger/step-5-group-thread-virtualization.md](docs/messenger/step-5-group-thread-virtualization.md)   | Messenger threads/group UI/virtualization   |

---

**Version:** v18.1.0 | **Status:** Production Ready ✅

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for local dev conventions, lint/format rules, and PR expectations.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/) and [Socket.IO](https://socket.io/)
- Image processing by [Sharp](https://sharp.pixelplumbing.com/), storage by [Cloudinary](https://cloudinary.com/)
- File uploads with [Multer](https://github.com/expressjs/multer)
- Background jobs with [BullMQ](https://docs.bullmq.io/)
- Payments by [Stripe](https://stripe.com/)
- Database: [MongoDB](https://www.mongodb.com/)

## 📞 Support

- 📧 Email: support@eventflow.com
- 🐛 Issues: [GitHub Issues](https://github.com/rhysllwydlewis/EventFlow/issues)
- 📖 Docs: [Documentation](#-documentation)
