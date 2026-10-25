/**
 * utils/postmark.js outbox fallback and preview suppression.
 *
 * The outbox is a development fallback (never served). The files in it hold metadata only: no
 * address, subject, body, link or anything a user typed. The full email is kept (in memory, in
 * utils/devMailbox.js, never on disk) only with EVENTFLOW_OUTBOX_FULL=1 in development or when
 * NODE_ENV=test, and never in production or a PR preview. In a PR preview no real email goes out unless every recipient is allowlisted.
 *
 * @jest-environment node
 */
'use strict';

const SECRET_BODY = 'SECRET-ENQUIRY-REPLY-TEXT https://example.test/verify?token=abc123';
const SUBJECT = 'Re: your enquiry about Jane Smith wedding';

const ENV_KEYS = [
  'NODE_ENV',
  'POSTMARK_API_KEY',
  'EVENTFLOW_OUTBOX_FULL',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_ENVIRONMENT',
  'MAIL_PREVIEW_ALLOWLIST',
];
let savedEnv;
let writes;
let sendEmail;

function load(env = {}) {
  jest.resetModules();
  ENV_KEYS.forEach(key => delete process.env[key]);
  Object.assign(process.env, { NODE_ENV: 'development' }, env);

  writes = [];
  sendEmail = jest.fn().mockResolvedValue({ MessageID: 'pm-1' });
  jest.doMock('postmark', () => ({ ServerClient: jest.fn(() => ({ sendEmail })) }));
  jest.doMock('../../utils/logger', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
  jest.doMock('../../services/emailLog.service', () => ({
    createAttempt: jest.fn(async () => ({ id: 'log-1' })),
    updateStatus: jest.fn(async () => ({})),
  }));
  jest.doMock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
      ...actual,
      existsSync: jest.fn(p => (String(p).endsWith('outbox') ? true : actual.existsSync(p))),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn((file, content) => writes.push({ file: String(file), content })),
    };
  });
  return require('../../utils/postmark');
}

const mail = (extra = {}) => ({
  to: 'jane.smith@example.com',
  subject: SUBJECT,
  html: `<p>${SECRET_BODY}</p>`,
  text: SECRET_BODY,
  ...extra,
});

beforeEach(() => {
  savedEnv = {};
  ENV_KEYS.forEach(key => {
    savedEnv[key] = process.env[key];
  });
});

afterEach(() => {
  ENV_KEYS.forEach(key => {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  });
  jest.dontMock('fs');
  jest.resetModules();
});

describe('outbox fallback (no mail provider configured)', () => {
  test('writes metadata only: no body, no subject, no link, no address', async () => {
    const postmark = load();
    const result = await postmark.sendMail(mail({ template: undefined }));

    expect(result.provider).toBe('outbox');
    expect(result.status).toBe('disabled');
    expect(writes).toHaveLength(1);
    const { content } = writes[0];
    expect(content).toContain('X-EventFlow-Outbox: metadata-only');
    expect(content).toMatch(/^Recipients: 1$/m);
    expect(content).not.toMatch(/^To:/m);
    expect(content).toMatch(/^Message-Id: outbox-\d+$/m);
    expect(content).toMatch(/^Date: \d{4}-\d\d-\d\dT/m);
    expect(content).toMatch(/^Template: none/m);
    expect(content).not.toContain('SECRET-ENQUIRY-REPLY-TEXT');
    expect(content).not.toContain('token=abc123');
    expect(content).not.toContain('Jane Smith');
    expect(content).not.toContain('jane.smith');
    expect(content).not.toMatch(/^Subject:/m);
  });

  test('records the template name, never its rendered content', async () => {
    const postmark = load();
    await postmark.sendMail({
      to: 'jane@example.com',
      subject: SUBJECT,
      template: 'verification',
      templateData: {
        name: 'Jane Smith',
        verificationLink: 'https://example.test/verify?token=zzz',
      },
    });
    expect(writes[0].content).toMatch(/^Template: verification$/m);
    expect(writes[0].content).not.toContain('token=zzz');
    expect(writes[0].content).not.toContain('Jane Smith');
  });

  test('counts the recipients of a multi-recipient send without naming them', async () => {
    const postmark = load();
    await postmark.sendMail(mail({ to: ['alice@a.test', 'Bob <bob@b.test>'] }));
    expect(writes[0].content).toMatch(/^Recipients: 2$/m);
    expect(writes[0].content).not.toContain('alice');
    expect(writes[0].content).not.toContain('bob');
  });

  test('a header-injection attempt in the template name cannot add lines', async () => {
    const postmark = load();
    await postmark.sendMail(mail({ template: 'x\nBcc: evil@example.com' }));
    expect(writes[0].content).not.toMatch(/^Bcc:/m);
    expect(writes[0].content).not.toContain('evil@example.com');
    expect(writes[0].content).toMatch(/^Template: none/m);
  });

  test('EVENTFLOW_OUTBOX_FULL=1 in development keeps the full email in memory, not on disk', async () => {
    const postmark = load({ EVENTFLOW_OUTBOX_FULL: '1' });
    await postmark.sendMail(mail());
    const kept = require('../../utils/devMailbox').findNewestTo('jane.smith@example.com');
    expect(kept.subject).toBe(SUBJECT);
    expect(kept.text).toContain(SECRET_BODY);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain('metadata-only');
    expect(writes[0].content).not.toContain('SECRET-ENQUIRY-REPLY-TEXT');
    expect(writes[0].content).not.toContain('jane.smith');
  });

  test('NODE_ENV=test keeps the full email in memory (the browser tests read the link from it)', async () => {
    const postmark = load({ NODE_ENV: 'test' });
    await postmark.sendMail(mail());
    const kept = require('../../utils/devMailbox').findNewestTo('Jane.Smith@example.com');
    expect(kept.subject).toMatch(/^Re: your enquiry/);
    expect(kept.html).toContain('token=abc123');
    expect(writes[0].file).toMatch(/email-\d+\.eml$/);
    expect(writes[0].content).not.toContain('token=abc123');
  });

  test('nothing is kept in memory by default, in production or in a PR preview', async () => {
    for (const env of [
      {},
      { NODE_ENV: 'production', EVENTFLOW_OUTBOX_FULL: '1' },
      {
        NODE_ENV: 'development',
        EVENTFLOW_OUTBOX_FULL: '1',
        RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-77',
      },
      { NODE_ENV: 'test', EVENTFLOW_OUTBOX_FULL: '1', RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-77' },
    ]) {
      const postmark = load(env);
      await postmark.sendMail(mail());
      expect(require('../../utils/devMailbox').findNewestTo('jane.smith@example.com')).toBeNull();
      expect(writes[0].content).toContain('metadata-only');
      expect(writes[0].content).not.toContain('SECRET-ENQUIRY-REPLY-TEXT');
    }
  });

  test('a critical email still fails loudly in production when nothing is configured', async () => {
    const postmark = load({ NODE_ENV: 'production' });
    await expect(postmark.sendMail(mail({ criticalDelivery: true }))).rejects.toThrow(
      'Critical email delivery failed: Postmark is not configured in production'
    );
    expect(writes).toHaveLength(0);
  });

  test('when a real send fails, the fallback copy is metadata only too', async () => {
    const postmark = load({ POSTMARK_API_KEY: 'key', NODE_ENV: 'development' });
    sendEmail.mockRejectedValue(Object.assign(new Error('bad request'), { statusCode: 422 }));
    await expect(postmark.sendMail(mail({ template: undefined }))).rejects.toThrow(
      'Failed to send email via Postmark'
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain('metadata-only');
    expect(writes[0].content).not.toContain('SECRET-ENQUIRY-REPLY-TEXT');
  });
});

describe('PR preview mail suppression', () => {
  const PREVIEW = { NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-1839' };

  test('never sends real email, even with Postmark configured, and writes metadata only', async () => {
    const postmark = load({ ...PREVIEW, POSTMARK_API_KEY: 'live-key' });
    expect(postmark.isPostmarkEnabled()).toBe(true);
    const result = await postmark.sendMail(mail());

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.provider).toBe('outbox');
    expect(result.previewSuppressed).toBe(true);
    expect(result.message).toMatch(/preview environment/);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toContain('metadata-only');
    expect(writes[0].content).not.toContain('SECRET-ENQUIRY-REPLY-TEXT');
  });

  test('a critical email does not throw in a preview: it is suppressed, not failed', async () => {
    const postmark = load({ ...PREVIEW, POSTMARK_API_KEY: 'live-key' });
    const result = await postmark.sendMail(mail({ criticalDelivery: true }));
    expect(result.previewSuppressed).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('an allowlisted recipient is really sent', async () => {
    const postmark = load({
      ...PREVIEW,
      POSTMARK_API_KEY: 'sandbox-key',
      MAIL_PREVIEW_ALLOWLIST: 'jane.smith@example.com',
    });
    const result = await postmark.sendMail(mail());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('postmark');
    expect(result.previewSuppressed).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  test('an allowlisted domain is really sent, a stranger is not', async () => {
    const postmark = load({
      ...PREVIEW,
      POSTMARK_API_KEY: 'sandbox-key',
      MAIL_PREVIEW_ALLOWLIST: '@example.com',
    });
    await postmark.sendMail(mail({ to: 'x@example.com' }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const stranger = await postmark.sendMail(mail({ to: 'x@other.test' }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(stranger.previewSuppressed).toBe(true);
  });

  test('one stranger among the recipients suppresses the whole send', async () => {
    const postmark = load({
      ...PREVIEW,
      POSTMARK_API_KEY: 'sandbox-key',
      MAIL_PREVIEW_ALLOWLIST: 'a@example.com',
    });
    const result = await postmark.sendMail(mail({ to: ['a@example.com', 'b@other.test'] }));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.previewSuppressed).toBe(true);
  });

  test.each([
    ['production name', { RAILWAY_ENVIRONMENT_NAME: 'production' }],
    ['odd preview-like name', { RAILWAY_ENVIRONMENT_NAME: 'EventFlow-pr-12x' }],
    ['no Railway variables', {}],
  ])('production behaviour is untouched for %s', async (_label, railway) => {
    const postmark = load({
      NODE_ENV: 'production',
      POSTMARK_API_KEY: 'live-key',
      ...railway,
      MAIL_PREVIEW_ALLOWLIST: 'nobody@nowhere.test',
    });
    const result = await postmark.sendMail(mail());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('postmark');
    expect(result.previewSuppressed).toBeUndefined();
    expect(writes).toHaveLength(0);
  });
});
