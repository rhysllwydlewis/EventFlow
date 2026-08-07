# Phase 2 Deployment Guide

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Database Migration](#database-migration)
3. [Backend Deployment](#backend-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [Verification](#verification)
6. [Rollback Procedure](#rollback-procedure)
7. [Monitoring](#monitoring)

---

## Pre-Deployment Checklist

### Prerequisites

- [ ] Node.js 22.x from `.node-version` installed
- [ ] MongoDB 6.0+ running
- [ ] Sufficient disk space (estimate 20% increase)
- [ ] Database backup completed
- [ ] All tests passing (unit + integration)
- [ ] Code review completed
- [ ] Security scan (CodeQL) passed

### Environment Preparation

```bash
# Verify Node.js version
node --version  # Should be 20.x

# Verify MongoDB connection
mongo --eval "db.adminCommand('ping')"

# Check disk space
df -h

# Verify npm packages are up to date
npm audit
```

### Backup Procedures

**1. Database Backup**

```bash
# Full database backup
mongodump --uri="mongodb://localhost:27017/eventflow" --out=/backups/pre-phase2-$(date +%Y%m%d)

# Verify backup
ls -lh /backups/pre-phase2-*
```

**2. Code Backup**

```bash
# Tag current production version
git tag -a v1.0-pre-phase2 -m "Pre-Phase 2 backup"
git push origin v1.0-pre-phase2
```

**3. Configuration Backup**

```bash
# Backup environment variables
cp .env .env.backup-$(date +%Y%m%d)
```

---

## Database Migration

### Step 1: Test Migration on Staging

```bash
# Copy production database to staging
mongodump --uri="$PROD_MONGODB_URI" --archive | mongorestore --uri="$STAGING_MONGODB_URI" --archive

# Run migration on staging
NODE_ENV=staging node migrate-phase2.js
```

**Expected Output:**

```
Starting Phase 2 migration...
Connected to MongoDB successfully
Creating indices for Phase 2 collections...
✅ Created folder indices
✅ Created label indices
✅ Created message Phase 2 indices
Initializing system folders for existing users...
Found 1250 users
✅ Created 7500 system folders for 1250 users
Initializing default labels for existing users...
✅ Created 7500 default labels for 1250 users
Updating existing messages with Phase 2 fields...
✅ Updated 45000 messages with Phase 2 fields
✅ Phase 2 migration completed successfully!
```

### Step 2: Validate Migration

```bash
# Verify collections exist
mongo $STAGING_MONGODB_URI --eval "
  db.getCollectionNames().filter(c =>
    c === 'messageFolders' ||
    c === 'messageLabels'
  )
"

# Verify indices
mongo $STAGING_MONGODB_URI --eval "
  db.messageFolders.getIndexes();
  db.messageLabels.getIndexes();
"

# Verify data integrity
mongo $STAGING_MONGODB_URI --eval "
  print('Folder count:', db.messageFolders.countDocuments({}));
  print('Label count:', db.messageLabels.countDocuments({}));
  print('Messages updated:', db.messages.countDocuments({folderId: {$exists: true}}));
"
```

### Step 3: Production Migration

**Maintenance Window Required: 30 minutes**

```bash
# 1. Put application in maintenance mode
pm2 stop eventflow

# 2. Final database backup
mongodump --uri="$PROD_MONGODB_URI" --out=/backups/final-pre-phase2-$(date +%Y%m%d-%H%M)

# 3. Run migration
NODE_ENV=production node migrate-phase2.js

# 4. Verify migration completed successfully
# Check logs for any errors

# 5. Restart application
pm2 start eventflow
```

### Migration Rollback (if needed)

```bash
# Stop application
pm2 stop eventflow

# Restore from backup
mongorestore --uri="$PROD_MONGODB_URI" --drop /backups/final-pre-phase2-YYYYMMDD-HHMM

# Restart application
pm2 start eventflow
```

---

## Backend Deployment

### Step 1: Deploy Code

```bash
# Pull latest code
git pull origin main

# Install dependencies
npm ci --production

# Verify no vulnerabilities
npm audit --production
```

### Step 2: Environment Variables

Ensure these are set in `.env`:

```bash
# Existing variables
MONGODB_URI=mongodb://...
NODE_ENV=production
PORT=3000

# Phase 2 - No new variables required
# All features use existing MongoDB connection
```

### Step 3: Restart Services

```bash
# Using PM2
pm2 restart eventflow

# Verify startup
pm2 logs eventflow --lines 50

# Check for errors
pm2 logs eventflow --err --lines 20
```

### Step 4: Verify API Endpoints

```bash
# Test folder API
curl -H "Authorization: Bearer $TOKEN" \
  https://yourdomain.com/api/v2/folders

# Test label API
curl -H "Authorization: Bearer $TOKEN" \
  https://yourdomain.com/api/v2/labels

# Test search API
curl -H "Authorization: Bearer $TOKEN" \
  "https://yourdomain.com/api/v2/search/advanced?q=test"
```

**Expected: 200 OK responses**

---

## Frontend Deployment

### Step 1: Build Assets

```bash
# No build step required for this project
# Static files are served directly
```

### Step 2: Deploy CSS Files

The following CSS files should be deployed:

- `public/assets/css/folders.css`
- `public/assets/css/labels.css`
- `public/assets/css/search.css`
- `public/assets/css/grouping.css`

```bash
# Verify files exist
ls -l public/assets/css/*.css | grep -E "(folders|labels|search|grouping)"

# Copy to production (if using separate static server)
scp public/assets/css/{folders,labels,search,grouping}.css \
  user@static-server:/var/www/eventflow/assets/css/
```

### Step 3: Update messages.html (if needed)

The messages.html file should include new CSS:

```html
<link rel="stylesheet" href="/assets/css/folders.css" />
<link rel="stylesheet" href="/assets/css/labels.css" />
<link rel="stylesheet" href="/assets/css/search.css" />
<link rel="stylesheet" href="/assets/css/grouping.css" />
```

### Step 4: Clear CDN Cache

If using a CDN:

```bash
# CloudFlare example
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

---

## Verification

### Automated Tests

```bash
# Run smoke tests
npm run test:smoke

# Expected: All tests pass
```

### Manual Verification

**1. User Flow Testing**

Test each feature with a real user account:

✅ **Folders:**

- [ ] Create a custom folder
- [ ] Move message to folder
- [ ] Create subfolder
- [ ] Delete folder (messages move to Inbox)

✅ **Labels:**

- [ ] Create a label
- [ ] Apply label to message
- [ ] Apply multiple labels
- [ ] Filter by label

✅ **Search:**

- [ ] Basic keyword search
- [ ] Search with operators (e.g., `from:user@example.com`)
- [ ] Search autocomplete works
- [ ] Save a search

✅ **Grouping:**

- [ ] Group by sender
- [ ] Group by date
- [ ] Collapse/expand groups
- [ ] Group action (mark all as read)

**2. Performance Testing**

```bash
# Test API response times
time curl -H "Authorization: Bearer $TOKEN" \
  https://yourdomain.com/api/v2/folders

# Should be < 200ms
```

**3. Database Verification**

```bash
mongo $PROD_MONGODB_URI --eval "
  // Verify folder counts
  const userCount = db.users.countDocuments({deletedAt: null});
  const folderCount = db.messageFolders.countDocuments({});
  const labelCount = db.messageLabels.countDocuments({});

  print('Users:', userCount);
  print('Folders:', folderCount, '(expected: ~', userCount * 6, ')');
  print('Labels:', labelCount, '(expected: ~', userCount * 6, ')');

  // Verify messages have Phase 2 fields
  const messagesWithFolders = db.messages.countDocuments({folderId: {$exists: true}});
  const totalMessages = db.messages.countDocuments({});

  print('Messages with Phase 2 fields:', messagesWithFolders, '/', totalMessages);
"
```

---

## Rollback Procedure

If critical issues are discovered:

### Step 1: Emergency Stop

```bash
# Stop application immediately
pm2 stop eventflow

# Enable maintenance mode
# (Display "Under Maintenance" page)
```

### Step 2: Restore Database

```bash
# Restore from pre-migration backup
mongorestore --uri="$PROD_MONGODB_URI" \
  --drop \
  /backups/final-pre-phase2-YYYYMMDD-HHMM
```

### Step 3: Revert Code

```bash
# Checkout previous version
git checkout v1.0-pre-phase2

# Reinstall dependencies
npm ci --production

# Restart
pm2 restart eventflow
```

### Step 4: Verify Rollback

```bash
# Verify old version is running
curl https://yourdomain.com/api/health

# Verify folders endpoint doesn't exist
curl https://yourdomain.com/api/v2/folders
# Should return 404
```

**Rollback Time: < 5 minutes**

---

## Monitoring

### Health Checks

Add these to your monitoring system:

**1. API Endpoint Health**

```bash
# Check every 5 minutes
curl -f https://yourdomain.com/api/v2/folders || alert
curl -f https://yourdomain.com/api/v2/labels || alert
curl -f https://yourdomain.com/api/v2/search/advanced?q=test || alert
```

**2. Database Health**

```bash
# Monitor collection sizes
mongo $MONGODB_URI --eval "
  db.messageFolders.stats().size;
  db.messageLabels.stats().size;
"
```

**3. Performance Metrics**

Monitor these metrics:

- API response time (target: < 500ms)
- Search query time (target: < 1s)
- Database query time (target: < 100ms)
- Memory usage (watch for leaks)
- CPU usage (should remain stable)

### Logging

Monitor application logs for:

```bash
# Check for errors
pm2 logs eventflow --err | grep -i "folder\|label\|search"

# Check for warnings
pm2 logs eventflow | grep -i "warn"

# Monitor API usage
pm2 logs eventflow | grep "api/v2"
```

### Alerts

Set up alerts for:

- API error rate > 1%
- Response time > 2s
- Database connection failures
- Memory usage > 80%
- Disk space < 20%

---

## Post-Deployment

### Day 1: Intensive Monitoring

- [ ] Monitor error logs every hour
- [ ] Check performance metrics
- [ ] Review user feedback
- [ ] Test on multiple devices/browsers

### Week 1: Regular Monitoring

- [ ] Daily log review
- [ ] Performance trends
- [ ] User adoption metrics
- [ ] Bug reports tracking

### Week 2-4: Optimization

- [ ] Identify slow queries
- [ ] Add indices if needed
- [ ] Optimize frontend performance
- [ ] Gather user feedback

---

## Gradual Rollout (Optional)

For large deployments, consider gradual rollout:

### Phase 1: 10% of Users (Day 1-2)

```javascript
// In routes/folders.js, add feature flag check
if (!isFeatureEnabled(req.user.id, 'phase2', 0.1)) {
  return res.status(404).json({ error: 'Not found' });
}
```

### Phase 2: 50% of Users (Day 3-5)

```javascript
if (!isFeatureEnabled(req.user.id, 'phase2', 0.5)) {
  return res.status(404).json({ error: 'Not found' });
}
```

### Phase 3: 100% of Users (Day 6+)

```javascript
// Remove feature flag
```

---

## Support

### Common Issues

**Issue: Migration takes too long**

- Solution: Run during off-peak hours
- Expected: ~5 minutes per 100k messages

**Issue: Folder API returns 503**

- Check: MongoDB connection
- Check: Service initialization logs

**Issue: Search not returning results**

- Check: Text index exists on messages collection
- Rebuild: `db.messages.createIndex({content: 'text'})`

### Contact

- Technical Support: tech@eventflow.com
- Emergency Hotline: +1-555-0123
- Slack Channel: #phase2-deployment

---

**Document Version:** 1.0
**Last Updated:** February 17, 2025
**Next Review:** March 17, 2025
