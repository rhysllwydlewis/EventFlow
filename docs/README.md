# EventFlow Documentation

## Quick Links

- **[MongoDB Verification Guide](./MONGODB_VERIFICATION.md)** - Verify your deployment is properly using MongoDB
- **[Railway Setup Guide](./guides/RAILWAY_SETUP_GUIDE.md)** - Current Railway production variables and MongoDB setup
- **[Production Deployment Checklist](./PRODUCTION_DEPLOYMENT_CHECKLIST.md)** - Pre-go-live checks
- **[MongoDB Setup (External/Atlas)](../.github/docs/MONGODB_SETUP_SIMPLE.md)** - External MongoDB setup for non-Railway databases
- **[Deployment Guide](../.github/docs/DEPLOYMENT_GUIDE.md)** - General deployment notes

## Current Production Shape

EventFlow production currently expects:

- `NODE_ENV=production`
- `MONGODB_URI` pointing at Railway MongoDB or another production MongoDB host
- `MONGODB_DB_NAME=eventflow`
- `REDIS_URL` for the BullMQ messenger/email worker queue
- a separate worker process running `node scripts/worker.js`
- Postmark variables for production email delivery

## Health Monitoring

Your deployment exposes two health endpoints:

### `/api/health` - Overall System Health

Always returns HTTP 200. Shows MongoDB status and which backend is active.

```bash
curl https://your-domain.com/api/health
```

### `/api/ready` - Readiness Probe

Returns HTTP 200 only when MongoDB is connected. Returns HTTP 503 if not ready.

```bash
curl https://your-domain.com/api/ready
```

## Critical: Data Persistence

EventFlow stores ALL data in MongoDB when properly configured:

- User accounts, authentication, profiles
- Supplier data, packages, photos
- Messages, events, plans
- Reviews, ratings, categories
- All other application data

**Check your deployment:** `/api/health` should show `"activeBackend": "mongodb"`

If it shows `"activeBackend": "local"` in production, treat it as a deployment blocker. Production must use MongoDB; local JSON storage is development-only.

See [MongoDB Verification Guide](./MONGODB_VERIFICATION.md) for troubleshooting.

## Historical Docs

`docs/history/` and `docs/archive/` contain old implementation notes and PR-era reports. They are useful context, but they are not the source of truth for current deployment setup.
