'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CONFIG_PATH = '../../config/messagingLimits';
const MESSAGING_ENV_KEYS = ['MESSAGING_FREE_THREADS_PER_DAY', 'MESSAGING_DISABLE_THREAD_LIMITS'];

function withMessagingEnv(env = {}, assertion) {
  const originalValues = {};
  MESSAGING_ENV_KEYS.forEach(key => {
    originalValues[key] = process.env[key];
    delete process.env[key];
  });
  Object.assign(process.env, env);
  delete require.cache[require.resolve(CONFIG_PATH)];

  try {
    const { getMessagingLimitsForTier } = require(CONFIG_PATH);
    assertion(getMessagingLimitsForTier);
  } finally {
    MESSAGING_ENV_KEYS.forEach(key => {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    });
    delete require.cache[require.resolve(CONFIG_PATH)];
  }
}

describe('messagingLimits config', () => {
  test('free tier has a beta-safe new conversation limit instead of the old 3-thread cap', () => {
    withMessagingEnv({}, getMessagingLimitsForTier => {
      expect(getMessagingLimitsForTier('free').threadsPerDay).toBe(30);
    });
  });

  test('MESSAGING_FREE_THREADS_PER_DAY overrides free-tier thread starts', () => {
    withMessagingEnv({ MESSAGING_FREE_THREADS_PER_DAY: '75' }, getMessagingLimitsForTier => {
      expect(getMessagingLimitsForTier('free').threadsPerDay).toBe(75);
    });
  });

  test('MESSAGING_DISABLE_THREAD_LIMITS disables thread caps across tiers', () => {
    withMessagingEnv({ MESSAGING_DISABLE_THREAD_LIMITS: 'true' }, getMessagingLimitsForTier => {
      expect(getMessagingLimitsForTier('free').threadsPerDay).toBe(-1);
      expect(getMessagingLimitsForTier('pro').threadsPerDay).toBe(-1);
    });
  });

  test('pro and pro_plus remain unlimited by default', () => {
    withMessagingEnv({}, getMessagingLimitsForTier => {
      expect(getMessagingLimitsForTier('pro').threadsPerDay).toBe(-1);
      expect(getMessagingLimitsForTier('pro_plus').threadsPerDay).toBe(-1);
    });
  });
});

describe('ContactPickerV4 rate-limit copy', () => {
  let ContactPickerV4;

  beforeAll(() => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../public/messenger/js/ContactPickerV4.js'),
      'utf8'
    );
    const sandbox = {
      window: {},
      console,
    };
    vm.runInNewContext(src, sandbox);
    ContactPickerV4 = sandbox.window.ContactPickerV4;
  });

  test('preserves the backend THREAD_LIMIT_EXCEEDED message so the reset time is visible', () => {
    const inst = Object.create(ContactPickerV4.prototype);
    const err = new Error("You've reached today's limit of 30 new conversations. Limits reset at midnight UTC.");
    err.status = 429;
    err.code = 'THREAD_LIMIT_EXCEEDED';
    err.safeMessage = err.message;

    expect(inst._friendlyError(err)).toBe(
      "You've reached today's limit of 30 new conversations. Limits reset at midnight UTC."
    );
  });

  test('keeps the generic friendly copy for non-thread rate limits without useful API copy', () => {
    const inst = Object.create(ContactPickerV4.prototype);
    expect(inst._friendlyError({ status: 429, message: 'Rate limit exceeded' })).toBe(
      'You have reached a messaging limit. Please wait a moment and try again.'
    );
  });
});
