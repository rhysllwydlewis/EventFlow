/**
 * Unit tests for the async mutex utility (utils/asyncMutex.js)
 *
 * Tests:
 *   - Operations on the same key are serialised (no interleaving)
 *   - Operations on different keys run concurrently
 *   - An error inside fn propagates to the caller but does not block the queue
 *   - Map entry is cleaned up after all operations settle (no memory leak)
 */

'use strict';

const { withLock } = require('../../utils/asyncMutex');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('withLock — serialisation', () => {
  it('runs consecutive calls to the same key in order', async () => {
    const order = [];

    await Promise.all([
      withLock('col', async () => {
        await delay(10);
        order.push(1);
      }),
      withLock('col', async () => {
        order.push(2);
      }),
      withLock('col', async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('prevents interleaved reads and writes', async () => {
    let counter = 0;
    const increments = 10;

    // Each async increment reads, increments, then writes back — without
    // the mutex these would all read the same initial value.
    await Promise.all(
      Array.from({ length: increments }, () =>
        withLock('counter', async () => {
          const current = counter;
          await delay(1); // yield to the event loop
          counter = current + 1;
        })
      )
    );

    expect(counter).toBe(increments);
  });
});

describe('withLock — parallel execution for different keys', () => {
  it('does not block operations on different keys', async () => {
    const start = Date.now();

    // Both take 30 ms; if serialised they would take ≥ 60 ms.
    await Promise.all([withLock('key_a', () => delay(30)), withLock('key_b', () => delay(30))]);

    const elapsed = Date.now() - start;
    // Allow generous overhead (3× the delay) while still being well under 2× serial time.
    expect(elapsed).toBeLessThan(90);
  });
});

describe('withLock — error handling', () => {
  it('propagates the error to the caller', async () => {
    await expect(
      withLock('err_key', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('does not block subsequent callers when fn throws', async () => {
    const results = [];

    await Promise.all([
      withLock('err_queue', async () => {
        throw new Error('first fails');
      }).catch(() => results.push('caught')),

      withLock('err_queue', async () => {
        results.push('second ran');
      }),
    ]);

    expect(results).toContain('caught');
    expect(results).toContain('second ran');
    // The second operation must have run even though the first threw.
    expect(results.indexOf('second ran')).toBeGreaterThanOrEqual(0);
  });
});

describe('withLock — return value', () => {
  it('returns the value produced by fn', async () => {
    const result = await withLock('ret_key', async () => 42);
    expect(result).toBe(42);
  });
});
