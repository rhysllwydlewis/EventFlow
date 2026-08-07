/**
 * Community digest emails.
 *
 * user.communityNotificationPreferences.email ('daily'/'weekly'/'immediate'/'none')
 * has been readable and writable via the community API for a while, but
 * nothing ever sent anything based on it. This tests the service that
 * finally does.
 */

'use strict';

const mockDiscussionCards = [
  {
    title: 'Marquee hire in Kent',
    url: '/community/discussion/abc123/marquee-hire-in-kent',
    category: { name: 'Venues' },
    replyCount: 3,
    lastActivityAt: '2026-08-05T10:00:00.000Z',
  },
  {
    title: 'Caterer recommendations',
    url: '/community/discussion/def456/caterer-recommendations',
    category: { name: 'Catering' },
    replyCount: 0,
    lastActivityAt: '2026-08-06T09:00:00.000Z',
  },
];

jest.mock('../../services/community.service', () => ({
  loadPublicDiscussions: jest.fn(),
  toDiscussionCard: jest.fn(discussion => discussion),
}));

const community = require('../../services/community.service');
const {
  buildDigestDiscussions,
  renderDigest,
  sendCommunityDigests,
  scheduleCommunityDigest,
  MAX_DISCUSSIONS_IN_DIGEST,
} = require('../../services/communityDigest.service');

function user(overrides = {}) {
  return {
    id: 'u-1',
    email: 'member@example.com',
    verified: true,
    communityNotificationPreferences: { inApp: true, email: 'daily' },
    ...overrides,
  };
}

describe('buildDigestDiscussions', () => {
  beforeEach(() => {
    community.loadPublicDiscussions.mockReset();
    community.toDiscussionCard.mockReset().mockImplementation(discussion => discussion);
  });

  it('includes only discussions active since the cutoff, newest first', async () => {
    community.loadPublicDiscussions.mockResolvedValue([
      { title: 'Old', lastActivityAt: '2026-07-01T00:00:00.000Z' },
      mockDiscussionCards[0],
      mockDiscussionCards[1],
    ]);

    const result = await buildDigestDiscussions('2026-08-01T00:00:00.000Z', new Date());

    expect(result.map(item => item.title)).toEqual([
      'Caterer recommendations',
      'Marquee hire in Kent',
    ]);
  });

  it('caps the digest at MAX_DISCUSSIONS_IN_DIGEST', async () => {
    const many = Array.from({ length: MAX_DISCUSSIONS_IN_DIGEST + 5 }, (_unused, i) => ({
      title: `Discussion ${i}`,
      lastActivityAt: `2026-08-0${(i % 9) + 1}T00:00:00.000Z`,
    }));
    community.loadPublicDiscussions.mockResolvedValue(many);

    const result = await buildDigestDiscussions('2026-08-01T00:00:00.000Z', new Date());

    expect(result).toHaveLength(MAX_DISCUSSIONS_IN_DIGEST);
  });

  it('falls back to createdAt when there is no lastActivityAt', async () => {
    community.loadPublicDiscussions.mockResolvedValue([
      { title: 'Fresh', createdAt: '2026-08-05T00:00:00.000Z' },
    ]);

    const result = await buildDigestDiscussions('2026-08-01T00:00:00.000Z', new Date());

    expect(result).toHaveLength(1);
  });
});

describe('renderDigest', () => {
  it('links every discussion with an absolute URL and escapes titles', () => {
    const { html, text, subject } = renderDigest(
      [
        {
          title: 'Tips & <tricks>',
          url: '/community/discussion/x',
          category: { name: 'Venues' },
          replyCount: 2,
        },
      ],
      'weekly',
      'https://event-flow.co.uk'
    );

    expect(html).toContain('https://event-flow.co.uk/community/discussion/x');
    expect(html).toContain('Tips &amp; &lt;tricks&gt;');
    expect(html).not.toContain('<tricks>');
    expect(text).toContain('https://event-flow.co.uk/community/discussion/x');
    expect(subject).toContain('1 new discussion');
  });
});

describe('sendCommunityDigests', () => {
  beforeEach(() => {
    community.loadPublicDiscussions.mockReset().mockResolvedValue(mockDiscussionCards);
    community.toDiscussionCard.mockReset().mockImplementation(discussion => discussion);
  });

  it('rejects an unknown cadence', async () => {
    await expect(sendCommunityDigests({ cadence: 'hourly' })).rejects.toThrow(
      'Unknown digest cadence'
    );
  });

  it('skips sending entirely when there is nothing new', async () => {
    community.loadPublicDiscussions.mockResolvedValue([]);
    const sendMail = jest.fn();
    const db = { read: jest.fn().mockResolvedValue([user()]) };

    const result = await sendCommunityDigests({ cadence: 'daily', db, sendMail });

    expect(result).toEqual({ sent: 0, recipients: 0, discussionsIncluded: 0, skipped: true });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('emails only verified members whose preference matches the cadence', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const db = {
      read: jest
        .fn()
        .mockResolvedValue([
          user({ id: 'daily-1', email: 'a@example.com' }),
          user({
            id: 'weekly-1',
            email: 'b@example.com',
            communityNotificationPreferences: { email: 'weekly' },
          }),
          user({
            id: 'none-1',
            email: 'c@example.com',
            communityNotificationPreferences: { email: 'none' },
          }),
          user({ id: 'unverified-1', email: 'd@example.com', verified: false }),
          { id: 'no-prefs', email: 'e@example.com', verified: true },
        ]),
    };

    const result = await sendCommunityDigests({
      cadence: 'daily',
      db,
      sendMail,
      now: new Date('2026-08-07T00:00:00.000Z'),
    });

    expect(result.sent).toBe(1);
    expect(result.recipients).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'a@example.com',
      messageStream: 'broadcasts',
    });
  });

  it('keeps sending to remaining recipients when one send fails', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce(new Error('Postmark down'))
      .mockResolvedValueOnce({});
    const db = {
      read: jest
        .fn()
        .mockResolvedValue([
          user({ id: 'a', email: 'a@example.com' }),
          user({ id: 'b', email: 'b@example.com' }),
        ]),
    };
    const log = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };

    const result = await sendCommunityDigests({
      cadence: 'daily',
      db,
      sendMail,
      log,
      now: new Date('2026-08-07T00:00:00.000Z'),
    });

    expect(result.sent).toBe(1);
    expect(result.recipients).toBe(2);
    expect(log.error).toHaveBeenCalled();
  });
});

describe('scheduleCommunityDigest', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const originalEnabled = process.env.COMMUNITY_DIGEST_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.COMMUNITY_DIGEST_ENABLED;
    } else {
      process.env.COMMUNITY_DIGEST_ENABLED = originalEnabled;
    }
    log.info.mockClear();
  });

  it('does not schedule when disabled', () => {
    process.env.COMMUNITY_DIGEST_ENABLED = 'false';
    const result = scheduleCommunityDigest({ log });
    expect(result.scheduled).toBe(false);
  });

  it('schedules both a daily and a weekly job when enabled', () => {
    process.env.COMMUNITY_DIGEST_ENABLED = 'true';
    const job = { nextInvocation: () => new Date() };
    const scheduleModule = { scheduleJob: jest.fn().mockReturnValue(job) };

    const result = scheduleCommunityDigest({ log, scheduleModule });

    expect(result.scheduled).toBe(true);
    expect(scheduleModule.scheduleJob).toHaveBeenCalledTimes(2);
  });
});
