# Data Migration Guide

## Overview

EventFlow supports two storage backends:

- **Local JSON files** (development/testing)
- **MongoDB** (production/recommended)

This guide explains how to migrate data from local JSON files to MongoDB.

## When Do You Need to Migrate?

You need to migrate if:

- ✅ You have been running EventFlow locally with JSON storage
- ✅ You have users, packages, or suppliers in your local `/data` folder
- ✅ You want to move to MongoDB (production deployment)

## Automatic Migration (NEW!)

**Starting from v17.1.0**, EventFlow automatically detects and migrates local data to MongoDB on server startup if:

- MongoDB is configured and connected
- MongoDB collections are empty
- Local JSON files contain data

The auto-migration runs during the seed phase and will log:

```
🔄 Auto-migration: Detected local data, migrating to MongoDB...
✅ Auto-migration complete!
   Migrated: users, suppliers, packages, ...
```

## Manual Migration

If you need to manually migrate data (e.g., to migrate TO production MongoDB FROM your local machine):

### Step 1: Configure Production MongoDB URI

Create a `.env.production` file or set environment variables:

```bash
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
JWT_SECRET=your-production-jwt-secret
NODE_ENV=production
```

### Step 2: Run Migration Script

```bash
# Option A: Using npm script (reads from .env)
npm run migrate

# Option B: Direct command with environment variable
MONGODB_URI=your-mongo-uri node migrate-to-mongodb.js
```

### Step 3: Verify Migration

Check the migration output:

```
=== Migration Results ===
Successful migrations:
  ✓ users: 4 documents
  ✓ suppliers: 3 documents
  ✓ packages: 3 documents
  ✓ plans: 0 documents
  ...

Total documents migrated: 10
```

### Step 4: Deploy to Production

After migration, deploy your application. The data is now in MongoDB and will be available in production.

## What Gets Migrated?

The migration includes the following collections:

- ✅ `users` - All user accounts (customers, suppliers, admins)
- ✅ `suppliers` - Supplier profiles and details
- ✅ `packages` - Service packages and offerings
- ✅ `plans` - User event plans
- ✅ `notes` - User notes
- ✅ `messages` - Direct messages
- ✅ `threads` - Message threads
- ✅ `events` - Event data

## Important Notes

### Data Safety

- ⚠️ The migration script **overwrites** data in MongoDB collections
- ⚠️ Back up your MongoDB data before re-running migration
- ⚠️ The original JSON files are NOT deleted (safe to keep as backup)

### Production Considerations

- 🔒 Never commit `.env` files with production credentials
- 🔒 Use environment variables in your deployment platform (Railway, Heroku, etc.)
- 🔒 Ensure MongoDB network access is properly configured (whitelist IPs)
- 📦 The `/data` folder is gitignored - local JSON files won't deploy to production

### After Migration

- ✅ Local JSON files can be kept as backup
- ✅ Future data changes will be in MongoDB only
- ✅ You can delete local JSON files if no longer needed
- ✅ The app will use MongoDB automatically when `MONGODB_URI` is configured

## Troubleshooting

### "No data to migrate for X"

This means the local JSON file for collection X is empty or doesn't exist. This is normal for unused collections.

### "Failed to migrate X"

Check MongoDB connection and permissions. Ensure your MongoDB user has write access to the database.

### "Connection timeout"

- Check MongoDB URI is correct
- Ensure network access is configured (whitelist your IP in MongoDB Atlas)
- Check firewall settings

### Data not showing in production

If you deployed before running migration:

1. Run the migration script from your local machine (see Step 2 above)
2. Point it to your PRODUCTION MongoDB URI
3. Restart your production server

OR

Wait for auto-migration to detect and migrate data on next deployment (if conditions are met).

## Starting Fresh

If you want to start with a clean database:

### Option 1: Drop Collections in MongoDB

```bash
# Connect to MongoDB and drop collections
mongosh "your-mongodb-uri"
> use eventflow
> db.users.drop()
> db.suppliers.drop()
> db.packages.drop()
```

### Option 2: Use a New Database

Change the database name in your MongoDB URI:

```
mongodb+srv://...@cluster.mongodb.net/eventflow_new?retryWrites=true
```

## Support

For issues with migration:

1. Check the logs for specific error messages
2. Verify MongoDB connection with `/api/health` endpoint
3. See [Railway Setup Guide](./RAILWAY_SETUP_GUIDE.md) or [MongoDB Setup Simple](../../.github/docs/MONGODB_SETUP_SIMPLE.md) for MongoDB configuration
4. Open an issue on GitHub with error details
