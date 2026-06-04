/**
 * Per-key async mutex.
 *
 * Serialises concurrent read-modify-write operations that target the same
 * collection so that two simultaneous requests cannot interleave their reads
 * and writes and silently overwrite each other's data.
 *
 * ⚠️  IMPORTANT: This mutex is in-process only. It provides no protection
 * against concurrent writes from other Node.js process instances (e.g. multiple
 * Railway dynos or Heroku workers). On MongoDB, prefer atomic operations
 * (insertOne / updateOne / deleteOne) which are safe across multiple instances.
 * This utility is primarily useful for the local file-store backend where
 * multiple async handlers in the same process can race on a single JSON file.
 *
 * Usage:
 *   const { withLock } = require('../utils/asyncMutex');
 *
 *   await withLock('my_collection', async () => {
 *     const items = await db.read('my_collection');
 *     items.push(newItem);
 *     await db.write('my_collection', items);
 *   });
 */

'use strict';

// Map of lock-key → settled-tail promise.
// Each new caller chains off the current tail so operations are serialised.
const tails = new Map();

/** No-op used to swallow settled-value / error from tail chains. */
function noop() {}

/**
 * Run `fn` exclusively for the given key, queuing behind any in-flight call
 * for the same key.  Calls for *different* keys run in parallel.
 *
 * If `fn` throws, the error propagates to the caller but the queue still
 * advances so subsequent callers are not blocked indefinitely.
 *
 * @param {string}   key - Lock key (typically the collection name).
 * @param {Function} fn  - Async function to run exclusively.
 * @returns {Promise<*>} Resolves / rejects with fn()'s return value / error.
 */
function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();

  // `current` runs fn() after the previous operation for this key settles.
  // The second branch of .then(…, …) ensures the queue advances even when
  // the *previous* caller failed.
  const current = prev.then(
    () => fn(),
    () => fn()
  );

  // Store a non-rejecting tail so future callers aren't accidentally blocked
  // by errors from the current caller.
  const next = current.then(noop, noop);
  tails.set(key, next);

  // Clean up the map entry once this slot is fully settled to avoid leaks.
  next.then(() => {
    if (tails.get(key) === next) {
      tails.delete(key);
    }
  });

  return current;
}

module.exports = { withLock };
