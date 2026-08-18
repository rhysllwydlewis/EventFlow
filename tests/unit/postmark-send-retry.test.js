'use strict';

/**
 * utils/postmark.js's sendMail() previously called postmarkClient.sendEmail()
 * once with no retry — a transient 5xx/429/network failure on a direct send
 * (outside the BullMQ email queue, which already retries 5x) failed
 * permanently on the first attempt. sendEmailWithRetry() now retries
 * transient failures with exponential backoff while still failing fast on
 * Postmark's own 4xx errors (bad API key, invalid recipient) that would
 * fail identically on every retry.
 */
describe('utils/postmark sendMail retry behaviour', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      POSTMARK_API_KEY: 'test-key',
      POSTMARK_FROM: 'noreply@event-flow.co.uk',
    };
    jest.doMock('../../services/emailLog.service', () => ({
      createAttempt: jest.fn(async () => ({ id: 'log_1' })),
      updateStatus: jest.fn(async () => true),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  function mockPostmarkClient(sendEmail) {
    jest.doMock('postmark', () => ({
      ServerClient: jest.fn().mockImplementation(() => ({ sendEmail })),
    }));
  }

  async function runSendAndAdvanceTimers(sendPromiseFactory) {
    const promise = sendPromiseFactory();
    // Flush the microtask queue and any pending backoff timers repeatedly,
    // since each retry attempt schedules its own setTimeout after awaiting.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }
    return promise;
  }

  test('retries a transient 503 error and succeeds on the second attempt', async () => {
    class ServiceUnavailablerError extends Error {
      constructor(message) {
        super(message);
        this.statusCode = 503;
      }
    }
    const sendEmail = jest
      .fn()
      .mockRejectedValueOnce(new ServiceUnavailablerError('temporarily unavailable'))
      .mockResolvedValueOnce({ MessageID: 'msg-1' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    const result = await runSendAndAdvanceTimers(() =>
      postmark.sendMail({ to: 'user@example.com', subject: 'Hi', text: 'body' })
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(result.PostmarkMessageID).toBe('msg-1');
  });

  test('retries a network-level error with no statusCode property at all', async () => {
    const networkError = new Error('ECONNRESET');
    const sendEmail = jest
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ MessageID: 'msg-2' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    const result = await runSendAndAdvanceTimers(() =>
      postmark.sendMail({ to: 'user@example.com', subject: 'Hi', text: 'body' })
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(result.PostmarkMessageID).toBe('msg-2');
  });

  test('retries a real network-level error, shaped like the postmark client actually throws it', async () => {
    // The postmark package's ErrorHandler.buildError() wraps every failure
    // that never reached Postmark's servers (timeout, ECONNRESET, DNS
    // failure) in a PostmarkError whose constructor defaults statusCode to
    // 0 — a number, not undefined/missing. A prior version of
    // isRetryablePostmarkError only checked `typeof statusCode !== 'number'`,
    // which this shape does not satisfy, so real network errors were never
    // retried despite the retry logic being built specifically for them.
    class PostmarkError extends Error {
      constructor(message) {
        super(message);
        this.statusCode = 0;
        this.code = 0;
      }
    }
    const networkError = new PostmarkError('connect ECONNREFUSED');
    const sendEmail = jest
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ MessageID: 'msg-3' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    const result = await runSendAndAdvanceTimers(() =>
      postmark.sendMail({ to: 'user@example.com', subject: 'Hi', text: 'body' })
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(result.PostmarkMessageID).toBe('msg-3');
  });

  test('does not retry a 422 invalid-recipient error — fails on the first attempt', async () => {
    class ApiInputError extends Error {
      constructor(message) {
        super(message);
        this.statusCode = 422;
        this.code = 300;
      }
    }
    const sendEmail = jest.fn().mockRejectedValue(new ApiInputError('Invalid email request'));
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await expect(
      runSendAndAdvanceTimers(() =>
        postmark.sendMail({ to: 'not-an-email', subject: 'Hi', text: 'body' })
      )
    ).rejects.toThrow('Invalid email request');

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('gives up after 3 attempts against a persistent 500 error', async () => {
    class InternalServerError extends Error {
      constructor(message) {
        super(message);
        this.statusCode = 500;
      }
    }
    const sendEmail = jest.fn().mockRejectedValue(new InternalServerError('server error'));
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await expect(
      runSendAndAdvanceTimers(() =>
        postmark.sendMail({ to: 'user@example.com', subject: 'Hi', text: 'body' })
      )
    ).rejects.toThrow();

    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  test('retryOnFailure: false makes a single attempt and fails immediately on a transient error', async () => {
    // The BullMQ email queue worker sets this — it already retries the whole
    // job 5x with its own backoff, so it must not also get sendMail's
    // in-process retry stacked on top.
    class ServiceUnavailablerError extends Error {
      constructor(message) {
        super(message);
        this.statusCode = 503;
      }
    }
    const sendEmail = jest.fn().mockRejectedValue(new ServiceUnavailablerError('unavailable'));
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await expect(
      runSendAndAdvanceTimers(() =>
        postmark.sendMail({
          to: 'user@example.com',
          subject: 'Hi',
          text: 'body',
          retryOnFailure: false,
        })
      )
    ).rejects.toThrow();

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
