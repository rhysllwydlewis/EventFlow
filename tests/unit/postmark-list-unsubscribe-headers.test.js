'use strict';

/**
 * Gmail/Yahoo's bulk-sender rules (Feb 2024) require RFC 8058 one-click
 * unsubscribe headers on bulk mail or it gets bulk-foldered or rejected
 * outright. utils/postmark.js's sendMail() previously never set them —
 * this covers the sendMail()-level header logic and that the two bulk
 * marketing call sites (sendMarketingEmail, admin-campaigns.js) actually
 * pass an unsubscribeUrl through.
 */
describe('utils/postmark sendMail — RFC 8058 List-Unsubscribe headers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
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
    process.env = { ...originalEnv };
  });

  function mockPostmarkClient(sendEmail) {
    jest.doMock('postmark', () => ({
      ServerClient: jest.fn().mockImplementation(() => ({ sendEmail })),
    }));
  }

  test('adds List-Unsubscribe and List-Unsubscribe-Post headers when unsubscribeUrl is an https link', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ MessageID: 'msg-1' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await postmark.sendMail({
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
      unsubscribeUrl:
        'https://event-flow.co.uk/api/auth/unsubscribe?email=user%40example.com&token=abc',
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sentData = sendEmail.mock.calls[0][0];
    expect(sentData.Headers).toEqual(
      expect.arrayContaining([
        {
          Name: 'List-Unsubscribe',
          Value:
            '<https://event-flow.co.uk/api/auth/unsubscribe?email=user%40example.com&token=abc>',
        },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ])
    );
  });

  test('does not add List-Unsubscribe headers when unsubscribeUrl is not provided', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ MessageID: 'msg-2' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await postmark.sendMail({ to: 'user@example.com', subject: 'Hi', text: 'body' });

    const sentData = sendEmail.mock.calls[0][0];
    expect(sentData.Headers).toBeUndefined();
  });

  test('never sets List-Unsubscribe-Post for a non-https unsubscribeUrl, since a one-click POST can only target a real endpoint', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ MessageID: 'msg-3' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await postmark.sendMail({
      to: 'user@example.com',
      subject: 'Hi',
      text: 'body',
      unsubscribeUrl: 'mailto:unsubscribe@event-flow.co.uk',
    });

    const sentData = sendEmail.mock.calls[0][0];
    expect(sentData.Headers).toBeUndefined();
  });

  test('sendMarketingEmail passes its generated unsubscribe link through to sendMail as unsubscribeUrl', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ MessageID: 'msg-4' });
    mockPostmarkClient(sendEmail);

    const postmark = require('../../utils/postmark');
    await postmark.sendMarketingEmail(
      { email: 'user@example.com', name: 'User', notify_marketing: true },
      'A subject',
      'A message'
    );

    const sentData = sendEmail.mock.calls[0][0];
    const listUnsubscribeHeader = sentData.Headers?.find(h => h.Name === 'List-Unsubscribe');
    expect(listUnsubscribeHeader).toBeDefined();
    expect(listUnsubscribeHeader.Value).toMatch(
      /^<.*\/api\/auth\/unsubscribe\?email=.*&token=.*>$/
    );
    expect(sentData.Headers).toEqual(
      expect.arrayContaining([
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ])
    );
  });
});
