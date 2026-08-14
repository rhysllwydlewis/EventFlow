/**
 * Regression test for routes/messenger-v4.js initialize().
 *
 * getDbInstance() is invoked from initialize() without being awaited, so a
 * rejection (e.g. the database being briefly unreachable at startup) must be
 * caught locally. An uncaught rejection here previously crashed the whole
 * Node process instead of just failing queue-context setup.
 */

'use strict';

jest.mock('../../services/queue', () => ({
  setQueueContext: jest.fn(),
}));

const { setQueueContext } = require('../../services/queue');
const messengerV4 = require('../../routes/messenger-v4');

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

describe('messenger-v4 initialize() database failure handling', () => {
  it('logs and does not throw when the database rejects during startup', async () => {
    const connectionError = new Error('connect ECONNREFUSED 127.0.0.1:27017');
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    expect(() => {
      messengerV4.initialize({
        authRequired: (_req, _res, next) => next(),
        csrfProtection: (_req, _res, next) => next(),
        db: { getDb: jest.fn().mockRejectedValue(connectionError) },
        logger,
      });
    }).not.toThrow();

    await flushMicrotasks();
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to initialize messenger queue context',
      connectionError
    );
    expect(setQueueContext).not.toHaveBeenCalled();
  });
});
