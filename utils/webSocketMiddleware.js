/**
 * WebSocket Middleware
 * JWT-based authentication and authorization for WebSocket connections
 */

'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

/**
 * Validate JWT token from WebSocket handshake
 */
function validateWebSocketToken(socket, next) {
  try {
    // Extract token from handshake auth or query parameters
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      logger.warn('WebSocket connection attempt without token', {
        socketId: socket.id,
      });
      return next(new Error('Authentication required'));
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Attach user info to socket
    socket.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    // Also store userId directly for easier access
    socket.userId = decoded.id;

    logger.debug('WebSocket connection authenticated', {
      socketId: socket.id,
      userId: decoded.id,
    });

    next();
  } catch (error) {
    logger.error('WebSocket authentication failed', {
      socketId: socket.id,
      error: error.message,
    });

    if (error.name === 'TokenExpiredError') {
      return next(new Error('Token expired'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(new Error('Invalid token'));
    }

    return next(new Error('Authentication failed'));
  }
}

/**
 * Role-based authorization middleware
 */
function requireRole(...roles) {
  return (socket, next) => {
    try {
      if (!socket.user) {
        return next(new Error('Authentication required'));
      }

      if (!roles.includes(socket.user.role)) {
        logger.warn('WebSocket unauthorized role access attempt', {
          socketId: socket.id,
          userId: socket.user.id,
          requiredRoles: roles,
          userRole: socket.user.role,
        });
        return next(new Error('Insufficient permissions'));
      }

      next();
    } catch (error) {
      logger.error('WebSocket authorization error', {
        socketId: socket.id,
        error: error.message,
      });
      return next(new Error('Authorization failed'));
    }
  };
}

/**
 * Rate limiting middleware for WebSocket events
 */
function rateLimiter(maxEvents = 100, windowMs = 60000) {
  const eventCounts = new Map(); // socketId -> { count, resetAt }

  return (socket, next) => {
    try {
      const socketId = socket.id;
      const now = Date.now();

      // Get or initialize event count
      let record = eventCounts.get(socketId);

      if (!record || now >= record.resetAt) {
        // Create new record
        record = {
          count: 1,
          resetAt: now + windowMs,
        };
        eventCounts.set(socketId, record);
        return next();
      }

      // Increment count
      record.count++;

      // Check if limit exceeded
      if (record.count > maxEvents) {
        logger.warn('WebSocket rate limit exceeded', {
          socketId,
          userId: socket.userId,
          count: record.count,
          limit: maxEvents,
        });
        return next(new Error('Rate limit exceeded'));
      }

      next();
    } catch (error) {
      logger.error('WebSocket rate limiter error', {
        socketId: socket.id,
        error: error.message,
      });
      return next(new Error('Rate limiting failed'));
    }
  };
}

/**
 * Logging middleware for WebSocket events
 */
function eventLogger(socket, eventName, data) {
  logger.debug('WebSocket event', {
    socketId: socket.id,
    userId: socket.userId,
    event: eventName,
    dataKeys: data ? Object.keys(data) : [],
  });
}

/**
 * Error handler for WebSocket connections
 */
function errorHandler(error, socket) {
  logger.error('WebSocket error', {
    socketId: socket.id,
    userId: socket.userId,
    error: error.message,
    stack: error.stack,
  });

  // Emit error to client
  socket.emit('error', {
    message: error.message || 'An error occurred',
    code: error.code || 'INTERNAL_ERROR',
  });
}

/**
 * Validate message data
 */
function validateMessageData(requiredFields) {
  return (data, callback) => {
    try {
      if (!data || typeof data !== 'object') {
        return callback(new Error('Invalid data format'));
      }

      // Check required fields
      for (const field of requiredFields) {
        if (!(field in data)) {
          return callback(new Error(`Missing required field: ${field}`));
        }
      }

      callback(null, data);
    } catch (error) {
      callback(error);
    }
  };
}

/**
 * Sanitize message content
 */
function sanitizeContent(content) {
  if (typeof content !== 'string') {
    return '';
  }

  // Basic XSS prevention
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 10000); // Max length
}

/**
 * Check if user is participant in thread
 * Handles both v1 threads (customerId/supplierId/recipientId) and v2 threads (participants array)
 * @param {string} userId
 * @param {string} threadId
 * @param {Object} messagingService - must expose getThread(threadId); ignored when
 *   prefetchedThread is provided
 * @param {Object} [prefetchedThread] - pass the thread if the caller already fetched it
 *   (e.g. to find recipients) to avoid a redundant getThread() round-trip
 */
async function isThreadParticipant(userId, threadId, messagingService, prefetchedThread) {
  try {
    const thread =
      prefetchedThread !== undefined
        ? prefetchedThread
        : await messagingService.getThread(threadId);
    if (!thread) {
      return false;
    }

    // v2 threads have a participants array
    if (thread.participants && Array.isArray(thread.participants)) {
      return thread.participants.includes(userId);
    }

    // v1 threads use customerId/supplierId/recipientId fields
    if (thread.customerId === userId) {
      return true;
    }
    if (thread.recipientId === userId) {
      return true;
    }
    if (thread.supplierId === userId) {
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Error checking thread participant', {
      userId,
      threadId,
      error: error.message,
    });
    return false;
  }
}

module.exports = {
  validateWebSocketToken,
  requireRole,
  rateLimiter,
  eventLogger,
  errorHandler,
  validateMessageData,
  sanitizeContent,
  isThreadParticipant,
};
