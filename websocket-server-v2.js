/**
 * WebSocket Server v2
 * Production-ready WebSocket messaging server with clustering support
 */

'use strict';

const { Server } = require('socket.io');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const logger = require('./utils/logger');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const { PresenceService } = require('./services/presenceService');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const jwt = require('jsonwebtoken');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const { userIdFromCookie } = require('./utils/wsAuth');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const { ObjectId } = require('mongodb');
// eslint-disable-next-line node/no-unpublished-require, node/no-missing-require
const { isThreadParticipant } = require('./utils/webSocketMiddleware');

// Only 24-hex-char strings are valid conversation ObjectIds — rejects
// anything else up-front to avoid throwing inside the Mongo driver.
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

// Shared symbol for preventing duplicate Socket.IO servers across v1 and v2
// This prevents the "server.handleUpgrade() was called more than once" error
const WS_SERVER_INITIALIZED = Symbol.for('eventflow.wsServerInitialized');

// Try to load Redis adapter for clustering (optional)
let RedisAdapter;
let redisClient;
try {
  // eslint-disable-next-line node/no-missing-require
  const { createAdapter } = require('@socket.io/redis-adapter');
  const Redis = require('ioredis');
  RedisAdapter = createAdapter;

  // Initialize Redis if REDIS_URL is set
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    logger.info('Redis client initialized for WebSocket clustering');
  }
} catch (error) {
  if (process.env.REDIS_URL) {
    logger.warn('Redis URL configured but Redis adapter is not available', {
      error: error.message,
    });
  } else {
    logger.info('Redis adapter not available - clustering disabled (optional in current config)');
  }
}

class WebSocketServerV2 {
  constructor(httpServer, messagingService = null, notificationService = null) {
    // Guard against multiple instantiations on the same server (v1 or v2)
    if (httpServer[WS_SERVER_INITIALIZED]) {
      logger.warn('WebSocket Server v2 already initialized for this HTTP server');
      throw new Error('WebSocket Server v2 already initialized for this HTTP server');
    }

    this.io = new Server(httpServer, {
      cors: {
        origin: [
          process.env.APP_BASE_URL,
          process.env.BASE_URL,
          ...(process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',')
                .map(origin => origin.trim())
                .filter(Boolean)
            : []),
          ...(process.env.NODE_ENV !== 'production'
            ? ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000']
            : []),
        ].filter(Boolean),
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
    });

    // Mark server as having WebSocket initialized (shared guard with v1)
    httpServer[WS_SERVER_INITIALIZED] = true;

    this.messagingService = messagingService;
    this.notificationService = notificationService;

    // Initialize presence service with Redis if available
    this.presenceService = new PresenceService(redisClient);

    // Tracking maps
    this.userSockets = new Map(); // userId -> Set of socket IDs
    this.socketUsers = new Map(); // socketId -> userId

    // Typing indicators tracking
    this.typingUsers = new Map(); // threadId -> Set of userIds

    // Setup Redis adapter if available
    if (RedisAdapter && redisClient) {
      try {
        const pubClient = redisClient;
        const subClient = pubClient.duplicate();
        this.io.adapter(RedisAdapter(pubClient, subClient));
        logger.info('Socket.IO Redis adapter enabled for clustering');
      } catch (error) {
        logger.error('Failed to setup Redis adapter', { error: error.message });
      }
    }

    this.init();
  }

  init() {
    // Handshake middleware: pre-authenticate sockets from the HTTP-only JWT cookie.
    // This runs before 'connection' fires so socket.userId is already set for cookie-auth users.
    // Connections are never rejected here — unauthenticated sockets may still connect but
    // will fail on any protected event handler.
    this.io.use((socket, next) => {
      const cookieHeader = socket.handshake.headers.cookie;
      const userId = userIdFromCookie(cookieHeader);
      if (userId) {
        socket.userId = userId;
        logger.debug('WebSocket pre-authenticated via cookie', { socketId: socket.id, userId });
      }
      next();
    });

    this.io.on('connection', socket => {
      logger.debug('WebSocket connected', { socketId: socket.id });

      // Conversation ids this socket has already passed isConversationParticipant()
      // for via messenger:v4:join-conversation — reused by messenger:typing so a
      // busy typist doesn't trigger a DB lookup on every keystroke.
      socket.v4JoinedConversations = new Set();

      // Authentication handler
      socket.on('auth', async data => {
        await this.handleAuth(socket, data);
      });

      // Message handlers
      socket.on('message:send', async data => {
        await this.handleMessageSend(socket, data);
      });

      // Typing indicators
      socket.on('typing:start', data => {
        this.handleTypingStart(socket, data);
      });

      socket.on('typing:stop', data => {
        this.handleTypingStop(socket, data);
      });

      // Read receipts
      socket.on('message:read', async data => {
        await this.handleMessageRead(socket, data);
      });

      socket.on('thread:read', async data => {
        await this.handleThreadRead(socket, data);
      });

      // Reactions
      socket.on('reaction:send', async data => {
        await this.handleReactionSend(socket, data);
      });

      // Presence
      socket.on('presence:update', async data => {
        await this.handlePresenceUpdate(socket, data);
      });

      socket.on('presence:sync', async data => {
        await this.handlePresenceSync(socket, data);
      });

      // Messenger v4 event handlers
      socket.on('messenger:v4:join-conversation', async data => {
        const conversationId = data && data.conversationId;
        if (!conversationId) {
          return;
        }

        // Require an authenticated socket before allowing room membership —
        // joining an arbitrary conversation:v4 room would otherwise let a
        // user receive another user's realtime messages (IDOR on realtime).
        if (!socket.userId) {
          socket.emit('messenger:v4:join-error', {
            conversationId,
            error: 'unauthenticated',
          });
          logger.warn('v4 join denied: unauthenticated socket', {
            socketId: socket.id,
            conversationId,
          });
          return;
        }

        // Validate the conversation id format before any DB call.
        if (typeof conversationId !== 'string' || !OBJECT_ID_RE.test(conversationId)) {
          socket.emit('messenger:v4:join-error', {
            conversationId,
            error: 'invalid_conversation_id',
          });
          return;
        }

        try {
          const isParticipant = await this.isConversationParticipant(conversationId, socket.userId);
          if (!isParticipant) {
            socket.emit('messenger:v4:join-error', {
              conversationId,
              error: 'forbidden',
            });
            logger.warn('v4 join denied: not a participant', {
              socketId: socket.id,
              userId: socket.userId,
              conversationId,
            });
            return;
          }

          socket.join(`conversation:v4:${conversationId}`);
          socket.v4JoinedConversations.add(conversationId);
          logger.debug('Joined v4 conversation', {
            socketId: socket.id,
            userId: socket.userId,
            conversationId,
          });
        } catch (error) {
          logger.error('v4 join failed', {
            socketId: socket.id,
            conversationId,
            error: error.message,
          });
          socket.emit('messenger:v4:join-error', {
            conversationId,
            error: 'server_error',
          });
        }
      });

      socket.on('messenger:v4:leave-conversation', data => {
        if (data && data.conversationId) {
          socket.leave(`conversation:v4:${data.conversationId}`);
          socket.v4JoinedConversations.delete(data.conversationId);
          logger.debug('Left v4 conversation', {
            socketId: socket.id,
            conversationId: data.conversationId,
          });
        }
      });

      // Typing indicator for messenger v4 (client → server → other participants in room)
      socket.on('messenger:typing', async data => {
        const conversationId = data?.conversationId;
        if (!socket.userId || !conversationId) {
          return;
        }

        // Require actual conversation participancy before broadcasting, same as
        // messenger:v4:join-conversation above — otherwise any authenticated user
        // who merely knows/guesses a conversationId could spoof typing indicators
        // into a conversation they were never part of (IDOR on realtime).
        if (typeof conversationId !== 'string' || !OBJECT_ID_RE.test(conversationId)) {
          return;
        }

        // The composer fires this on every keystroke with no client-side throttling,
        // so reuse the participancy already established by a successful room join
        // instead of hitting the DB on every keystroke; fall back to a DB check for
        // the rare case a client sends typing before/without joining.
        const isParticipant = socket.v4JoinedConversations.has(conversationId)
          ? true
          : await this.isConversationParticipant(conversationId, socket.userId);
        if (!isParticipant) {
          logger.warn('Typing indicator denied: not a participant', {
            socketId: socket.id,
            userId: socket.userId,
            conversationId,
          });
          return;
        }

        // Broadcast to all OTHER sockets in the conversation room.
        // socket.to() excludes the sender automatically.
        socket.to(`conversation:v4:${conversationId}`).emit('messenger:v4:typing', {
          conversationId,
          userId: socket.userId,
          userName: data.userName || '',
          // Default isTyping to true — stop-typing events carry isTyping: false
          isTyping: data.isTyping !== false,
        });

        logger.debug('Typing indicator forwarded', {
          userId: socket.userId,
          conversationId,
          isTyping: data.isTyping,
        });
      });

      // Disconnection
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });

      // Error handling
      socket.on('error', error => {
        logger.error('Socket error', {
          socketId: socket.id,
          error: error.message,
        });
      });
    });

    // Periodic cleanup
    const wsCleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000); // Every 5 minutes
    // Allow the process to exit even if this timer is still active
    if (wsCleanupInterval.unref) {
      wsCleanupInterval.unref();
    }

    logger.info('WebSocket Server v2 initialized');
  }

  /**
   * Handle user authentication
   *
   * Supports two flows:
   *   1. Cookie-first (default): socket was pre-authenticated via the HTTP-only JWT cookie
   *      at handshake time; `auth` event just confirms and completes the setup.
   *   2. Token-based: caller sends `{ token }` for environments where cookies are unavailable.
   */
  async handleAuth(socket, data) {
    try {
      let userId = socket.userId; // may already be set by the io.use() cookie middleware

      if (!userId) {
        // Fallback: explicit token provided in the auth payload
        if (!data || !data.token) {
          socket.emit('auth:error', { error: 'Missing token' });
          return;
        }
        try {
          const JWT_SECRET = process.env.JWT_SECRET;
          if (!JWT_SECRET) {
            logger.error(
              'JWT_SECRET environment variable is not set - WebSocket auth cannot proceed'
            );
            socket.emit('auth:error', { error: 'Server configuration error' });
            return;
          }
          const decoded = jwt.verify(data.token, JWT_SECRET);
          // Field fallback: `id` is the standard field for this app (routes/auth.js);
          // `userId` is a legacy alias; `sub` follows RFC 7519 for forward compatibility.
          userId = decoded.id || decoded.userId || decoded.sub;
          if (!userId) {
            socket.emit('auth:error', { error: 'Invalid token: missing user ID' });
            return;
          }
        } catch (err) {
          socket.emit('auth:error', { error: 'Invalid or expired token' });
          return;
        }
      }

      // Store user-socket mapping
      socket.userId = userId;
      this.socketUsers.set(socket.id, userId);

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(socket.id);

      // Join user's personal room
      socket.join(`user:${userId}`);

      // Set user as online
      await this.presenceService.setOnline(userId, socket.id);

      // Emit presence update to contacts
      this.broadcastPresenceUpdate(userId, 'online');

      socket.emit('auth:success', { userId });

      logger.info('User authenticated', { userId, socketId: socket.id });
    } catch (error) {
      logger.error('Auth error', { error: error.message });
      socket.emit('auth:error', { error: error.message });
    }
  }

  /**
   * Handle message send
   */
  async handleMessageSend(socket, data) {
    try {
      if (!socket.userId) {
        socket.emit('message:error', { error: 'Not authenticated' });
        return;
      }

      if (!this.messagingService) {
        socket.emit('message:error', { error: 'Messaging service not available' });
        return;
      }

      const { threadId, content, attachments } = data;

      // Validate data
      if (!threadId || (!content && !attachments)) {
        socket.emit('message:error', { error: 'Missing required fields' });
        return;
      }

      // Get thread to find recipients
      const thread = await this.messagingService.getThread(threadId);
      if (!thread) {
        socket.emit('message:error', { error: 'Thread not found' });
        return;
      }

      // Security: verify the sender actually belongs to this thread before
      // sending on their behalf — without this a socket could pass any threadId
      // and broadcast a message into a conversation it isn't part of. Pass the
      // thread already fetched above so this doesn't do a second getThread() call.
      const senderIsParticipant = await isThreadParticipant(
        socket.userId,
        threadId,
        this.messagingService,
        thread
      );
      if (!senderIsParticipant) {
        socket.emit('message:error', { error: 'Not a participant in this thread' });
        logger.warn('Rejected message:send — sender not a thread participant', {
          userId: socket.userId,
          threadId,
        });
        return;
      }

      const recipientIds = thread.participants.filter(p => p !== socket.userId);

      // Send message via messaging service
      const message = await this.messagingService.sendMessage({
        threadId,
        senderId: socket.userId,
        recipientIds,
        content,
        attachments: attachments || [],
      });

      // Emit to sender (confirmation)
      socket.emit('message:sent', {
        messageId: message._id.toString(),
        threadId,
        message,
      });

      // Broadcast to recipients
      for (const recipientId of recipientIds) {
        this.io.to(`user:${recipientId}`).emit('message:received', {
          threadId,
          message,
        });
      }

      // Send notifications to offline recipients
      if (this.notificationService) {
        for (const recipientId of recipientIds) {
          const isOnline = await this.presenceService.isOnline(recipientId);
          if (!isOnline) {
            await this.notificationService.sendNotification(recipientId, {
              type: 'message',
              title: 'New Message',
              message: content?.substring(0, 100) || 'You have a new message',
              data: {
                threadId,
                messageId: message._id.toString(),
                url: `/messages.html?thread=${threadId}`,
              },
            });
          }
        }
      }

      logger.debug('Message sent', {
        messageId: message._id,
        threadId,
        senderId: socket.userId,
      });
    } catch (error) {
      logger.error('Message send error', { error: error.message });
      socket.emit('message:error', { error: error.message });
    }
  }

  /**
   * Handle typing start
   */
  async handleTypingStart(socket, data) {
    try {
      if (!socket.userId) {
        return;
      }

      const { threadId, recipientId } = data;
      if (!threadId) {
        return;
      }

      // Verify the sender actually belongs to this thread before broadcasting
      // on their behalf — otherwise a socket could pass any threadId/recipientId
      // and spoof a "typing" event at an arbitrary user (same check as
      // handleMessageSend's participant guard).
      if (!this.messagingService) {
        return;
      }
      const senderIsParticipant = await isThreadParticipant(
        socket.userId,
        threadId,
        this.messagingService
      );
      if (!senderIsParticipant) {
        logger.warn('Rejected typing:start — sender not a thread participant', {
          userId: socket.userId,
          threadId,
        });
        return;
      }

      // Track typing user
      if (!this.typingUsers.has(threadId)) {
        this.typingUsers.set(threadId, new Set());
      }
      this.typingUsers.get(threadId).add(socket.userId);

      // Broadcast to recipient(s)
      if (recipientId) {
        this.io.to(`user:${recipientId}`).emit('typing:started', {
          threadId,
          userId: socket.userId,
        });
      } else {
        // Broadcast to thread room
        socket.to(`thread:${threadId}`).emit('typing:started', {
          threadId,
          userId: socket.userId,
        });
      }

      logger.debug('Typing started', { threadId, userId: socket.userId });
    } catch (error) {
      logger.error('Typing start error', { error: error.message });
    }
  }

  /**
   * Handle typing stop
   */
  async handleTypingStop(socket, data) {
    try {
      if (!socket.userId) {
        return;
      }

      const { threadId, recipientId } = data;
      if (!threadId) {
        return;
      }

      // Same participant check as handleTypingStart — a "stop" broadcast is
      // just as capable of spoofing a typing state at an arbitrary user.
      if (!this.messagingService) {
        return;
      }
      const senderIsParticipant = await isThreadParticipant(
        socket.userId,
        threadId,
        this.messagingService
      );
      if (!senderIsParticipant) {
        return;
      }

      // Remove from typing users
      if (this.typingUsers.has(threadId)) {
        this.typingUsers.get(threadId).delete(socket.userId);
        if (this.typingUsers.get(threadId).size === 0) {
          this.typingUsers.delete(threadId);
        }
      }

      // Broadcast to recipient(s)
      if (recipientId) {
        this.io.to(`user:${recipientId}`).emit('typing:stopped', {
          threadId,
          userId: socket.userId,
        });
      } else {
        // Broadcast to thread room
        socket.to(`thread:${threadId}`).emit('typing:stopped', {
          threadId,
          userId: socket.userId,
        });
      }

      logger.debug('Typing stopped', { threadId, userId: socket.userId });
    } catch (error) {
      logger.error('Typing stop error', { error: error.message });
    }
  }

  /**
   * Handle message read
   */
  async handleMessageRead(socket, data) {
    try {
      if (!socket.userId || !this.messagingService) {
        return;
      }

      const { messageId } = data;
      if (!messageId) {
        return;
      }

      await this.messagingService.markMessageAsRead(messageId, socket.userId);

      // Notify sender about read receipt
      const message = await this.messagingService.getMessage(messageId);
      if (message && message.senderId) {
        this.io.to(`user:${message.senderId}`).emit('message:read', {
          messageId,
          userId: socket.userId,
          readAt: new Date(),
        });
      }

      logger.debug('Message marked as read', { messageId, userId: socket.userId });
    } catch (error) {
      logger.error('Message read error', { error: error.message });
    }
  }

  /**
   * Handle thread read
   */
  async handleThreadRead(socket, data) {
    try {
      if (!socket.userId || !this.messagingService) {
        return;
      }

      const { threadId } = data;
      if (!threadId) {
        return;
      }

      await this.messagingService.markThreadAsRead(threadId, socket.userId);

      logger.debug('Thread marked as read', { threadId, userId: socket.userId });
    } catch (error) {
      logger.error('Thread read error', { error: error.message });
    }
  }

  /**
   * Handle reaction send
   */
  async handleReactionSend(socket, data) {
    try {
      if (!socket.userId || !this.messagingService) {
        return;
      }

      const { messageId, emoji } = data;
      if (!messageId || !emoji) {
        return;
      }

      const message = await this.messagingService.addReaction(messageId, socket.userId, emoji);

      // Broadcast reaction update
      socket.to(`thread:${message.threadId}`).emit('reaction:received', {
        messageId,
        reactions: message.reactions,
      });

      logger.debug('Reaction added', { messageId, userId: socket.userId, emoji });
    } catch (error) {
      logger.error('Reaction send error', { error: error.message });
    }
  }

  /**
   * Handle presence update (heartbeat)
   */
  async handlePresenceUpdate(socket) {
    try {
      if (!socket.userId) {
        return;
      }

      await this.presenceService.heartbeat(socket.userId);

      logger.debug('Presence heartbeat', { userId: socket.userId });
    } catch (error) {
      logger.error('Presence update error', { error: error.message });
    }
  }

  /**
   * Handle presence sync request
   */
  async handlePresenceSync(socket, data) {
    try {
      if (!socket.userId) {
        return;
      }

      const { userIds } = data;
      if (!userIds || !Array.isArray(userIds)) {
        return;
      }

      const presence = await this.presenceService.getBulkPresence(userIds);

      socket.emit('presence:synced', { presence });

      logger.debug('Presence synced', { userId: socket.userId, count: userIds.length });
    } catch (error) {
      logger.error('Presence sync error', { error: error.message });
    }
  }

  /**
   * Handle disconnection
   */
  async handleDisconnect(socket) {
    try {
      const userId = socket.userId || this.socketUsers.get(socket.id);

      if (userId) {
        // Remove socket mapping
        const userSocketSet = this.userSockets.get(userId);
        if (userSocketSet) {
          userSocketSet.delete(socket.id);
          if (userSocketSet.size === 0) {
            this.userSockets.delete(userId);
          }
        }
        this.socketUsers.delete(socket.id);

        // Clear any typing indicators left dangling by a mid-type disconnect
        // (typing:stop is only emitted explicitly by the client, never on
        // disconnect, so without this the entry lingers until process exit).
        if (!this.userSockets.has(userId)) {
          for (const [threadId, typingSet] of this.typingUsers) {
            if (typingSet.delete(userId) && typingSet.size === 0) {
              this.typingUsers.delete(threadId);
            }
          }
        }

        // Update presence — setUserOffline removes user from online set
        await this.presenceService.setOffline(userId, socket.id);

        // Check if user is still online (other sockets)
        const isStillOnline = this.userSockets.has(userId);
        if (!isStillOnline) {
          this.broadcastPresenceUpdate(userId, 'offline');
        }

        logger.info('User disconnected', { userId, socketId: socket.id });
      } else {
        logger.debug('Socket disconnected', { socketId: socket.id });
      }
    } catch (error) {
      logger.error('Disconnect error', { error: error.message });
    }
  }

  /**
   * Broadcast presence update
   * Emits only to authenticated users' personal rooms rather than all connected sockets
   */
  broadcastPresenceUpdate(userId, state) {
    try {
      // Emit to each authenticated user's room, excluding the user whose state changed
      // (users don't need to be notified of their own presence changes)
      for (const onlineUserId of this.userSockets.keys()) {
        if (onlineUserId !== userId) {
          this.io.to(`user:${onlineUserId}`).emit('presence:changed', {
            userId,
            state,
            timestamp: new Date(),
          });
        }
      }
    } catch (error) {
      logger.error('Broadcast presence error', { error: error.message });
    }
  }

  /**
   * Send notification to specific user
   */
  sendNotification(userId, notification) {
    try {
      this.io.to(`user:${userId}`).emit('notification:received', notification);
      logger.debug('Notification sent via WebSocket', { userId });
    } catch (error) {
      logger.error('Send notification error', { userId, error: error.message });
    }
  }

  /**
   * Send notification to room
   */
  sendRoomNotification(room, notification) {
    try {
      this.io.to(room).emit('notification:received', notification);
    } catch (error) {
      logger.error('Send room notification error', { room, error: error.message });
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(event, data) {
    try {
      this.io.emit(event, data);
    } catch (error) {
      logger.error('Broadcast error', { event, error: error.message });
    }
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId) {
    return this.userSockets.has(userId);
  }

  /**
   * Get online users count
   */
  getOnlineUsersCount() {
    return this.userSockets.size;
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      connectedClients: this.io.engine.clientsCount,
      onlineUsers: this.userSockets.size,
      typingUsers: this.typingUsers.size,
      rooms: this.io.sockets.adapter.rooms.size,
    };
  }

  /**
   * Cleanup stale data
   */
  cleanup() {
    try {
      // Clean up typing indicators
      for (const [threadId, users] of this.typingUsers.entries()) {
        if (users.size === 0) {
          this.typingUsers.delete(threadId);
        }
      }

      logger.debug('WebSocket cleanup completed');
    } catch (error) {
      logger.error('Cleanup error', { error: error.message });
    }
  }

  /**
   * Check whether the given user is a participant in the conversation.
   * Used to authorize socket joins of `conversation:v4:<id>` rooms.
   * Returns `false` (and logs a warning) when the MongoDB connection
   * is not attached to the WebSocket server — fail-closed by default
   * so an unconfigured setup never opens an IDOR hole.
   *
   * @param {string} conversationId - 24-hex-char conversation id
   * @param {string} userId - Authenticated socket userId
   * @returns {Promise<boolean>} true if the user is a participant
   */
  async isConversationParticipant(conversationId, userId) {
    if (!conversationId || !userId) {
      return false;
    }
    if (!this.db) {
      logger.warn('isConversationParticipant: db not attached to wsServerV2', {
        conversationId,
      });
      return false;
    }
    try {
      const match = await this.db.collection('conversations_v4').findOne(
        {
          _id: new ObjectId(conversationId),
          // Exclude a participant who hard-deleted this conversation for
          // themselves — otherwise they could rejoin the room and keep
          // receiving realtime messages/typing for a conversation every
          // REST read path already treats as gone for them.
          participants: { $elemMatch: { userId, isDeleted: { $ne: true } } },
        },
        { projection: { _id: 1 } }
      );
      return Boolean(match);
    } catch (error) {
      logger.error('isConversationParticipant: lookup failed', {
        conversationId,
        userId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Emit event to a specific user (supports v4 events)
   */
  emitToUser(userId, event, data) {
    try {
      this.io.to(`user:${userId}`).emit(event, data);
      logger.debug('Event emitted to user', { userId, event });
    } catch (error) {
      logger.error('Emit to user error', { userId, event, error: error.message });
    }
  }

  /**
   * Emit event to a conversation room (v4)
   */
  emitToConversation(conversationId, event, data) {
    try {
      this.io.to(`conversation:v4:${conversationId}`).emit(event, data);
      logger.debug('Event emitted to conversation', { conversationId, event });
    } catch (error) {
      logger.error('Emit to conversation error', {
        conversationId,
        event,
        error: error.message,
      });
    }
  }

  /**
   * Emit event to a specific room
   */
  emitToRoom(room, event, data) {
    try {
      this.io.to(room).emit(event, data);
      logger.debug('Event emitted to room', { room, event });
    } catch (error) {
      logger.error('Emit to room error', { room, event, error: error.message });
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    try {
      logger.info('Shutting down WebSocket server...');

      // Disconnect all clients
      this.io.disconnectSockets();

      // Cleanup presence service
      this.presenceService.destroy();

      // Close server
      this.io.close();

      logger.info('WebSocket server shut down successfully');
    } catch (error) {
      logger.error('Shutdown error', { error: error.message });
    }
  }
}

module.exports = WebSocketServerV2;
