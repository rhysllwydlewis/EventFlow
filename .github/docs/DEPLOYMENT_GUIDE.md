# EventFlow Deployment Guide

This is the current production deployment guide for EventFlow. Railway is the primary hosted deployment target.

## Production Shape

EventFlow production should run with:

- one web service running `npm start`
- one worker service running `node scripts/worker.js`
- MongoDB for persistent application data
- Redis for BullMQ messenger/email queue fanout
- Postmark for transactional email
- `NODE_ENV=production`

Local JSON storage is development-only. Production startup should fail rather than serve traffic with local storage.

## Required Environment Variables

```env
NODE_ENV=production
BASE_URL=https://event-flow.co.uk
JWT_SECRET=<32+ character random secret>

MONGODB_URI=<Railway MongoDB MONGO_URL reference or external MongoDB URI>
MONGODB_DB_NAME=eventflow

REDIS_URL=<Redis connection string>

EMAIL_ENABLED=true
POSTMARK_API_KEY=<Postmark server token>
POSTMARK_FROM=admin@event-flow.co.uk
```

Recommended production variables:

```env
COOKIE_DOMAIN=.event-flow.co.uk
TRUST_PROXY=true
SENTRY_DSN=<Sentry DSN>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Do not set `ALLOW_DEGRADED_STARTUP=true` in production. The app refuses to start with that value because it bypasses critical checks.

## Railway Deployment

1. Create or select the Railway project.
2. Add the EventFlow web service from the GitHub repo.
3. Add a Railway MongoDB service.
4. In the EventFlow service variables, set `MONGODB_URI` using **Add Reference** to the MongoDB service `MONGO_URL`.
5. Set `MONGODB_DB_NAME=eventflow`.
6. Add Redis and set `REDIS_URL`.
7. Add a second Railway service for the worker using `railway.worker.json` or the start command:

```bash
node scripts/worker.js
```

8. Deploy the web and worker services.

Use the private Railway MongoDB URL where possible. It usually contains `railway.internal`.

## External MongoDB / Atlas

Atlas or another external MongoDB provider is supported, but Railway MongoDB is the simplest Railway-native option.

For external MongoDB:

```env
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
MONGODB_DB_NAME=eventflow
```

Make sure the provider allows connections from Railway and that the database user has read/write permissions.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev
```

MongoDB is optional in local development. Without `MONGODB_URI`, EventFlow can fall back to local JSON data for quick development only.

For local MongoDB:

```env
NODE_ENV=development
BASE_URL=http://localhost:3000
JWT_SECRET=local-development-secret-at-least-32-chars
MONGODB_LOCAL_URI=mongodb://localhost:27017/eventflow
EMAIL_ENABLED=false
```

## Verification

After deployment, check:

```bash
curl https://event-flow.co.uk/api/health
curl https://event-flow.co.uk/api/ready
```

Expected production state:

- `/api/health` reports MongoDB connected / active backend `mongodb`
- `/api/ready` returns HTTP 200
- Railway logs show the database name as `eventflow`
- Railway logs do not show local file storage warnings
- worker logs show queue workers started

## Backups

For Railway MongoDB:

- enable Railway service backups
- keep at least one recent manual backup before major migrations
- test restore on a non-production database before relying on it

For external MongoDB:

- enable provider snapshots
- keep credentials out of git
- document the restore procedure

## Troubleshooting

### `MONGODB_URI cannot point to localhost`

Production is using a local MongoDB URI. Replace it with the Railway MongoDB `MONGO_URL` reference or another production MongoDB URI.

### `MONGODB_URI database ... conflicts with MONGODB_DB_NAME`

The database name in the URI path does not match `MONGODB_DB_NAME`. For EventFlow production, both should point to `eventflow`.

### `Using local file storage`

This is acceptable only in local development. In production, check that `MONGODB_URI` is set and reachable.

### Worker fails to start

Check:

- `REDIS_URL` is set
- `MONGODB_URI` is set
- `MONGODB_DB_NAME=eventflow`
- the worker service command is `node scripts/worker.js`

### Emails go to outbox

Production transactional email should use Postmark. Check:

- `EMAIL_ENABLED=true`
- `POSTMARK_API_KEY` is set
- `POSTMARK_FROM` is verified in Postmark

## Related Guides

- [Railway Setup Guide](../../docs/guides/RAILWAY_SETUP_GUIDE.md)
- [MongoDB Verification Guide](../../docs/MONGODB_VERIFICATION.md)
- [Production Deployment Checklist](../../docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md)
- [Postmark Setup Guide](../../docs/guides/POSTMARK_SETUP.md)
