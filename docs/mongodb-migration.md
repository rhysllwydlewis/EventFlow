# MongoDB Migration Plan for EventFlow

## Executive Summary

EventFlow has **already completed its MongoDB migration** and is production-ready with a robust, dual-backend architecture. This document describes the implemented solution and provides guidance for teams considering similar migrations.

## Current State

### Data Persistence Architecture

EventFlow implements a **unified data access layer** (`db-unified.js`) that provides:

1. **Primary Backend: MongoDB** (required in production)
   - Railway MongoDB in the current Railway deployment, or another production MongoDB provider
   - Full schema validation and indexing
   - Connection pooling and automatic failover
   - Supports all production workloads

2. **Fallback Backend: Local JSON files** (development only)
   - Zero-configuration setup for local development
   - Automatic fallback when MongoDB is unavailable
   - Not permitted for production use

3. **Transparent Switching**
   - Application code is backend-agnostic
   - Automatically selects MongoDB when available
   - Graceful degradation to file storage

### Feature Flags

The system uses **environment-based configuration** rather than runtime feature flags:

```env
# Production Configuration (MongoDB enabled)
MONGODB_URI=mongodb://<USERNAME>:<PASSWORD>@<HOST>:<PORT>/eventflow
MONGODB_DB_NAME=eventflow

# Development Configuration (local fallback)
# MONGODB_URI not set = uses local JSON files
```

**Health Check Endpoint:** `/api/health` reports the active backend:

```json
{
  "status": "ok",
  "services": {
    "mongodb": "connected",
    "activeBackend": "mongodb"
  }
}
```

## MongoDB Schema & Collections

### Implemented Collections

1. **users** - User accounts (customers, suppliers, admins)
   - Schema: `firstName`, `lastName`, `email`, `passwordHash`, `role`, `location`, etc.
   - Indexes: `email` (unique), `role`, `createdAt`

2. **suppliers** - Supplier business profiles
   - Schema: `userId`, `name`, `description`, `location`, `categories`, `photos`, etc.
   - Indexes: `userId`, `name`, `location`, `categories`, `approvalStatus`

3. **packages** - Service packages offered by suppliers
   - Schema: `supplierId`, `title`, `description`, `price`, `categories`, `photos`, etc.
   - Indexes: `supplierId`, `slug` (unique), `categories`, `featured`, `approvalStatus`

4. **threads** - Conversation threads between customers and suppliers
   - Schema: `participants`, `subject`, `lastMessage`, `unreadCount`, etc.
   - Indexes: `participants`, `lastMessageAt`

5. **messages** - Individual messages within threads
   - Schema: `threadId`, `senderId`, `recipientId`, `content`, `read`, etc.
   - Indexes: `threadId`, `senderId`, `recipientId`, `createdAt`

6. **reviews** - Supplier reviews and ratings
   - Schema: `supplierId`, `userId`, `rating`, `comment`, `verified`, etc.
   - Indexes: `supplierId`, `userId`, `approved`, `createdAt`

7. **plans** - Customer event plans
   - Schema: `userId`, `eventType`, `eventDate`, `budget`, `packages`, etc.
   - Indexes: `userId`, `createdAt`

8. **notes** - Planning notes associated with plans
   - Schema: `planId`, `userId`, `content`, etc.
   - Indexes: `planId`, `userId`

### Schema Validation

All collections use **MongoDB JSON Schema validation** defined in `models/index.js`:

```javascript
{
  bsonType: 'object',
  required: ['email', 'passwordHash', 'role'],
  properties: {
    email: { bsonType: 'string', pattern: '^[^@]+@[^@]+$' },
    passwordHash: { bsonType: 'string' },
    role: { enum: ['customer', 'supplier', 'admin'] },
    // ... additional fields
  }
}
```

### Performance Optimization

**Implemented Indexes:**

- Unique indexes on email addresses and slugs
- Compound indexes for common queries (e.g., `supplierId + approvalStatus`)
- Text indexes for full-text search
- TTL indexes for session management (if needed)

**Query Performance Monitoring:**

- Tracks query execution times
- Logs slow queries (> 1 second)
- Average query time metrics available via health endpoint

## Data Access Layer

### Architecture

```
┌─────────────────────────────────────┐
│     Application Code (server.js)   │
│     (Uses simple CRUD operations)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│    Data Access Layer (db-unified.js)│
│    (Provides unified interface)     │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌──────────┐    ┌──────────┐
│ MongoDB  │    │  Local   │
│ (db.js)  │    │  Files   │
│          │    │ (store.js)│
└──────────┘    └──────────┘
```

### Example Operations

```javascript
const dbUnified = require('./db-unified');

// Create user (works with MongoDB or local storage)
const newUser = await dbUnified.create('users', {
  email: 'user@example.com',
  passwordHash: hashedPassword,
  role: 'customer',
});

// Find users (unified query interface)
const users = await dbUnified.find('users', {
  role: 'supplier',
  location: { $regex: /London/i },
});

// Update package
await dbUnified.update('packages', { _id: packageId }, { $set: { featured: true } });
```

### Abstraction Benefits

1. **Backend Independence** - Application code doesn't know which storage is used
2. **Easy Testing** - Can switch to local storage for unit tests
3. **Gradual Migration** - Collections can be migrated one at a time
4. **Zero Downtime** - Seamless switchover between backends

## Local Development Setup

### Option 1: MongoDB via Docker Compose (Recommended)

EventFlow includes a complete Docker Compose configuration:

```yaml
# docker-compose.yml (already included)
services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - MONGODB_URI=mongodb://mongo:27017/eventflow
    depends_on:
      - mongo

  mongo:
    image: mongo:6
    ports:
      - '27017:27017'
    volumes:
      - mongodb_data:/data/db

  mongo-express:
    image: mongo-express
    ports:
      - '8081:8081'
    environment:
      - ME_CONFIG_MONGODB_URL=mongodb://mongo:27017/
```

**Start all services:**

```bash
docker-compose up -d
```

**Access:**

- App: http://localhost:3000
- MongoDB Admin UI: http://localhost:8081
- API Docs: http://localhost:3000/api-docs

### Option 2: MongoDB Atlas (Cloud)

For production-like local development:

1. Create free MongoDB Atlas account: https://cloud.mongodb.com
2. Create M0 (free tier) cluster
3. Configure network access (allow your IP or 0.0.0.0/0 for development)
4. Create database user
5. Get connection string
6. Set in `.env`:
   ```env
   MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow
   ```

### Option 3: Local File Storage (Quickest)

For rapid prototyping:

1. Don't set `MONGODB_URI`
2. Data stored in `/data` directory as JSON files
3. Not suitable for production
4. Useful for demos and testing

## Migration Process

### Data Migration Tool

EventFlow includes `migrate-to-mongodb.js` for migrating existing data:

```bash
# Migrate all data from JSON files to MongoDB
npm run migrate
```

**What it does:**

1. Connects to MongoDB
2. Creates collections with schemas and indexes
3. Imports all data from `/data/*.json` files
4. Validates imported data
5. Reports success/failure

**Example output:**

```
✅ Connected to MongoDB
📦 Creating collections...
✅ Created collection: users
✅ Created collection: suppliers
✅ Created collection: packages
📊 Migrating data...
   • users: 45 records migrated
   • suppliers: 23 records migrated
   • packages: 67 records migrated
✅ Migration completed successfully
```

### Rollback Strategy

#### Option 1: Revert to Local Storage

1. Stop the application
2. Remove or comment out `MONGODB_URI` from environment
3. Restart application
4. System automatically uses local JSON files

#### Option 2: MongoDB Backup Restore

**Create Backup:**

```bash
# Via mongodump
mongodump --uri="mongodb+srv://..." --out=/backup

# Via MongoDB Atlas UI
# Clusters → Backup → On-Demand Snapshot
```

**Restore Backup:**

```bash
# Via mongorestore
mongorestore --uri="mongodb+srv://..." /backup

# Via MongoDB Atlas UI
# Clusters → Backup → Restore Snapshot
```

#### Option 3: Export Data Back to JSON

Use the admin export endpoint:

```bash
curl -H "Cookie: auth_token=..." \
  https://yourdomain.com/api/admin/export/all \
  -o data-backup.json
```

Then restore by:

1. Stop application
2. Remove `MONGODB_URI`
3. Place JSON files in `/data` directory
4. Restart application

### Zero-Downtime Migration

For production deployments:

1. **Phase 1: Dual Write** (not implemented, but possible)
   - Write to both MongoDB and local storage
   - Read from MongoDB, fallback to local storage
   - Verify data consistency

2. **Phase 2: MongoDB Primary**
   - Write to MongoDB only
   - Keep local storage as read-only backup
   - Monitor for 24-48 hours

3. **Phase 3: MongoDB Only**
   - Remove local storage fallback
   - Archive old JSON files

**Current Implementation:** EventFlow uses MongoDB-first approach:

- Writes go to active backend (MongoDB or local)
- No dual-write complexity
- Instant rollback by changing environment variable

## Testing Strategy

### Unit Tests

Test both backends:

```javascript
describe('Data Access Layer', () => {
  it('should create user in MongoDB', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost/test';
    const user = await dbUnified.create('users', userData);
    expect(user._id).toBeDefined();
  });

  it('should create user in local storage', async () => {
    delete process.env.MONGODB_URI;
    const user = await dbUnified.create('users', userData);
    expect(user.id).toBeDefined();
  });
});
```

### Integration Tests

Verify backend switching:

```bash
# Test with MongoDB
MONGODB_URI=mongodb://localhost/test npm test

# Test with local storage
npm test
```

### End-to-End Tests

Playwright tests work with both backends:

```bash
npm run test:e2e
```

Tests are backend-agnostic and validate:

- User registration and authentication
- Supplier profile creation
- Package management
- Messaging system

## Deployment Guide

### Environment Variables

**Required for Production:**

```env
# MongoDB connection string
MONGODB_URI=<Railway MongoDB MONGO_URL reference or external MongoDB URI>
MONGODB_DB_NAME=eventflow

# Application configuration
NODE_ENV=production
BASE_URL=https://yourdomain.com
JWT_SECRET=your-strong-secret-min-32-chars
REDIS_URL=redis://default:password@redis-host:6379

# Email service (Postmark)
POSTMARK_API_KEY=your-postmark-api-key
POSTMARK_FROM=admin@yourdomain.com
EMAIL_ENABLED=true
```

**Optional:**

```env
# Storage for photos (local or s3)
STORAGE_TYPE=s3
AWS_S3_BUCKET=your-bucket
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### Deployment Platforms

#### Railway

```bash
railway login
railway init
railway variables set JWT_SECRET="..."
railway variables set MONGODB_DB_NAME="eventflow"
# Add MONGODB_URI as a Railway variable reference to the MongoDB service MONGO_URL.
railway variables set REDIS_URL="redis://..."
railway up
```

#### Heroku

```bash
heroku create your-app
heroku config:set MONGODB_URI="mongodb+srv://..."
heroku config:set MONGODB_DB_NAME="eventflow"
heroku config:set JWT_SECRET="..."
git push heroku main
```

#### Docker

```bash
docker build -t eventflow .
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb+srv://..." \
  -e MONGODB_DB_NAME="eventflow" \
  -e JWT_SECRET="..." \
  eventflow
```

### Monitoring & Health Checks

**Health Endpoint:** `/api/health`

```json
{
  "status": "ok",
  "version": "v17.0.0",
  "services": {
    "mongodb": "connected",
    "activeBackend": "mongodb"
  },
  "database": {
    "type": "mongodb",
    "initialized": true,
    "metrics": {
      "totalQueries": 1234,
      "slowQueries": 5,
      "avgQueryTime": 45.2
    }
  }
}
```

**Readiness Endpoint:** `/api/ready`

- Returns HTTP 200 when MongoDB is connected
- Returns HTTP 503 when database is unavailable
- Use for Kubernetes liveness/readiness probes

**Monitoring Checklist:**

- [ ] `/api/health` shows `activeBackend: "mongodb"`
- [ ] `/api/ready` returns HTTP 200
- [ ] No slow queries logged
- [ ] Average query time < 100ms
- [ ] Railway MongoDB backups/metrics look healthy, or external MongoDB monitoring shows healthy metrics

## Security Considerations

### Connection Strings

**Never commit credentials to git:**

```env
# ❌ Bad - in .env (committed to git)
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@...

# ✅ Good - in environment (Railway/Heroku config)
# Set via: railway variables set MONGODB_URI="..."
```

### Network Access

**MongoDB network configuration:**

1. On Railway, prefer the MongoDB service's private URL containing `railway.internal`.
2. If using Atlas or another external provider, allow your hosting platform to connect.
3. For development, use local MongoDB only outside production.

### Database Users

**Create least-privilege users:**

```javascript
// MongoDB user settings
{
  username: "eventflow-app",
  password: "strong-random-password",
  database: "eventflow",
  role: "readWrite"  // Not dbAdmin or root
}
```

### Connection Transport

Use the secure connection mode recommended by your MongoDB provider:

```env
# Atlas/external providers commonly use TLS by default
MONGODB_URI=mongodb+srv://...

# Railway private URLs may use mongodb:// inside Railway's private network
MONGODB_URI=mongodb://<USERNAME>:<PASSWORD>@<PRIVATE-HOST>:<PORT>/eventflow
```

## Troubleshooting

### Common Issues

#### 1. "Invalid scheme, expected connection string..."

**Cause:** Using placeholder from `.env.example`

**Solution:** Replace with the Railway MongoDB `MONGO_URL` reference or another real MongoDB connection string.

```env
# Railway MongoDB usually appears as a private railway.internal URL.
MONGODB_URI=mongodb://<USERNAME>:<PASSWORD>@<HOST>:<PORT>/eventflow
MONGODB_DB_NAME=eventflow
```

#### 2. "Authentication failed"

**Cause:** Wrong password or user doesn't exist

**Solution:**

1. Regenerate or re-add the Railway MongoDB `MONGO_URL` variable reference.
2. If using Atlas/external MongoDB, edit the database user and reset the password.
3. Update `MONGODB_URI` with the new value.

#### 3. "Connection timeout" / "ENOTFOUND"

**Cause:** Database host is not reachable from the app

**Solution:**

1. On Railway, use the MongoDB service's private `railway.internal` URL.
2. If using Atlas/external MongoDB, allow Railway or your hosting provider to connect.

#### 4. "Using local file storage" in production

**Cause:** `MONGODB_URI` not set in environment

**Solution:**

- Railway: `railway variables set MONGODB_URI="..."`
- Heroku: `heroku config:set MONGODB_URI="..."`
- Docker: Pass `-e MONGODB_URI="..."` flag

### Debug Logging

Enable verbose logging:

```env
NODE_ENV=development
DEBUG=db:*
```

Check logs for:

```
✅ Using MongoDB for data storage (PRIMARY)
✅ Connected to MongoDB database: eventflow
✅ Database initialized: mongodb
```

## Performance Benchmarks

### Query Performance

**Typical Response Times:**

- Single document read: 10-30ms
- Find with filter (indexed): 20-50ms
- Complex aggregation: 50-200ms
- Write operation: 15-40ms

**Optimization Techniques:**

1. Proper indexing (already implemented)
2. Connection pooling (configured in `db.js`)
3. Query result projection (minimize data transfer)
4. Batch operations for bulk updates

### Scalability

**Current Configuration:**

- Connection pool: 10-100 connections
- Suitable for: 1,000-10,000 concurrent users
- MongoDB Atlas M0 (free tier): 512MB RAM, shared CPU

**Scaling Path:**

1. **M0 → M10:** First paid tier, dedicated CPU
2. **M10 → M20:** Increased RAM and storage
3. **M20+:** Auto-scaling, sharding, multi-region

## Appendix

### File Structure

```
eventflow/
├── db.js                    # MongoDB connection handler
├── db-unified.js            # Unified data access layer
├── db-utils.js              # Database utility functions
├── store.js                 # Local file storage (fallback)
├── migrate-to-mongodb.js    # Data migration script
├── models/
│   └── index.js            # Schema definitions
├── config/
│   └── database.js         # Database configuration
├── .env.example            # Environment template
└── docs/
    ├── mongodb-migration.md         # This document
    └── MONGODB_VERIFICATION.md      # Quick verification guide
```

### Useful Commands

```bash
# Install dependencies
npm install

# Run data migration
npm run migrate

# Start with MongoDB
MONGODB_URI=mongodb://localhost/eventflow npm start

# Start with local storage
npm start

# Run tests
npm test

# Run E2E tests
npm run test:e2e

# Health check
curl http://localhost:3000/api/health

# Export all data
curl -H "Cookie: auth_token=..." \
  http://localhost:3000/api/admin/export/all
```

### References

- [MongoDB Atlas Setup Guide](../.github/docs/MONGODB_SETUP_SIMPLE.md)
- [MongoDB Verification Guide](./MONGODB_VERIFICATION.md)
- [API Documentation](./api/API_DOCUMENTATION.md)
- [Deployment Guide](../.github/docs/DEPLOYMENT_GUIDE.md)
- [MongoDB Documentation](https://docs.mongodb.com/)

---

**Last Updated:** 2026-01-06  
**Status:** ✅ Production Ready  
**Migration Status:** ✅ Complete
