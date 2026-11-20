/**
 * Work for one key runs one at a time and in the order it arrived; different keys do not wait for
 * each other; and a failure never blocks the callers queued behind it.
 *
 * @jest-environment node
 */
'use strict';

const { withLock } = require('../../utils/keyedLock');

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('withLock', () => {
  test('returns what the work returns', async () => {
    await expect(withLock('a', async () => 42)).resolves.toBe(42);
  });

  test('work for the same key never overlaps, and runs in arrival order', async () => {
    const events = [];
    let running = 0;
    let overlapped = false;
    const job = name => async () => {
      running += 1;
      overlapped = overlapped || running > 1;
      events.push(`start ${name}`);
      await tick();
      await tick();
      events.push(`end ${name}`);
      running -= 1;
    };

    await Promise.all([withLock('k', job('1')), withLock('k', job('2')), withLock('k', job('3'))]);

    expect(overlapped).toBe(false);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });

  test('different keys run at the same time', async () => {
    const events = [];
    const job = name => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
    };

    await Promise.all([withLock('x', job('x')), withLock('y', job('y'))]);

    expect(events).toEqual(['start x', 'start y', 'end x', 'end y']);
  });

  test('a failure is passed on to its caller and does not block the next one', async () => {
    const failing = withLock('k', async () => {
      throw new Error('boom');
    });
    const next = withLock('k', async () => 'ran');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });

  test('a key can be used again once everything queued has finished', async () => {
    await withLock('k', async () => undefined);
    await expect(withLock('k', async () => 'again')).resolves.toBe('again');
  });
});
