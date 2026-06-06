'use strict';

jest.mock('../../db-unified', () => {
  const rows = [];
  return {
    __rows: rows,
    uid: jest.fn(prefix => `${prefix}-${rows.length + 1}`),
    insertOne: jest.fn(async (_collection, doc) => {
      rows.push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (_collection, id, updates) => {
      const row = rows.find(item => item.id === id || (id && id.id && item.id === id.id));
      if (!row) {
        return false;
      }
      Object.assign(row, updates.$set || updates);
      return true;
    }),
    read: jest.fn(async () => rows),
    findOne: jest.fn(
      async (_collection, filter) =>
        rows.find(item => Object.keys(filter).every(k => item[k] === filter[k])) || null
    ),
    findWithOptions: jest.fn(async (_collection, filter, options) => {
      let result = rows.filter(item =>
        Object.keys(filter).every(key => {
          const expected = filter[key];
          const actual = item[key];
          if (expected && expected.$regex) {
            return new RegExp(expected.$regex, expected.$options || '').test(actual);
          }
          return actual === expected;
        })
      );
      result = result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return result.slice(options.skip, options.skip + options.limit);
    }),
    count: jest.fn(
      async (_collection, filter) =>
        rows.filter(item =>
          Object.keys(filter).every(key => {
            const expected = filter[key];
            const actual = item[key];
            if (expected && expected.$regex) {
              return new RegExp(expected.$regex, expected.$options || '').test(actual);
            }
            return actual === expected;
          })
        ).length
    ),
  };
});

const dbUnified = require('../../db-unified');
const emailLogService = require('../../services/emailLog.service');

describe('emailLog.service', () => {
  beforeEach(() => {
    dbUnified.__rows.length = 0;
    jest.clearAllMocks();
  });

  test('creates metadata-only attempted email logs without bodies or sensitive template data', async () => {
    const log = await emailLogService.createAttempt({
      to: 'person@example.com',
      from: 'noreply@example.com',
      subject: 'Reset your password',
      template: 'password-reset',
      html: '<a href="https://example.com/reset?token=secret">Reset</a>',
      text: 'Reset using https://example.com/reset?token=secret',
      templateData: {
        title: 'Password reset',
        resetLink: 'https://example.com/reset?token=secret',
        verificationToken: 'secret',
        bodyHtml: '<p>Private</p>',
      },
      messageStream: 'password-reset',
      tags: ['password-reset'],
    });

    expect(log).toMatchObject({
      to: 'person@example.com',
      status: 'attempted',
      template: 'password-reset',
      messageStream: 'password-reset',
    });
    expect(log).not.toHaveProperty('html');
    expect(log).not.toHaveProperty('text');
    expect(JSON.stringify(log)).not.toContain('token=secret');
    expect(JSON.stringify(log)).not.toContain('verificationToken');
    expect(log.templateDataSummary).toEqual({ title: 'Password reset' });
  });

  test('lists logs newest first with status filtering and capped limits', async () => {
    await emailLogService.createAttempt({
      to: 'old@example.com',
      subject: 'Old',
      template: 'welcome',
    });
    dbUnified.__rows[0].createdAt = '2026-01-01T00:00:00.000Z';
    await emailLogService.createAttempt({
      to: 'new@example.com',
      subject: 'New',
      template: 'marketing',
    });
    dbUnified.__rows[1].createdAt = '2026-02-01T00:00:00.000Z';
    await emailLogService.updateStatus(dbUnified.__rows[1].id, { status: 'failed' });

    const result = await emailLogService.listLogs({ status: 'failed', limit: '999' });

    expect(result.pagination.limit).toBe(100);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].to).toBe('new@example.com');
    expect(result.items[0]).not.toHaveProperty('events');
  });

  test('webhook appends Delivered and Bounced events to matching MessageID', async () => {
    const log = await emailLogService.createAttempt({ to: 'person@example.com', subject: 'Hello' });
    await emailLogService.updateStatus(log.id, { postmarkMessageId: 'pm-123', status: 'sent' });

    await emailLogService.appendWebhookEvent({
      RecordType: 'Delivered',
      MessageID: 'pm-123',
      Recipient: 'person@example.com',
      DeliveredAt: '2026-03-01T10:00:00Z',
    });
    await emailLogService.appendWebhookEvent({
      RecordType: 'Bounced',
      MessageID: 'pm-123',
      Recipient: 'person@example.com',
      BouncedAt: '2026-03-01T10:05:00Z',
      Description: 'Mailbox unavailable',
    });

    const detail = await emailLogService.getLog(log.id);
    expect(detail.status).toBe('bounced');
    expect(detail.events.map(event => event.type)).toEqual(['Attempted', 'Delivered', 'Bounced']);
    expect(detail.lastEventAt).toBe('2026-03-01T10:05:00.000Z');
  });

  test('invalid webhook timestamps fall back safely', async () => {
    const log = await emailLogService.createAttempt({ to: 'person@example.com', subject: 'Hello' });
    await emailLogService.updateStatus(log.id, {
      postmarkMessageId: 'pm-invalid-date',
      status: 'sent',
    });

    await expect(
      emailLogService.appendWebhookEvent({
        RecordType: 'Opened',
        MessageID: 'pm-invalid-date',
        ReceivedAt: 'not-a-date',
      })
    ).resolves.toMatchObject({ matched: true, id: log.id });

    const detail = await emailLogService.getLog(log.id);
    expect(detail.events[1].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('unknown MessageID webhook does not crash', async () => {
    await expect(
      emailLogService.appendWebhookEvent({ RecordType: 'Opened', MessageID: 'missing' })
    ).resolves.toEqual({ matched: false, reason: 'unknown_message_id' });
  });
});
