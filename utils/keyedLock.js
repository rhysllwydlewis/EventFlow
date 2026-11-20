'use strict';

/**
 * Run work one at a time per key, inside this process.
 *
 * A check followed by a write ("is there room? then add") is only correct if nothing else can
 * change the answer in between. Two requests for the same key queue up here instead, in the order
 * they arrived, so the second one's check sees the first one's write.
 *
 * This serialises within one server process only. It does not protect two processes (several
 * replicas) from each other; for that the check has to be part of the database write itself.
 */

/** The promise each key's most recent caller will resolve when it is done. */
const tails = new Map();

/**
 * @template T
 * @param {string} key - What is being protected, such as `supplier:<id>`
 * @param {() => Promise<T>} work - Runs once every earlier caller for this key has finished
 * @returns {Promise<T>} What `work` returns (or rejects with); a failure does not block later callers
 */
async function withLock(key, work) {
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    // Forget the key once nobody is queued behind this caller, so the map does not grow forever
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  }
}

module.exports = { withLock };
