# MongoDB Integration Guide

**Current Status:** EventFlow is configured to use **file-based JSON storage** by default for simplicity and zero-configuration setup. MongoDB support is fully implemented and available for production deployments.

This guide explains how to set up and use MongoDB with EventFlow.

## Overview

EventFlow supports both file-based JSON storage (default) and MongoDB as database backends. MongoDB provides better scalability, reliability, and features for production deployments. The system maintains backward compatibility through migration tools.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up MongoDB

You have two options:

#### Option A: Local MongoDB (Development)

1. Install MongoDB locally: https://www.mongodb.com/docs/manual/installation/
2. Start MongoDB:
   ```bash
   mongod
   ```
3. Set environment variable:
   ```bash
   MONGODB_LOCAL_URI=mongodb://localhost:27017/eventflow
   ```

#### Option B: MongoDB Atlas (Production/Cloud)

1. Create a free account at https://www.mongodb.com/cloud/atlas
2. Create a new cluster
3. Get your connection string
4. Set environment variable:
   ```bash
   MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
   ```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update:

```bash
cp .env.example .env
```

Edit `.env` with your MongoDB connection details:

```
# For cloud MongoDB Atlas
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority

# OR for local MongoDB
MONGODB_LOCAL_URI=mongodb://localhost:27017/eventflow

# Optional: custom database name (defaults to 'eventflow')
MONGODB_DB_NAME=eventflow
```

### 4. Migrate Existing Data (Optional)

If you have existing JSON data files, migrate them to MongoDB:

```bash
npm run migrate
```

This will:

- Connect to MongoDB
- Create collections with proper schemas and indexes
- Import all data from JSON files
- Verify the migration

### 5. Start the Server

```bash
npm start
```

## Files and Structure

### New Files

- **`db.js`** - MongoDB connection handler with pooling and error handling
- **`models/index.js`** - Schema definitions and validation for all collections
- **`db-utils.js`** - Utility functions for database operations
- **`migrate-to-mongodb.js`** - Data migration script

### Database Collections

The system uses 8 MongoDB collections:

1. **users** - User accounts (customers, suppliers, admins)
2. **suppliers** - Supplier/vendor business information
3. **packages** - Service packages offered by suppliers
4. **plans** - Customer event plans
5. **notes** - Customer planning notes
6. **messages** - Individual messages in conversations
7. **threads** - Conversation threads between customers and suppliers
8. **events** - Event records

### Features

- **Schema Validation**: All collections have JSON schema validation
- **Indexes**: Optimized indexes for common queries
- **Connection Pooling**: Efficient database connections
- **Error Handling**: Robust error handling with fallbacks
- **Migration Tools**: Easy data migration from JSON to MongoDB

## API Reference

### Database Utilities (`db-utils.js`)

```javascript
const dbUtils = require('./db-utils');

// Read all documents from a collection
const users = await dbUtils.read('users');

// Find specific documents
const admins = await dbUtils.find('users', { role: 'admin' });

// Find one document
const user = await dbUtils.findOne('users', { email: 'user@example.com' });

// Insert a document
await dbUtils.insertOne('users', { id: 'usr_123', email: 'new@example.com', ... });

// Update a document
await dbUtils.updateOne('users', { id: 'usr_123' }, { $set: { name: 'New Name' } });

// Delete a document
await dbUtils.deleteOne('users', { id: 'usr_123' });

// Generate unique ID
const id = dbUtils.uid('usr'); // Returns 'usr_abc123xyz'

// Count documents
const count = await dbUtils.count('users', { role: 'customer' });
```

### Database Connection (`db.js`)

```javascript
const db = require('./db');

// Connect to database
const database = await db.connect();

// Get database instance
const database = await db.getDb();

// Get a collection
const usersCollection = await db.getCollection('users');

// Check connection status
const connected = db.isConnected();

// Close connection
await db.close();
```

## Backward Compatibility

The new MongoDB system maintains backward compatibility:

- The `store.js` module still works for JSON file access
- The `uid()` function uses the same format
- Migration tools preserve all existing data
- Server can fall back to JSON files if MongoDB is unavailable

## Performance Tips

1. **Use Indexes**: The system automatically creates indexes for common queries
2. **Connection Pooling**: Connection pool is configured for optimal performance
3. **Query Optimization**: Use specific filters rather than reading all documents
4. **Pagination**: Use `limit` and `skip` for large result sets

## Troubleshooting

### Cannot connect to MongoDB

- Check that MongoDB is running (local) or connection string is correct (cloud)
- Verify network access (MongoDB Atlas requires IP whitelist)
- Check environment variables are set correctly

### Migration fails

- Ensure JSON data files exist in `/data` directory
- Check MongoDB connection before running migration
- Verify sufficient permissions for database operations

### Performance issues

- Check that indexes are created (`npm run migrate` creates them)
- Monitor connection pool size
- Review query patterns and optimize filters

## Security Notes

1. **Never commit `.env` file** - It contains sensitive credentials
2. **Use strong passwords** - For MongoDB Atlas accounts
3. **Enable authentication** - For production MongoDB instances
4. **Whitelist IPs** - Restrict database access by IP address
5. **Regular backups** - MongoDB Atlas provides automated backups

## Next Steps

After setting up MongoDB:

1. Configure photo storage (AWS S3 or local with multer/sharp)
2. Set up automated backups
3. Monitor database performance
4. Scale database as needed

## Support

For issues or questions:

- Check MongoDB documentation: https://docs.mongodb.com/
- Review error logs in console
- Verify environment configuration
