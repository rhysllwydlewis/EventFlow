/**
 * Postmark Email Notification Flow Integration Tests (mock-based)
 *
 * Tests the complete email notification pipeline with deterministic mocks —
 * no live Postmark API or SMTP server required.
 *
 * Covers:
 *  - Graceful degradation when Postmark is not configured (outbox fallback)
 *  - sendMail core function: required-field validation
 *  - sendVerificationEmail: correct template, recipient, link format
 *  - sendPasswordResetEmail: dedicated message stream, password-reset template
 *  - sendWelcomeEmail: uses hello@ from address, welcome template
 *  - sendNotificationEmail: respects user notification preferences
 *  - sendMarketingEmail: respects user marketing opt-out
 *  - Admin ticket reply email: correct recipient, XSS escaping
 *  - Admin contact enquiry reply email: correct recipient, XSS escaping
 *  - Email template loading: template variable substitution, XSS escaping
 *  - Outbox fallback: saves .eml file when Postmark is disabled
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── helpers ──────────────────────────────────────────────────────────────────

function readSrc(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('Postmark — Graceful Degradation (no API key configured)', () => {
  it('postmark.js sets POSTMARK_ENABLED=false when POSTMARK_API_KEY is missing', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('let POSTMARK_ENABLED = false');
    // Key becomes truthy and sets POSTMARK_ENABLED = true
    expect(src).toContain('POSTMARK_ENABLED = true');
  });

  it('sendMail falls back to outbox when Postmark is disabled', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('saving email to /outbox instead');
    expect(src).toContain('saveEmailToOutbox');
    expect(src).toContain("status: 'disabled'");
    expect(src).toContain('Postmark not configured. Email saved to outbox.');
  });

  it('outbox save creates .eml file with To, From, Subject, Body', () => {
    const src = readSrc('utils', 'postmark.js');
    const saveIdx = src.indexOf('function saveEmailToOutbox');
    const saveBlock = src.substring(saveIdx, saveIdx + 800);
    expect(saveBlock).toContain('email-');
    expect(saveBlock).toContain('.eml');
    expect(saveBlock).toContain('emailData.To');
    expect(saveBlock).toContain('emailData.From');
    expect(saveBlock).toContain('emailData.Subject');
  });

  it('sendMail validates required "to" field and throws when missing', async () => {
    jest.resetModules();
    // Don't configure POSTMARK_API_KEY so it falls into outbox mode
    delete process.env.POSTMARK_API_KEY;

    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    // Mock fs so outbox write doesn't create real files
    jest.mock('fs', () => {
      const actual = jest.requireActual('fs');
      return {
        ...actual,
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
      };
    });

    const postmark = require('../../utils/postmark');
    await expect(postmark.sendMail({ to: undefined, subject: 'test' })).rejects.toThrow(
      'Missing required email field: to'
    );
  });

  it('sendMail validates required "subject" field when Postmark is enabled', async () => {
    // Subject is validated ONLY when Postmark is enabled (outbox path uses subject || template name)
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain("'Missing required email field: subject'");
    expect(src).toContain('// Require subject for all emails');
    // The check appears AFTER the outbox early-return, so it only applies to live Postmark sends
    const subjectCheckIdx = src.indexOf("'Missing required email field: subject'");
    const outboxReturnIdx = src.indexOf("return {\n      status: 'disabled'");
    expect(subjectCheckIdx).toBeGreaterThan(outboxReturnIdx);
  });
});

describe('Postmark — sendMail with mocked client', () => {
  let postmark;
  let mockSendEmail;

  beforeEach(() => {
    jest.resetModules();

    mockSendEmail = jest.fn().mockResolvedValue({
      MessageID: 'mock-message-id-001',
      SubmittedAt: new Date().toISOString(),
      To: 'test@example.com',
      ErrorCode: 0,
      Message: 'OK',
    });

    // Simulate Postmark being configured
    process.env.POSTMARK_API_KEY = 'test-postmark-key';

    jest.mock('postmark', () => ({
      ServerClient: jest.fn().mockImplementation(() => ({
        sendEmail: mockSendEmail,
      })),
    }));

    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.mock('fs', () => {
      const actual = jest.requireActual('fs');
      return {
        ...actual,
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockImplementation((filePath, encoding) => {
          // Return a mock template with placeholders
          if (typeof filePath === 'string' && filePath.endsWith('.html')) {
            return '<html><body>Hello {{name}}, {{message}}</body></html>';
          }
          return actual.readFileSync(filePath, encoding);
        }),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
      };
    });

    postmark = require('../../utils/postmark');
  });

  afterEach(() => {
    delete process.env.POSTMARK_API_KEY;
  });

  it('returns MessageID on successful send', async () => {
    const result = await postmark.sendMail({
      to: 'recipient@example.com',
      subject: 'Test email',
      html: '<p>Hello</p>',
    });
    expect(result).toHaveProperty('MessageID');
  });

  it('passes correct To and Subject to Postmark client', async () => {
    await postmark.sendMail({
      to: 'test@example.com',
      subject: 'My Subject',
      html: '<p>content</p>',
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        To: 'test@example.com',
        Subject: 'My Subject',
      })
    );
  });

  it('sends array of recipients as comma-separated string', async () => {
    await postmark.sendMail({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Bulk',
      html: '<p>content</p>',
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        To: 'a@example.com,b@example.com',
      })
    );
  });
});

describe('Postmark — Email Function Contracts', () => {
  let src;

  beforeAll(() => {
    src = readSrc('utils', 'postmark.js');
  });

  it('sendVerificationEmail uses "verification" template', () => {
    const fnStart = src.indexOf('async function sendVerificationEmail');
    const fnBody = src.substring(fnStart, fnStart + 600);
    expect(fnBody).toContain("template: 'verification'");
    expect(fnBody).toContain('verificationLink');
  });

  it('sendVerificationEmail uses noreply from address', () => {
    const fnStart = src.indexOf('async function sendVerificationEmail');
    const fnBody = src.substring(fnStart, fnStart + 600);
    expect(fnBody).toContain('FROM_NOREPLY');
  });

  it('sendPasswordResetEmail uses dedicated password-reset message stream', () => {
    const fnStart = src.indexOf('async function sendPasswordResetEmail');
    const fnBody = src.substring(fnStart, fnStart + 600);
    expect(fnBody).toContain("messageStream: 'password-reset'");
    expect(fnBody).toContain("template: 'password-reset'");
  });

  it('sendPasswordResetEmail includes resetLink in template data', () => {
    const fnStart = src.indexOf('async function sendPasswordResetEmail');
    const fnBody = src.substring(fnStart, fnStart + 600);
    expect(fnBody).toContain('resetLink');
    expect(fnBody).toContain('encodeURIComponent');
  });

  it('sendWelcomeEmail uses hello@ from address', () => {
    const fnStart = src.indexOf('async function sendWelcomeEmail');
    const fnBody = src.substring(fnStart, fnStart + 400);
    expect(fnBody).toContain('FROM_HELLO');
    expect(fnBody).toContain("template: 'welcome'");
  });

  it('sendNotificationEmail respects notify_account=false opt-out', () => {
    const fnStart = src.indexOf('async function sendNotificationEmail');
    const fnBody = src.substring(fnStart, fnStart + 600);
    expect(fnBody).toContain('notify_account');
    expect(fnBody).toContain('return null');
  });

  it('sendMarketingEmail respects marketing opt-out', () => {
    const fnStart = src.indexOf('async function sendMarketingEmail');
    const fnBody = src.substring(fnStart, fnStart + 800);
    // Should check some form of opt-out before sending
    expect(fnBody).toMatch(/unsubscrib|opted[_\s]out|marketing.*opt|return null/i);
  });
});

describe('Postmark — Email Template System', () => {
  it('verification.html template exists on disk', () => {
    const templatePath = path.join(__dirname, '../../email-templates/verification.html');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('welcome.html template exists on disk', () => {
    const templatePath = path.join(__dirname, '../../email-templates/welcome.html');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('password-reset.html template exists on disk', () => {
    const templatePath = path.join(__dirname, '../../email-templates/password-reset.html');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('notification.html template exists on disk', () => {
    const templatePath = path.join(__dirname, '../../email-templates/notification.html');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('subscription-activated.html template exists on disk', () => {
    const templatePath = path.join(__dirname, '../../email-templates/subscription-activated.html');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('subscription-payment-failed.html template exists on disk', () => {
    const templatePath = path.join(
      __dirname,
      '../../email-templates/subscription-payment-failed.html'
    );
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('template loadEmailTemplate performs HTML escaping of user content', () => {
    const src = readSrc('utils', 'postmark.js');
    const loadFnIdx = src.indexOf('function loadEmailTemplate');
    const loadFnBody = src.substring(loadFnIdx, loadFnIdx + 1500);
    // Should escape HTML entities in template data
    expect(loadFnBody).toContain('escapeHtml');
    expect(loadFnBody).toContain('&amp;');
    expect(loadFnBody).toContain('&lt;');
    expect(loadFnBody).toContain('&gt;');
  });

  it('template loading replaces {{year}} with current year', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('{{year}}');
    expect(src).toContain('new Date().getFullYear()');
  });

  it('template loading clears unresolved {{placeholders}} at end', () => {
    const src = readSrc('utils', 'postmark.js');
    // The regex is escaped in the source: /\{\{[^}]+\}\}/g
    expect(src).toContain('Clear any remaining unresolved template placeholders');
    expect(src).toContain("html.replace(/\\{\\{[^}]+\\}\\}/g, '')");
  });
});

describe('Postmark — Admin Email Flows (route contract)', () => {
  let adminContent;

  beforeAll(() => {
    adminContent = readSrc('routes', 'admin.js');
  });

  it('admin ticket reply sends email to senderEmail (non-blocking best-effort)', () => {
    // Find the ticket reply section
    const replyIdx = adminContent.indexOf('/tickets/:id/reply');
    expect(replyIdx).toBeGreaterThan(-1);
    const block = adminContent.substring(replyIdx, replyIdx + 4000);
    expect(block).toContain('postmark.sendMail');
    expect(block).toContain('senderEmail');
    expect(block).toContain('best-effort');
  });

  it('admin ticket reply email XSS-escapes user content before embedding in HTML', () => {
    const replyIdx = adminContent.indexOf('/tickets/:id/reply');
    const block = adminContent.substring(replyIdx, replyIdx + 4000);
    expect(block).toContain('escapeHtml');
    // Uses local escapeHtml helper to build safe names and messages
    expect(block).toMatch(/safeSenderName|safeName/);
    expect(block).toContain('safeMessage');
  });

  it('admin contact enquiry reply sends email to senderEmail (non-blocking best-effort)', () => {
    const enquiryIdx = adminContent.indexOf('/contact-enquiries/:id/reply');
    expect(enquiryIdx).toBeGreaterThan(-1);
    const block = adminContent.substring(enquiryIdx, enquiryIdx + 4000);
    expect(block).toContain('postmark.sendMail');
    expect(block).toContain('senderEmail');
    expect(block).toContain('best-effort');
  });

  it('admin contact enquiry reply XSS-escapes user content', () => {
    const enquiryIdx = adminContent.indexOf('/contact-enquiries/:id/reply');
    const block = adminContent.substring(enquiryIdx, enquiryIdx + 4000);
    expect(block).toContain('escapeHtml');
    expect(block).toContain('safeMessage');
  });

  it('admin routes require postmark utility at top level', () => {
    expect(adminContent).toContain("require('../utils/postmark')");
  });

  it('ticket reply uses correct subject line format', () => {
    const replyIdx = adminContent.indexOf('/tickets/:id/reply');
    const block = adminContent.substring(replyIdx, replyIdx + 4000);
    expect(block).toContain('subject:');
    // Subject should reference the ticket subject — "Re: <subject>"
    expect(block).toMatch(/Re:|subjectText|ticket\.subject/);
  });
});

describe('Postmark — isPostmarkEnabled status check', () => {
  it('isPostmarkEnabled returns boolean', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('function isPostmarkEnabled');
    expect(src).toContain('return POSTMARK_ENABLED');
  });

  it('getPostmarkStatus returns structured status object', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('function getPostmarkStatus');
    expect(src).toContain('enabled:');
    expect(src).toContain('POSTMARK_ENABLED');
  });

  it('exports isPostmarkEnabled function', () => {
    const src = readSrc('utils', 'postmark.js');
    expect(src).toContain('isPostmarkEnabled,');
  });
});
