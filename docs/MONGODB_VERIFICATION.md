# MongoDB Quick Verification Guide

This guide helps you verify that your EventFlow deployment is properly connected to MongoDB and all data is being stored correctly.

## Quick Health Checks

### 1. Check Server Health

```bash
curl https://your-domain.com/api/health
```

**Expected output when MongoDB is connected:**

```json
{
  "status": "ok",
  "services": {
    "mongodb": "connected",
    "activeBackend": "mongodb"
  }
}
```

**Key field: `activeBackend: "mongodb"` means data is persisted in MongoDB (not local files)**

### 2. Check Readiness

```bash
curl https://your-domain.com/api/ready
```

**Expected: HTTP 200 when MongoDB connected, HTTP 503 when not ready**

## What Data is in MongoDB?

When `activeBackend: "mongodb"`, ALL data is stored in MongoDB:

- ✅ User accounts and authentication
- ✅ Supplier profiles and packages
- ✅ Messages and communications
- ✅ Photos and galleries
- ✅ Reviews and ratings
- ✅ Event plans and budgets
- ✅ All other application data

## Production Checklist

- [ ] `/api/health` shows `"activeBackend": "mongodb"`
- [ ] `/api/ready` returns HTTP 200
- [ ] No `"degraded"` status
- [ ] `MONGODB_URI` points to Railway MongoDB or another production MongoDB host (not localhost)
- [ ] `MONGODB_DB_NAME` is set to `eventflow`

See [MongoDB Setup Guide](./.github/docs/MONGODB_SETUP_SIMPLE.md) for configuration help.
