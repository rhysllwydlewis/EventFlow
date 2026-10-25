/**
 * utils/previewSafety.js: the guard that keeps Railway PR previews off live Stripe keys and real
 * email, and decides when the local outbox may keep a full email body.
 *
 * @jest-environment node
 */
'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const guard = require('../../utils/previewSafety');

const preview = (extra = {}) => ({ RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-1839', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  guard._resetForTests();
});

describe('isPreviewEnvironment: exact matching rule /^EventFlow-pr-\\d+$/i', () => {
  test.each([
    ['EventFlow-pr-1839'],
    ['EventFlow-pr-1'],
    ['EventFlow-pr-0'],
    ['eventflow-pr-5'],
    ['EVENTFLOW-PR-5'],
    ['EventFlow-PR-100000'],
  ])('%s is a preview', name => {
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(true);
  });

  test.each([
    ['production'],
    ['Production'],
    ['staging'],
    ['EventFlow'],
    ['EventFlow-production'],
    ['EventFlow-pr-'],
    ['EventFlow-pr-12x'],
    ['EventFlow-pr-x12'],
    ['EventFlow-pr-12-staging'],
    ['EventFlow-pr--5'],
    ['EventFlow-pr-1.5'],
    ['EventFlow-pr-5 '],
    [' EventFlow-pr-5'],
    ['EventFlow-pr-5\n'],
    ['EventFlow-pr-5\nproduction'],
    ['my-EventFlow-pr-5'],
    ['EventFlow-pr-٥'],
    ['pr-1839'],
    [''],
  ])('%j is NOT a preview', name => {
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(false);
  });

  test('undefined / missing variables are not a preview', () => {
    expect(guard.isPreviewEnvironment({})).toBe(false);
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT_NAME: undefined })).toBe(false);
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT_NAME: null })).toBe(false);
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT_NAME: 1839 })).toBe(false);
  });

  test('NODE_ENV, branch name and public domain never make something a preview', () => {
    expect(
      guard.isPreviewEnvironment({
        NODE_ENV: 'production',
        RAILWAY_GIT_BRANCH: 'EventFlow-pr-5',
        RAILWAY_PUBLIC_DOMAIN: 'eventflow-pr-5.up.railway.app',
      })
    ).toBe(false);
  });

  test('RAILWAY_ENVIRONMENT is only a fallback when the NAME variable is absent', () => {
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT: 'EventFlow-pr-7' })).toBe(true);
    // A production NAME wins over a preview-looking RAILWAY_ENVIRONMENT
    expect(
      guard.isPreviewEnvironment({
        RAILWAY_ENVIRONMENT_NAME: 'production',
        RAILWAY_ENVIRONMENT: 'EventFlow-pr-7',
      })
    ).toBe(false);
    expect(
      guard.isPreviewEnvironment({
        RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-7',
        RAILWAY_ENVIRONMENT: 'production',
      })
    ).toBe(true);
    expect(guard.isPreviewEnvironment({ RAILWAY_ENVIRONMENT: 'production' })).toBe(false);
  });

  test('defaults to process.env', () => {
    const saved = process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.RAILWAY_ENVIRONMENT_NAME = 'EventFlow-pr-9';
    try {
      expect(guard.isPreviewEnvironment()).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
      } else {
        process.env.RAILWAY_ENVIRONMENT_NAME = saved;
      }
    }
  });
});

describe('Stripe keys', () => {
  test('a live key is refused in a preview (and logged once)', () => {
    const env = preview({ STRIPE_SECRET_KEY: 'sk_live_abc' });
    expect(guard.getSafeStripeSecretKey(env)).toBe('');
    expect(guard.getSafeStripeSecretKey(env)).toBe('');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/LIVE Stripe key/);
    expect(logger.warn.mock.calls[0][0]).not.toContain('sk_live_abc');
  });

  test('restricted live keys are refused too', () => {
    expect(guard.getSafeStripeSecretKey(preview({ STRIPE_SECRET_KEY: 'rk_live_abc' }))).toBe('');
  });

  test('a test key is allowed in a preview', () => {
    expect(guard.getSafeStripeSecretKey(preview({ STRIPE_SECRET_KEY: 'sk_test_abc' }))).toBe(
      'sk_test_abc'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('no key stays no key', () => {
    expect(guard.getSafeStripeSecretKey(preview())).toBeUndefined();
  });

  test.each([['production'], ['EventFlow-pr-12x'], [undefined], ['staging']])(
    'a live key passes through untouched when the environment is %s',
    name => {
      const env = { STRIPE_SECRET_KEY: 'sk_live_abc' };
      if (name !== undefined) {
        env.RAILWAY_ENVIRONMENT_NAME = name;
      }
      expect(guard.getSafeStripeSecretKey(env)).toBe('sk_live_abc');
      expect(guard.isBillingBlockedByPreview(env)).toBe(false);
      expect(guard.billingUnavailableBody({ error: 'usual' }, env)).toEqual({ error: 'usual' });
      expect(logger.warn).not.toHaveBeenCalled();
    }
  );

  test('billing alias key: falls back to STRIPE_SECRET_KEY_LIVE, which is also refused in a preview', () => {
    expect(guard.getSafeBillingStripeKey({ STRIPE_SECRET_KEY_LIVE: 'sk_live_x' })).toBe(
      'sk_live_x'
    );
    expect(guard.getSafeBillingStripeKey(preview({ STRIPE_SECRET_KEY_LIVE: 'sk_live_x' }))).toBe(
      ''
    );
    expect(guard.getSafeBillingStripeKey(preview({ STRIPE_SECRET_KEY: 'sk_test_x' }))).toBe(
      'sk_test_x'
    );
    expect(guard.getSafeBillingStripeKey({})).toBe('');
  });

  test('billing endpoints get a clear message only when a preview blocked a live key', () => {
    const body = guard.billingUnavailableBody(
      { error: 'usual' },
      preview({ STRIPE_SECRET_KEY: 'sk_live_abc' })
    );
    expect(body.error).toBe('Billing is disabled in preview environments');
    expect(body.message).toMatch(/sk_test_/);
    expect(body.previewDisabled).toBe(true);
    // A preview with no key at all keeps the usual "not configured" answer
    expect(guard.billingUnavailableBody({ error: 'usual' }, preview())).toEqual({
      error: 'usual',
    });
  });
});

describe('mail policy', () => {
  test('outside a preview nothing is ever suppressed', () => {
    expect(guard.evaluateMailPolicy('a@b.com', {})).toEqual({ suppress: false, reason: null });
    expect(guard.evaluateMailPolicy('a@b.com', { RAILWAY_ENVIRONMENT_NAME: 'production' })).toEqual(
      { suppress: false, reason: null }
    );
    expect(
      guard.evaluateMailPolicy('a@b.com', { RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-12x' }).suppress
    ).toBe(false);
    // Even an empty or malformed recipient is the caller's problem, not this guard's
    expect(guard.evaluateMailPolicy(undefined, {}).suppress).toBe(false);
  });

  test('a preview with no allowlist suppresses everything', () => {
    const result = guard.evaluateMailPolicy('a@b.com', preview());
    expect(result.suppress).toBe(true);
    expect(result.reason).toMatch(/MAIL_PREVIEW_ALLOWLIST/);
  });

  test('an allowlist made only of junk suppresses everything', () => {
    expect(
      guard.evaluateMailPolicy('a@b.com', preview({ MAIL_PREVIEW_ALLOWLIST: ' , ;, *, *@b.com ' }))
        .suppress
    ).toBe(true);
  });

  test('exact addresses and domains are allowed, case-insensitively', () => {
    const env = preview({
      MAIL_PREVIEW_ALLOWLIST: 'Reviewer@Example.com, @sandbox.test  qa.example.org;',
    });
    expect(guard.evaluateMailPolicy('reviewer@example.com', env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy('REVIEWER@EXAMPLE.COM', env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy('anyone@sandbox.test', env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy('anyone@qa.example.org', env).suppress).toBe(false);
  });

  test('other addresses, lookalikes and subdomains are suppressed', () => {
    const env = preview({ MAIL_PREVIEW_ALLOWLIST: 'reviewer@example.com,sandbox.test' });
    expect(guard.evaluateMailPolicy('other@example.com', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('xreviewer@example.com', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('a@sub.sandbox.test', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('a@sandbox.test.evil.com', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('a@evilsandbox.test', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('sandbox.test', env).suppress).toBe(true);
  });

  test('every recipient must be allowed: one stranger suppresses the whole send', () => {
    const env = preview({ MAIL_PREVIEW_ALLOWLIST: 'a@x.com,b@x.com' });
    expect(guard.evaluateMailPolicy('a@x.com,b@x.com', env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy(['a@x.com', 'b@x.com'], env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy('a@x.com,c@x.com', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy(['a@x.com', 'c@x.com'], env).suppress).toBe(true);
  });

  test('"Name <address>" recipients are understood', () => {
    const env = preview({ MAIL_PREVIEW_ALLOWLIST: 'a@x.com' });
    expect(guard.evaluateMailPolicy('Alex <a@x.com>', env).suppress).toBe(false);
    expect(guard.evaluateMailPolicy('a@x.com <evil@y.com>', env).suppress).toBe(true);
  });

  test('missing or empty recipients are suppressed in a preview', () => {
    const env = preview({ MAIL_PREVIEW_ALLOWLIST: 'x.com' });
    expect(guard.evaluateMailPolicy(undefined, env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy('', env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy([], env).suppress).toBe(true);
    expect(guard.evaluateMailPolicy({ not: 'a string' }, env).suppress).toBe(true);
  });

  test('the allowlist does nothing outside a preview', () => {
    expect(
      guard.evaluateMailPolicy('a@b.com', {
        RAILWAY_ENVIRONMENT_NAME: 'production',
        MAIL_PREVIEW_ALLOWLIST: 'nobody@nowhere.test',
      }).suppress
    ).toBe(false);
  });

  test('parseMailAllowlist splits entries into addresses and domains', () => {
    const parsed = guard.parseMailAllowlist('A@b.com, @c.com d.com *.e.com f*@g.com @');
    expect([...parsed.addresses]).toEqual(['a@b.com']);
    expect([...parsed.domains].sort()).toEqual(['c.com', 'd.com']);
    expect(guard.parseMailAllowlist(undefined).addresses.size).toBe(0);
  });
});

describe('isFullOutboxAllowed', () => {
  test('is off by default in development', () => {
    expect(guard.isFullOutboxAllowed({})).toBe(false);
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'development', EVENTFLOW_OUTBOX_FULL: '0' })).toBe(
      false
    );
    expect(
      guard.isFullOutboxAllowed({ NODE_ENV: 'development', EVENTFLOW_OUTBOX_FULL: 'yes' })
    ).toBe(false);
  });

  test('the explicit switch turns it on in development', () => {
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'development', EVENTFLOW_OUTBOX_FULL: '1' })).toBe(
      true
    );
    expect(guard.isFullOutboxAllowed({ EVENTFLOW_OUTBOX_FULL: 'true' })).toBe(true);
    expect(guard.isFullOutboxAllowed({ EVENTFLOW_OUTBOX_FULL: ' TRUE ' })).toBe(true);
  });

  test('NODE_ENV=test allows it without the switch (browser tests read the link)', () => {
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'test' })).toBe(true);
  });

  test('never in production, whatever the switch says', () => {
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'production', EVENTFLOW_OUTBOX_FULL: '1' })).toBe(
      false
    );
    expect(guard.isFullOutboxAllowed({ NODE_ENV: 'production' })).toBe(false);
  });

  test('never in a PR preview, whatever NODE_ENV or the switch says', () => {
    expect(guard.isFullOutboxAllowed(preview({ EVENTFLOW_OUTBOX_FULL: '1' }))).toBe(false);
    expect(guard.isFullOutboxAllowed(preview({ NODE_ENV: 'test' }))).toBe(false);
    expect(
      guard.isFullOutboxAllowed(preview({ NODE_ENV: 'development', EVENTFLOW_OUTBOX_FULL: '1' }))
    ).toBe(false);
  });
});

describe('logPreviewSafetyOnce', () => {
  test('is silent outside a preview', () => {
    expect(guard.logPreviewSafetyOnce({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBeNull();
    expect(guard.logPreviewSafetyOnce({})).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('reports once in a preview', () => {
    const env = preview({ STRIPE_SECRET_KEY: 'sk_live_abc', MAIL_PREVIEW_ALLOWLIST: 'a@b.com' });
    const report = guard.logPreviewSafetyOnce(env);
    expect(report).toEqual({
      environment: 'EventFlow-pr-1839',
      stripe: 'disabled (live key refused)',
      mail: 'allowlist of 1 entries',
    });
    expect(guard.logPreviewSafetyOnce(env)).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain('sk_live_abc');
    expect(logger.warn.mock.calls[0][0]).not.toContain('a@b.com');
  });

  test('describes test keys and the default mail state', () => {
    const report = guard.logPreviewSafetyOnce(preview({ STRIPE_SECRET_KEY: 'sk_test_abc' }));
    expect(report.stripe).toBe('enabled (non-live key)');
    expect(report.mail).toBe('suppressed (metadata only)');
  });
});
