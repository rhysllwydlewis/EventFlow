/**
 * MongoDB Database Configuration
 * Handles connection pooling, error handling, and supports both local and cloud MongoDB
 */

'use strict';
const logger = require('./utils/logger');

const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let connectionState = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
let connectionError = null;

// Connection options for better reliability
const options = {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 30000, // Increased for Railway DNS resolution
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000, // Increased for Railway
  retryWrites: true,
  retryReads: true,
};

/**
 * Validate MongoDB URI format
 * @param {string} uri - MongoDB connection string to validate
 * @returns {Object} - { valid: boolean, error: string }
 */
function validateMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    return { valid: false, error: 'MongoDB URI is empty or invalid' };
  }

  // Check for placeholder/example URIs
  const placeholderPatterns = [
    'username:password', // Common placeholder pattern
    'user:pass', // Short placeholder pattern
    'your-cluster',
    'YourCluster',
    'example.com',
    '<password>', // Angle bracket placeholder
    '<username>',
    'cluster.mongodb.net/?appName=YourCluster', // Full placeholder from .env.example
  ];

  for (const pattern of placeholderPatterns) {
    if (uri.includes(pattern)) {
      return {
        valid: false,
        error:
          'MongoDB URI contains placeholder values - you must replace these with your actual MongoDB Atlas credentials',
      };
    }
  }

  // Validate URI scheme
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    return {
      valid: false,
      error:
        'Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"',
    };
  }

  // Check for credentials in cloud URIs
  if (uri.startsWith('mongodb+srv://') || uri.startsWith('mongodb://')) {
    // For mongodb+srv, we need credentials unless it's localhost
    if (uri.startsWith('mongodb+srv://') && !uri.includes('@')) {
      return {
        valid: false,
        error: 'MongoDB Atlas URI is missing credentials (username:password@...)',
      };
    }
  }

  return { valid: true };
}

/**
 * Get MongoDB connection URI from environment
 * Falls back to local MongoDB if cloud URI is not set
 */
function getConnectionUri() {
  const cloudUri = process.env.MONGODB_URI;
  const localUri = process.env.MONGODB_LOCAL_URI || 'mongodb://localhost:27017/eventflow';
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, never use localhost
  if (isProduction) {
    if (!cloudUri) {
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('❌ MONGODB CONFIGURATION ERROR');
      logger.error('='.repeat(70));
      logger.error('');
      logger.error('Production deployment requires a cloud MongoDB database.');
      logger.error('');
      logger.error('You need to:');
      logger.error('  1. Create a free MongoDB Atlas account');
      logger.error('  2. Set up a cluster');
      logger.error('  3. Get your connection string');
      logger.error('  4. Set the MONGODB_URI environment variable');
      logger.error('');
      logger.error('📚 Step-by-step guide:');
      logger.error('   → See MONGODB_SETUP_SIMPLE.md for detailed instructions');
      logger.error('   → Or visit: https://github.com/rhysllwydlewis/eventflow#mongodb-setup');
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('');
      throw new Error(
        'Production error: MONGODB_URI must be set to a cloud MongoDB connection string'
      );
    }

    // Validate URI format
    const validation = validateMongoUri(cloudUri);
    if (!validation.valid) {
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('❌ INVALID MONGODB_URI');
      logger.error('='.repeat(70));
      logger.error('');
      logger.error(`Error: ${validation.error}`);
      logger.error('');
      logger.error('Your MONGODB_URI should look like:');
      logger.error(
        '  mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority'
      );
      logger.error('');
      logger.error('Common issues:');
      logger.error('  ✗ Using the example/placeholder from .env.example');
      logger.error('  ✗ Missing "mongodb://" or "mongodb+srv://" prefix');
      logger.error('  ✗ Missing credentials (username:password)');
      logger.error('  ✗ Not replacing "username", "password", "cluster" placeholders');
      logger.error('');
      logger.error('📚 Get your actual connection string:');
      logger.error('   → See MONGODB_SETUP_SIMPLE.md for step-by-step guide');
      logger.error('   → MongoDB Atlas: https://cloud.mongodb.com/');
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('');
      throw new Error(`Invalid MONGODB_URI: ${validation.error}`);
    }

    if (cloudUri.includes('localhost') || cloudUri.includes('127.0.0.1')) {
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('❌ MONGODB LOCALHOST NOT ALLOWED IN PRODUCTION');
      logger.error('='.repeat(70));
      logger.error('');
      logger.error("Your MONGODB_URI points to localhost, which won't work in production.");
      logger.error('');
      logger.error('You need a cloud MongoDB database (MongoDB Atlas):');
      logger.error('  → Free tier available at https://cloud.mongodb.com/');
      logger.error('  → See MONGODB_SETUP_SIMPLE.md for setup instructions');
      logger.error('');
      logger.error('='.repeat(70));
      logger.error('');
      throw new Error('Production error: MONGODB_URI cannot point to localhost');
    }
    return cloudUri;
  }

  // In development, prefer cloud but allow local fallback
  const uri = cloudUri || localUri;

  // Still validate format even in development
  if (cloudUri) {
    const validation = validateMongoUri(cloudUri);
    if (!validation.valid) {
      logger.warn('');
      logger.warn('⚠️  Warning: Invalid MONGODB_URI format');
      logger.warn(`   ${validation.error}`);
      logger.warn('   Falling back to local MongoDB');
      logger.warn('');
      return localUri;
    }
  }

  return uri;
}

/**
 * Connect to MongoDB database with retry logic
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelay - Initial delay between retries in ms
 * @returns {Promise<Object>} Database instance
 */
async function connect(maxRetries = 3, retryDelay = 2000) {
  if (db && connectionState === 'connected') {
    return db;
  }

  // If already connecting, wait a bit and check again
  if (connectionState === 'connecting') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (db && connectionState === 'connected') {
      return db;
    }
  }

  connectionState = 'connecting';
  connectionError = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const uri = getConnectionUri();
      const isProduction = process.env.NODE_ENV === 'production';

      // Log connection attempt (without exposing credentials)
      const sanitizedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//<credentials>@');

      // Extract and log host and database name safely
      let host = 'unknown';
      let dbName = process.env.MONGODB_DB_NAME || 'eventflow';
      try {
        const url = new URL(uri);
        host = url.hostname || url.host;
        // Extract database name from path if present
        if (url.pathname && url.pathname.length > 1) {
          const pathDb = url.pathname.substring(1).split('?')[0];
          if (pathDb) {
            dbName = pathDb;
          }
        }
      } catch (parseError) {
        // If URL parsing fails, use sanitized URI
        host = sanitizedUri.split('@')[1]?.split('/')[0] || 'unknown';
      }

      logger.info(`Connecting to MongoDB... (attempt ${attempt}/${maxRetries})`);
      logger.info(`Environment: ${isProduction ? 'production' : 'development'}`);
      logger.info(`Host: ${host}`);
      logger.info(`Database: ${dbName}`);

      client = new MongoClient(uri, options);
      await client.connect();

      // Get database name from URI or use default
      db = client.db(dbName);

      logger.info(`✅ Connected to MongoDB database: ${dbName}`);
      logger.info(`✅ Host: ${host}`);

      // Test the connection
      await db.admin().ping();
      logger.info('✅ MongoDB connection verified');

      connectionState = 'connected';
      connectionError = null;
      return db;
    } catch (error) {
      lastError = error;
      connectionState = 'error';
      connectionError = error.message;

      logger.error('');
      logger.error('='.repeat(70));
      logger.error(`❌ Failed to connect to MongoDB (attempt ${attempt}/${maxRetries})`);
      logger.error('='.repeat(70));
      logger.error('');
      logger.error(`Error: ${error.message}`);
      logger.error('');

      // Provide helpful error messages based on error type
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        logger.error('🔍 Diagnosis: Network error - Cannot reach MongoDB server');
        logger.error('');
        logger.error('This usually means:');
        logger.error('  • Your MongoDB cluster hostname is incorrect');
        logger.error('  • The cluster is not accessible from your network');
        logger.error('  • Your IP address is not whitelisted in MongoDB Atlas');
        logger.error('  • DNS resolution is failing (common on Railway/cloud platforms)');
        logger.error('');
        logger.error('What to check:');
        logger.error('  1. Verify your MONGODB_URI connection string is correct');
        logger.error('  2. In MongoDB Atlas, go to Network Access and add 0.0.0.0/0');
        logger.error('     (allows connections from anywhere, including Railway)');
        logger.error('  3. Check that your cluster is running and not paused');
        logger.error('  4. Try using mongodb:// format instead of mongodb+srv://');
        logger.error('');
      } else if (
        error.message.includes('authentication') ||
        error.message.includes('AuthenticationFailed')
      ) {
        logger.error('🔍 Diagnosis: Authentication failed');
        logger.error('');
        logger.error('This means your username or password is incorrect.');
        logger.error('');
        logger.error('What to do:');
        logger.error('  1. Go to MongoDB Atlas → Database Access');
        logger.error('  2. Check your database user exists');
        logger.error('  3. If needed, create a new user with a strong password');
        logger.error('  4. Update MONGODB_URI with the correct credentials:');
        logger.error('     mongodb+srv://USERNAME:PASSWORD@cluster...');
        logger.error('');
        logger.error('⚠️  Note: The password should be URL-encoded if it contains');
        logger.error('   special characters like @, :, /, ?, #, [, ]');
        logger.error('');
      } else if (error.message.includes('timeout')) {
        logger.error('🔍 Diagnosis: Connection timeout');
        logger.error('');
        logger.error('The MongoDB server is not responding.');
        logger.error('');
        logger.error('What to check:');
        logger.error('  1. Your internet connection is working');
        logger.error('  2. MongoDB Atlas cluster is not paused');
        logger.error('  3. Network Access settings allow your IP address (0.0.0.0/0)');
        logger.error('  4. No firewall is blocking the connection');
        logger.error('  5. Try increasing timeout values or using mongodb:// format');
        logger.error('');
      } else if (error.message.includes('Invalid scheme')) {
        logger.error('🔍 Diagnosis: Invalid connection string format');
        logger.error('');
        logger.error('Your MONGODB_URI must start with:');
        logger.error('  • mongodb:// for standard connection');
        logger.error('  • mongodb+srv:// for MongoDB Atlas (recommended)');
        logger.error('');
      }

      // If not the last attempt, wait before retrying with exponential backoff
      if (attempt < maxRetries) {
        const waitTime = retryDelay * 2 ** (attempt - 1);
        logger.error(`⏳ Retrying in ${waitTime / 1000} seconds...`);
        logger.error('');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        logger.error('📚 Need help?');
        logger.error('   → See MONGODB_SETUP_SIMPLE.md for detailed setup guide');
        logger.error('   → MongoDB Atlas: https://cloud.mongodb.com/');
        logger.error(
          '   → Documentation: https://github.com/rhysllwydlewis/eventflow#troubleshooting'
        );
        logger.error('');
        logger.error('='.repeat(70));
        logger.error('');
      }
    }
  }

  // All retries failed
  connectionState = 'error';
  connectionError = lastError.message;

  // Start periodic reconnection attempts (every 30 seconds)
  // This ensures the system keeps trying instead of giving up forever
  logger.info('⏰ Will retry connection every 30 seconds in background...');
  startPeriodicReconnect();

  throw lastError;
}

/**
 * Periodic reconnection attempt (runs in background)
 * Called after initial connection attempts fail
 * Keeps trying to reconnect every 30 seconds
 */
let reconnectTimer = null;

function startPeriodicReconnect() {
  // Don't start multiple timers
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setInterval(async () => {
    // Only try to reconnect if we're in error state
    if (connectionState === 'error' || connectionState === 'disconnected') {
      logger.info('⏰ Attempting periodic reconnection to MongoDB...');
      try {
        await connect(1, 0); // Single attempt, no delay
        logger.info('✅ Periodic reconnection successful!');
        // Stop periodic reconnection once connected
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
      } catch (error) {
        logger.info('⏰ Periodic reconnection failed, will retry in 30s');
      }
    } else if (connectionState === 'connected') {
      // Stop timer if we're somehow connected
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    }
  }, 30000); // 30 seconds

  // Unref the timer so it doesn't keep the process alive
  reconnectTimer.unref();
}

/**
 * Get database instance (creates connection if needed)
 * @returns {Promise<Object>} Database instance
 */
async function getDb() {
  if (!db) {
    await connect();
  }
  return db;
}

/**
 * Get a collection from the database
 * @param {string} collectionName - Name of the collection
 * @returns {Promise<Object>} Collection instance
 */
async function getCollection(collectionName) {
  const database = await getDb();
  return database.collection(collectionName);
}

/**
 * Close database connection
 * Should be called on application shutdown
 */
async function close() {
  if (client) {
    logger.info('Closing MongoDB connection...');
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

/**
 * Check if MongoDB is connected
 * @returns {boolean} Connection status
 */
function isConnected() {
  return connectionState === 'connected' && !!db;
}

/**
 * Get MongoDB connection state
 * @returns {string} Connection state: 'disconnected', 'connecting', 'connected', 'error'
 */
function getConnectionState() {
  return connectionState;
}

/**
 * Get last connection error
 * @returns {string|null} Error message or null
 */
function getConnectionError() {
  return connectionError;
}

/**
 * Check if MongoDB is available (has valid URI configuration)
 * @returns {boolean} Whether MongoDB can be used
 */
function isMongoAvailable() {
  // Check if we have a valid cloud MongoDB URI (not localhost)
  const cloudUri = process.env.MONGODB_URI;
  const localUri = process.env.MONGODB_LOCAL_URI;
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, only accept cloud MongoDB URI
  if (isProduction) {
    return !!cloudUri && !cloudUri.includes('localhost') && !cloudUri.includes('127.0.0.1');
  }

  // In development, accept either cloud or local
  return !!(cloudUri || localUri);
}

// Handle application shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`\nReceived ${signal}, closing MongoDB connection...`);
  await close();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = {
  connect,
  getDb,
  getCollection,
  close,
  isConnected,
  getConnectionState,
  getConnectionError,
  isMongoAvailable,
};
