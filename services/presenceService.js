/**
 * Presence Service
 * Manages user online/offline states and activity tracking
 */

'use strict';

const logger = require('../utils/logger');

// Presence states
const PRESENCE_STATES = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  AWAY: 'away',
};

// Timeout durations (in milliseconds)
const TIMEOUTS = {
  AWAY: 5 * 60 * 1000, // 5 minutes of inactivity = away
  OFFLINE: 15 * 60 * 1000, // 15 minutes of inactivity = offline
};

class PresenceService {
  constructor(redisClient = null) {
    // Use Redis for cluster support, fallback to in-memory
    this.useRedis = !!redisClient;
    this.redis = redisClient;

    // In-memory storage (used when Redis not available)
    this.presenceMap = new Map(); // userId -> { state, lastSeen, socketIds }

    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Every minute

    // Don't let housekeeping timers prevent process exit in test/CLI contexts.
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }

    logger.info('PresenceService initialized', { useRedis: this.useRedis });
  }

  /**
   * Set user as online
   */
  async setOnline(userId, socketId) {
    try {
      const now = Date.now();

      if (this.useRedis) {
        // Store in Redis for cluster support
        const key = `presence:${userId}`;
        await this.redis.hset(key, {
          state: PRESENCE_STATES.ONLINE,
          lastSeen: now,
        });
        await this.redis.expire(key, 1800); // 30 minutes TTL
        await this.redis.sadd(`presence:${userId}:sockets`, socketId);
      } else {
        // Store in memory
        const presence = this.presenceMap.get(userId) || {
          state: PRESENCE_STATES.ONLINE,
          lastSeen: now,
          socketIds: new Set(),
        };
        presence.state = PRESENCE_STATES.ONLINE;
        presence.lastSeen = now;
        presence.socketIds.add(socketId);
        this.presenceMap.set(userId, presence);
      }

      logger.debug('User set online', { userId, socketId });
    } catch (error) {
      logger.error('Error setting user online', { userId, error: error.message });
    }
  }

  /**
   * Set user as offline
   */
  async setOffline(userId, socketId) {
    try {
      if (this.useRedis) {
        // Remove socket from set
        await this.redis.srem(`presence:${userId}:sockets`, socketId);

        // Check if user has any other active sockets
        const socketCount = await this.redis.scard(`presence:${userId}:sockets`);

        if (socketCount === 0) {
          // No more active sockets - mark as offline
          const key = `presence:${userId}`;
          await this.redis.hset(key, {
            state: PRESENCE_STATES.OFFLINE,
            lastSeen: Date.now(),
          });
        }
      } else {
        // Remove from memory
        const presence = this.presenceMap.get(userId);
        if (presence) {
          presence.socketIds.delete(socketId);

          // If no more sockets, mark as offline
          if (presence.socketIds.size === 0) {
            presence.state = PRESENCE_STATES.OFFLINE;
            presence.lastSeen = Date.now();
          }
        }
      }

      logger.debug('User socket disconnected', { userId, socketId });
    } catch (error) {
      logger.error('Error setting user offline', { userId, error: error.message });
    }
  }

  /**
   * Update last seen timestamp (heartbeat)
   */
  async heartbeat(userId) {
    try {
      const now = Date.now();

      if (this.useRedis) {
        const key = `presence:${userId}`;
        await this.redis.hset(key, 'lastSeen', now);
        await this.redis.expire(key, 1800); // Reset TTL
      } else {
        const presence = this.presenceMap.get(userId);
        if (presence) {
          presence.lastSeen = now;
          // Update state based on activity
          if (presence.state === PRESENCE_STATES.AWAY) {
            presence.state = PRESENCE_STATES.ONLINE;
          }
        }
      }
    } catch (error) {
      logger.error('Error updating heartbeat', { userId, error: error.message });
    }
  }

  /**
   * Get user presence state
   */
  async getPresence(userId) {
    try {
      if (this.useRedis) {
        const key = `presence:${userId}`;
        const data = await this.redis.hgetall(key);

        if (!data || !data.state) {
          return { state: PRESENCE_STATES.OFFLINE, lastSeen: null };
        }

        return {
          state: data.state,
          lastSeen: parseInt(data.lastSeen, 10),
        };
      } else {
        const presence = this.presenceMap.get(userId);
        if (!presence) {
          return { state: PRESENCE_STATES.OFFLINE, lastSeen: null };
        }

        // Update state based on last seen
        this.updatePresenceState(presence);

        return {
          state: presence.state,
          lastSeen: presence.lastSeen,
        };
      }
    } catch (error) {
      logger.error('Error getting presence', { userId, error: error.message });
      return { state: PRESENCE_STATES.OFFLINE, lastSeen: null };
    }
  }

  /**
   * Get presence for multiple users
   */
  async getBulkPresence(userIds) {
    try {
      const results = {};

      await Promise.all(
        userIds.map(async userId => {
          results[userId] = await this.getPresence(userId);
        })
      );

      return results;
    } catch (error) {
      logger.error('Error getting bulk presence', { error: error.message });
      return {};
    }
  }

  /**
   * Check if user is online
   */
  async isOnline(userId) {
    const presence = await this.getPresence(userId);
    return presence.state === PRESENCE_STATES.ONLINE;
  }

  /**
   * Get all online users
   */
  async getOnlineUsers() {
    try {
      if (this.useRedis) {
        // Get all presence keys from Redis
        const keys = await this.redis.keys('presence:*');
        const onlineUsers = [];

        for (const key of keys) {
          if (!key.includes(':sockets')) {
            const data = await this.redis.hgetall(key);
            if (data.state === PRESENCE_STATES.ONLINE) {
              const userId = key.replace('presence:', '');
              onlineUsers.push(userId);
            }
          }
        }

        return onlineUsers;
      } else {
        const onlineUsers = [];

        for (const [userId, presence] of this.presenceMap.entries()) {
          this.updatePresenceState(presence);
          if (presence.state === PRESENCE_STATES.ONLINE) {
            onlineUsers.push(userId);
          }
        }

        return onlineUsers;
      }
    } catch (error) {
      logger.error('Error getting online users', { error: error.message });
      return [];
    }
  }

  /**
   * Get count of online users
   */
  async getOnlineCount() {
    const users = await this.getOnlineUsers();
    return users.length;
  }

  /**
   * Update presence state based on last seen time
   */
  updatePresenceState(presence) {
    const now = Date.now();
    const timeSinceLastSeen = now - presence.lastSeen;

    if (timeSinceLastSeen > TIMEOUTS.OFFLINE) {
      presence.state = PRESENCE_STATES.OFFLINE;
    } else if (timeSinceLastSeen > TIMEOUTS.AWAY) {
      presence.state = PRESENCE_STATES.AWAY;
    }
  }

  /**
   * Cleanup inactive presence records
   */
  cleanup() {
    try {
      if (!this.useRedis) {
        const now = Date.now();

        for (const [userId, presence] of this.presenceMap.entries()) {
          const timeSinceLastSeen = now - presence.lastSeen;

          // Remove records older than 1 hour
          if (timeSinceLastSeen > 60 * 60 * 1000) {
            this.presenceMap.delete(userId);
          }
        }
      }
      // Redis auto-expires keys with TTL, no cleanup needed
    } catch (error) {
      logger.error('Error during presence cleanup', { error: error.message });
    }
  }

  /**
   * Shutdown cleanup
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger.info('PresenceService destroyed');
  }
}

module.exports = {
  PresenceService,
  PRESENCE_STATES,
};
