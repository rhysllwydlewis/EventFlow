# EventFlow — MongoDB → PostgreSQL on Railway: Migration Guide

This document covers the full 5-PR migration plan, Railway-specific setup,
and developer workflow for running Prisma migrations locally and in production.

---

## Table of Contents

1. [Overview](#overview)
2. [Railway PostgreSQL Setup](#railway-postgresql-setup)
3. [Environment Variables](#environment-variables)
4. [Developer Workflow](#developer-workflow)
5. [PR Breakdown](#pr-breakdown)
6. [Schema Design Decisions](#schema-design-decisions)
7. [TTL / Cleanup Jobs](#ttl--cleanup-jobs)
8. [Rollback Plan](#rollback-plan)

---

## Overview

EventFlow is being migrated from MongoDB (Atlas) to PostgreSQL hosted on
Railway.  The migration is split into 5 PRs so each step can be tested and
rolled back independently.

| PR | Branch scope | What changes |
|----|-------------|--------------|
| **PR1** (this) | Foundation | Add Prisma + schema + migrations. MongoDB stays active. |
| PR2 | Core DAL | Swap `db-unified.js` to Prisma for core collections |
| PR3 | Payments/Reviews/Partner | Remaining services + TTL cleanup jobs |
| PR4 | Messaging | Normalise `conversations_v4.participants`, rewrite messenger service |
| PR5 | Cleanup | Remove MongoDB, rewrite scripts, update tests |

---

## Railway PostgreSQL Setup

### 1. Provision a Postgres database

In Railway:
1. Open your project → **New Service → Database → PostgreSQL**
2. Railway automatically creates a `Postgres` service and provisions a database.

### 2. Import Postgres variables into the EventFlow service

Railway stores connection strings in the `Postgres` service's variables.  To
make them available to the `EventFlow` service:

1. Select the **EventFlow** service → **Variables** tab
2. Click **+ Add** → **Reference Variable**
3. Reference `Postgres.DATABASE_URL` → save as `DATABASE_URL`
4. Reference `Postgres.DATABASE_PUBLIC_URL` → save as `DATABASE_PUBLIC_URL`

The internal URL looks like:
```
postgresql://postgres:<password>@postgres.railway.internal:5432/railway
```

The public URL (for external access) looks like:
```
postgresql://postgres:<password>@roundhouse.proxy.rlwy.net:<port>/railway
```

### 3. SSL

- **Internal** (EventFlow service → Postgres on Railway's private network): SSL
  is not required.  The `DATABASE_URL` internal URL works without `sslmode`.
- **External** (your laptop → Railway Postgres): SSL is **required**.  Always
  append `?sslmode=require` to `DATABASE_PUBLIC_URL` when connecting externally.

> Railway Database View:  https://docs.railway.com/guides/database-view
> Railway PostgreSQL guide: https://docs.railway.com/databases/postgresql/
> Railway CLI connect:     https://docs.railway.com/cli/connect

---

## Environment Variables

| Variable | Where to set | Description |
|---|---|---|
| `DATABASE_URL` | EventFlow service Variables | Internal Postgres URL (used by app + Prisma at runtime) |
| `DATABASE_PUBLIC_URL` | Local `.env` file | Public URL for running migrations from your laptop; add `?sslmode=require` |
| `MONGODB_URI` | EventFlow service Variables | Keep until PR5 (MongoDB still active in PR1–3) |

```bash
# .env (local development — NOT committed)
DATABASE_URL=postgresql://postgres:password@localhost:5432/eventflow
# or to connect externally to Railway:
# DATABASE_URL=postgresql://postgres:<pass>@roundhouse.proxy.rlwy.net:<port>/railway?sslmode=require
```

---

## Developer Workflow

### Prerequisites

- Node.js ≥ 20
- Local Postgres running, **or** access to Railway Postgres via `DATABASE_PUBLIC_URL`

### Install dependencies

```bash
npm install
```

### Generate the Prisma client

```bash
npm run prisma:generate
# or: npx prisma generate
```

Run this after any change to `prisma/schema.prisma`.

### Apply migrations (local)

```bash
# Apply all pending migrations to your LOCAL Postgres:
DATABASE_URL=postgresql://postgres:password@localhost:5432/eventflow \
  npm run prisma:migrate
# or: npx prisma migrate deploy
```

### Apply migrations (Railway Postgres from your laptop)

```bash
# Use the public URL with SSL:
DATABASE_URL="postgresql://postgres:<pass>@roundhouse.proxy.rlwy.net:<port>/railway?sslmode=require" \
  npm run prisma:migrate
```

### Create a new migration during development

```bash
# Creates a new migration file and applies it to your local DB:
npm run prisma:migrate:dev -- --name describe_your_change
# or: npx prisma migrate dev --name describe_your_change
```

### Open Prisma Studio (GUI database browser)

```bash
DATABASE_URL=postgresql://... npm run prisma:studio
```

### Validate the schema

```bash
npm run prisma:validate
# or: npx prisma validate
```

### CI / Railway deployments

Prisma migrations are applied on deploy.  Add the following to your Railway
**Start Command** (or a pre-deploy script):

```bash
npx prisma migrate deploy && node server.js
```

Or as separate Railway commands:
- **Build command**: `npm install && npx prisma generate`
- **Start command**: `npx prisma migrate deploy && node server.js`

---

## PR Breakdown

### PR1 — Foundation *(this PR)*

**Goal**: Add Prisma tooling with no runtime behavior change.  MongoDB stays
active.  Postgres tables are created but no routes use them yet.

- [x] `prisma/schema.prisma` — all ~30 tables
- [x] `prisma/migrations/20260408000000_init/migration.sql` — initial DDL
- [x] `db-postgres.js` — PrismaClient wrapper (not yet used by routes)
- [x] `.env.example` — `DATABASE_URL` documented
- [x] `package.json` — `prisma:generate`, `prisma:migrate`, `prisma:migrate:dev` scripts

---

### PR2 — Swap DAL for Core Collections

**Scope**: `db-unified.js` + users, suppliers, packages, plans, notes, events

- Replace `db-unified.js` `read/write/create/update/remove/query()` with Prisma
  calls while keeping the **same exported signatures** (no callers need changing).
- Add `scripts/migrate-mongo-to-postgres.js` — exports core Mongo collections to
  Postgres using `mongoexport` + Prisma `createMany`.
- Add `DB_DRIVER=postgres|mongo` feature flag (default `mongo`).
- **Maintenance window**: ~5 minutes read-only while data is migrated.

---

### PR3 — Payments, Reviews, Partner Programme, Notifications

**Scope**: Financial tables + social tables + infrastructure

- Rewrite `services/user.service.js`, billing routes, review routes.
- Migrate: payments, subscriptions, invoices, reviews, reviewVotes,
  notifications, partners, partner_referrals, partner_credit_transactions,
  audit_logs, search_history.
- **TTL replacement**: enable `pg_cron` extension on Railway and add cleanup
  jobs for `notifications.expires_at` and `link_previews.expires_at` (see below).

---

### PR4 — Messaging (conversations_v4, chat_messages_v4)

**Scope**: Most complex area — isolated for independent testing

- Normalise `conversations_v4.participants` JSONB →
  `conversation_participants` table.
- Normalise `chat_messages_v4.reactions` JSONB → `message_reactions` table.
- Rewrite `services/messenger-v4.service.js` with Prisma (replaces `$all`,
  `$push`, `$pull`, `$inc` operators).
- Rewrite direct Mongo access in `routes/messenger-v4.js` (lines 290, 1149).
- Migrate legacy `threads` / `messages` → new Postgres tables.

---

### PR5 — Cleanup + Remove MongoDB

**Scope**: Final pass

- Rewrite `services/analyticsService.js` (atomic `INSERT … ON CONFLICT DO UPDATE`).
- Rewrite `routes/webhooks.js` email-tracking inserts.
- Rewrite `routes/photos.js` direct Mongo access.
- Rewrite `webhooks/mongodbWebhookHandler.js` to use `webhook_events` table.
- Rewrite all `/scripts/` for Postgres.
- Remove `mongodb` and `mongodb-memory-server` from `package.json`.
- Remove `db.js`, `db-utils.js`, Mongo-specific code.
- Replace `MongoMemoryServer` in tests with Postgres (testcontainers or Railway
  test DB with schema truncation).
- Remove `MONGODB_URI` from `.env.example`.

---

## Schema Design Decisions

### `packages.categories` / `packages.eventTypes` → `TEXT[]`

MongoDB uses multi-value string arrays queried with `$in`.  PostgreSQL `TEXT[]`
columns with a **GIN index** provide the same semantics using the `&&` (overlap)
or `@>` (contains) operators.

```sql
-- equivalent of MongoDB: { categories: { $in: ['wedding'] } }
SELECT * FROM packages WHERE categories && ARRAY['wedding'];
```

GIN indexes are declared in the migration SQL:

```sql
CREATE INDEX "packages_categories_gin_idx" ON "packages" USING GIN ("categories");
CREATE INDEX "packages_eventTypes_gin_idx" ON "packages" USING GIN ("eventTypes");
```

### `conversations_v4.participants` → `JSONB` (PR1), normalised table (PR4)

The participants array is complex (userId, displayName, avatar, role, isPinned,
isMuted, isArchived, unreadCount, lastReadAt).  Storing it as JSONB in PR1
keeps the migration risk low.  PR4 will introduce a `conversation_participants`
relational table for proper querying.

### `conversations_v4.metadata` / `.context` → `JSONB`

`metadata` is open-schema.  `context` has a known shape but is simple enough
to keep as JSONB for now.

### Timestamps → `TEXT` in PR1

MongoDB stores dates as ISO-8601 strings in many fields.  Keeping them as
`TEXT` in PR1 avoids type-conversion errors during the initial migration.  PR2
will convert key timestamp columns to `TIMESTAMPTZ`.

### Sparse/partial indexes

MongoDB sparse indexes only index non-null documents.  PostgreSQL partial
indexes achieve the same with a `WHERE col IS NOT NULL` predicate:

```sql
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug") WHERE "slug" IS NOT NULL;
CREATE INDEX "payments_stripePaymentId_idx" ON "payments"("stripePaymentId")
  WHERE "stripePaymentId" IS NOT NULL;
```

All partial indexes are declared in the migration SQL.

---

## TTL / Cleanup Jobs

Three collections use MongoDB TTL indexes that auto-expire documents:

| Collection / Table | TTL field | Period |
|---|---|---|
| `notifications` | `expiresAt` | Variable (set per notification) |
| `link_previews` | `expiresAt` | 30 days |
| `webhook_events` | `expiresAt` | 7 days |

**PR1**: Tables are created with `expires_at` columns and indexes but no
automatic cleanup is implemented.

**PR3**: Enable `pg_cron` on Railway and add scheduled cleanup jobs:

```sql
-- Enable pg_cron (run once as superuser on Railway Postgres)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Delete expired notifications every hour
SELECT cron.schedule('cleanup-notifications', '0 * * * *',
  $$DELETE FROM notifications WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()::TEXT$$);

-- Delete expired link previews daily at 03:00
SELECT cron.schedule('cleanup-link-previews', '0 3 * * *',
  $$DELETE FROM link_previews WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()::TEXT$$);

-- Delete expired webhook events daily at 03:30
SELECT cron.schedule('cleanup-webhook-events', '30 3 * * *',
  $$DELETE FROM webhook_events WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()::TEXT$$);
```

Alternatively, a lightweight startup cleanup job can be added to `server.js`
in PR3 (no extension required).

---

## Rollback Plan

Each PR has an independent rollback path:

**PR1**: No runtime change.  Rollback = revert commits.

**PR2**: `DB_DRIVER=mongo` feature flag reverts to MongoDB instantly without a
re-deploy.  Data in Postgres can be ignored until the next migration attempt.

**PR3–PR4**: Same `DB_DRIVER` flag pattern.  Financial data must be verified
before switching off the Mongo fallback.

**PR5**: MongoDB is removed.  Rollback requires reverting to the PR4 branch
and restoring from a Mongo backup taken before the maintenance window.
