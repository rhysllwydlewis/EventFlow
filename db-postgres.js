'use strict';

/**
 * db-postgres.js — PostgreSQL / Prisma client wrapper (PR1 Foundation)
 *
 * This module instantiates PrismaClient and re-exports it as the single
 * Postgres database interface for EventFlow.  It is intentionally a thin
 * wrapper so that PR2+ can swap in richer DAL logic without changing callers.
 *
 * ⚠️  MongoDB is still the active database in PR1.
 *     This module is NOT used by any route or service yet.
 *     Application cutover happens in PR2.
 *
 * Usage (after PR2 cutover):
 *   const { prisma, getPrismaClient } = require('./db-postgres');
 *   const users = await prisma.user.findMany();
 *
 * Railway connection notes:
 *   - Internal (service-to-service):  use DATABASE_URL (no sslmode needed)
 *   - External (local migrations):    use DATABASE_PUBLIC_URL with ?sslmode=require
 *   - See docs/POSTGRES_MIGRATION.md for the full Railway guide.
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('./utils/logger');

// ─── Singleton pattern ────────────────────────────────────────────────────────

/** @type {PrismaClient | null} */
let _client = null;

/**
 * Return the shared PrismaClient singleton, creating it on first call.
 *
 * Prisma recommends creating a single PrismaClient per process so that
 * connection pool resources are shared.  In hot-reload dev environments
 * (e.g. nodemon) the singleton is stored on `global` to prevent multiple
 * pools from accumulating.
 *
 * @returns {PrismaClient}
 */
function getPrismaClient() {
  if (_client) {
    return _client;
  }

  // In development use `global` to survive hot-reload cycles.
  if (process.env.NODE_ENV !== 'production') {
    if (!global._prismaClient) {
      global._prismaClient = _buildClient();
    }
    _client = global._prismaClient;
  } else {
    _client = _buildClient();
  }

  return _client;
}

/**
 * Build a new PrismaClient and attach event listeners.
 * @returns {PrismaClient}
 */
function _buildClient() {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { level: 'query', emit: 'event' },
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ]
        : [
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ],
  });

  // Log slow queries in development (>200 ms)
  if (process.env.NODE_ENV === 'development') {
    client.$on('query', e => {
      if (e.duration > 200) {
        logger.warn(`[Prisma slow query] ${e.duration}ms  ${e.query}`);
      }
    });
  }

  return client;
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Disconnect PrismaClient.  Should be called during application shutdown so
 * that the connection pool is cleanly released.
 *
 * This is called automatically when the process receives SIGINT / SIGTERM —
 * the same signals already handled by db.js for MongoDB.
 */
async function disconnect() {
  if (_client) {
    await _client.$disconnect();
    _client = null;
    if (global._prismaClient) {
      global._prismaClient = undefined;
    }
    logger.info('PostgreSQL (Prisma) connection closed');
  }
}

// Register shutdown handlers (mirror db.js pattern)
let _disconnecting = false;
async function _gracefulShutdown(signal) {
  if (_disconnecting) return;
  _disconnecting = true;
  logger.info(`Received ${signal} — disconnecting Prisma…`);
  await disconnect();
}

process.on('SIGINT', () => _gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Check whether the Postgres connection is reachable.
 *
 * @returns {Promise<boolean>}
 */
async function isPostgresAvailable() {
  if (!process.env.DATABASE_URL) {
    return false;
  }
  try {
    const client = getPrismaClient();
    // A raw SELECT 1 is the cheapest possible health-check query.
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/** Shared PrismaClient singleton — use this in DAL / route handlers */
const prisma = getPrismaClient();

module.exports = {
  prisma,
  getPrismaClient,
  disconnect,
  isPostgresAvailable,
};
