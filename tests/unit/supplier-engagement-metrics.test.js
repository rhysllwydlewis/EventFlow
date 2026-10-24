'use strict';

/**
 * Reply statistics and enquiry classification. The rules under test:
 *   - an enquiry is a conversation whose first message came from a customer
 *   - repliedPct ignores conversations younger than 24 hours
 *   - repliedPct and medianMinutes are null below three conversations
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

const fakeDb = require('../helpers/fake-db-unified');
const {
  median,
  summariseResponses,
  classifyEnquiryConversations,
  getEngagementMetrics,
  getMessagingSummary,
  dedupeEnquiries,
  customerKey,
  clearEngagementCache,
} = require('../../services/supplierEngagementMetrics');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-07-16T12:00:00.000Z');

/**
 * Build a reply sample.
 *
 * @param {number} ageHours - How long ago the customer first wrote
 * @param {number|null} replyAfterMinutes - Minutes until the supplier replied, or null
 * @returns {Object} sample
 */
function sample(ageHours, replyAfterMinutes) {
  const customerFirstMs = NOW - ageHours * HOUR;
  return {
    createdMs: customerFirstMs,
    customerFirstMs,
    supplierFirstMs:
      replyAfterMinutes === null ? null : customerFirstMs + replyAfterMinutes * 60000,
  };
}

describe('median', () => {
  it('handles empty, odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('does not reorder its input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('summariseResponses', () => {
  it('is null for both figures with fewer than 3 conversations', () => {
    const result = summariseResponses([sample(48, 10), sample(48, 20)], NOW);

    expect(result).toEqual({
      sampleSize: 2,
      matureSampleSize: 2,
      unanswered: 0,
      repliedPct: null,
      medianMinutes: null,
    });
  });

  it('is null (and zero sample) when there is nothing at all', () => {
    expect(summariseResponses([], NOW)).toEqual({
      sampleSize: 0,
      matureSampleSize: 0,
      unanswered: 0,
      repliedPct: null,
      medianMinutes: null,
    });
  });

  it('computes the share replied at exactly 3 judged conversations', () => {
    const result = summariseResponses([sample(48, 10), sample(48, 30), sample(48, null)], NOW);

    expect(result.sampleSize).toBe(3);
    expect(result.repliedPct).toBe(67);
    // Only two replies: not enough to quote a typical reply time.
    expect(result.medianMinutes).toBeNull();
  });

  it('computes the median at exactly 3 replies', () => {
    const result = summariseResponses([sample(48, 10), sample(48, 30), sample(48, 50)], NOW);

    expect(result.medianMinutes).toBe(30);
  });

  it('does not quote a percentage from one judged conversation hidden among young ones', () => {
    const result = summariseResponses([sample(2, null), sample(3, null), sample(48, 10)], NOW);

    expect(result.sampleSize).toBe(3);
    expect(result.matureSampleSize).toBe(1);
    expect(result.repliedPct).toBeNull();
    expect(result.medianMinutes).toBeNull();
  });

  it('does not quote 0% from one judged unanswered conversation', () => {
    const result = summariseResponses([sample(2, null), sample(3, null), sample(48, null)], NOW);

    expect(result.repliedPct).toBeNull();
  });

  it('does not quote a typical reply time from a single reply among three conversations', () => {
    const result = summariseResponses([sample(48, 5), sample(48, null), sample(48, null)], NOW);

    expect(result.repliedPct).toBe(33);
    expect(result.medianMinutes).toBeNull();
  });

  it('does not count an unanswered conversation under 24 hours old against the supplier', () => {
    const result = summariseResponses(
      [sample(48, 10), sample(48, 10), sample(48, 10), sample(3, null), sample(23.9, null)],
      NOW
    );

    expect(result.sampleSize).toBe(5);
    expect(result.matureSampleSize).toBe(3);
    expect(result.repliedPct).toBe(100);
  });

  it('judges a conversation exactly 24 hours old', () => {
    const result = summariseResponses([sample(24, null), sample(48, 5), sample(48, 5)], NOW);

    expect(result.matureSampleSize).toBe(3);
    expect(result.repliedPct).toBe(67);
  });

  it('leaves repliedPct null while the conversations are too young, and the median needs 3 replies', () => {
    const young = summariseResponses([sample(2, 15), sample(3, 45), sample(4, null)], NOW);
    const youngReplied = summariseResponses([sample(2, 15), sample(3, 45), sample(4, 30)], NOW);

    expect(young.repliedPct).toBeNull();
    expect(young.medianMinutes).toBeNull();
    expect(youngReplied.repliedPct).toBeNull();
    expect(youngReplied.medianMinutes).toBe(30);
  });

  it('reports how many judged conversations went unanswered even when too few for a percentage', () => {
    const result = summariseResponses([sample(48, null), sample(72, 5)], NOW);

    expect(result.unanswered).toBe(1);
    expect(result.repliedPct).toBeNull();
  });

  it('reports a genuine 0% when mature conversations all went unanswered', () => {
    const result = summariseResponses([sample(48, null), sample(72, null), sample(96, null)], NOW);

    expect(result.repliedPct).toBe(0);
    expect(result.medianMinutes).toBeNull();
  });

  it('rounds the median to one decimal place of a minute', () => {
    const result = summariseResponses([sample(48, 1), sample(48, 2.26), sample(48, 3)], NOW);

    expect(result.medianMinutes).toBe(2.3);
  });
});

describe('classifyEnquiryConversations', () => {
  const owner = 'user-1';

  /**
   * Build a conversation document.
   *
   * @param {string} id - Conversation id
   * @param {Object[]} others - Other participants
   * @returns {Object} conversation
   */
  function conversation(id, others) {
    return {
      _id: id,
      createdAt: new Date(NOW - 5 * HOUR),
      participants: [{ userId: owner, role: 'supplier' }, ...others],
    };
  }

  /**
   * Build an aggregation row.
   *
   * @param {string} conversationId - Conversation id
   * @param {string} senderId - Sender
   * @param {number} minutesAgo - Minutes before NOW
   * @returns {Object} row
   */
  function row(conversationId, senderId, minutesAgo) {
    return {
      _id: { conversationId, senderId },
      firstAt: new Date(NOW - minutesAgo * 60000),
    };
  }

  it('counts a customer-started conversation and records both first-message times', () => {
    const result = classifyEnquiryConversations(
      [conversation('c1', [{ userId: 'cust', role: 'customer' }])],
      [row('c1', 'cust', 120), row('c1', owner, 90)],
      owner
    );

    expect(result).toHaveLength(1);
    expect(result[0].supplierFirstMs - result[0].customerFirstMs).toBe(30 * 60000);
  });

  it('records no supplier reply when the supplier never wrote', () => {
    const result = classifyEnquiryConversations(
      [conversation('c1', [{ userId: 'cust', role: 'customer' }])],
      [row('c1', 'cust', 120)],
      owner
    );

    expect(result[0].supplierFirstMs).toBeNull();
  });

  it('skips conversations the supplier started', () => {
    const result = classifyEnquiryConversations(
      [conversation('c1', [{ userId: 'cust', role: 'customer' }])],
      [row('c1', owner, 120), row('c1', 'cust', 60)],
      owner
    );

    expect(result).toEqual([]);
  });

  it('skips supplier-to-supplier and admin conversations', () => {
    const result = classifyEnquiryConversations(
      [
        conversation('c1', [{ userId: 'other-supplier', role: 'supplier' }]),
        conversation('c2', [{ userId: 'admin-1', role: 'admin' }]),
      ],
      [row('c1', 'other-supplier', 120), row('c2', 'admin-1', 120)],
      owner
    );

    expect(result).toEqual([]);
  });

  it('skips conversations with no messages and ignores messages from non-participants', () => {
    const result = classifyEnquiryConversations(
      [
        conversation('empty', [{ userId: 'cust', role: 'customer' }]),
        conversation('stranger', [{ userId: 'cust', role: 'customer' }]),
      ],
      [row('stranger', 'someone-else', 120)],
      owner
    );

    expect(result).toEqual([]);
  });

  it('matches message rows to conversations by id string (ObjectId-safe)', () => {
    const objectIdLike = { toString: () => 'abc123' };
    const result = classifyEnquiryConversations(
      [{ ...conversation('x', [{ userId: 'cust', role: 'customer' }]), _id: objectIdLike }],
      [row(objectIdLike, 'cust', 120)],
      owner
    );

    expect(result).toHaveLength(1);
  });
});

describe('getEngagementMetrics', () => {
  beforeEach(() => {
    fakeDb.__reset({});
  });

  it('makes a single bounded aggregate for first messages, not one read per message', async () => {
    fakeDb.__reset({
      conversations_v4: [
        {
          _id: 'c1',
          participants: [
            { userId: 'user-1', role: 'supplier' },
            { userId: 'cust', role: 'customer' },
          ],
          messageCount: 2,
          createdAt: new Date(NOW - 3 * HOUR),
        },
      ],
      chat_messages_v4: [
        { conversationId: 'c1', senderId: 'cust', createdAt: new Date(NOW - 3 * HOUR) },
        { conversationId: 'c1', senderId: 'cust', createdAt: new Date(NOW - 2 * HOUR) },
      ],
    });
    fakeDb.aggregate.mockClear();
    fakeDb.read.mockClear();

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    const messageAggregates = fakeDb.aggregate.mock.calls.filter(
      call => call[0] === 'chat_messages_v4'
    );
    expect(messageAggregates).toHaveLength(1);
    expect(fakeDb.read).not.toHaveBeenCalled();
    expect(result.enquiries.sources.conversations).toBe(1);
  });

  it('keeps the conversation query inside the previous and current window only', async () => {
    fakeDb.findWithOptions.mockClear();

    await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    const [collection, filter, options] = fakeDb.findWithOptions.mock.calls[0];
    expect(collection).toBe('conversations_v4');
    expect(filter['participants.userId']).toBe('user-1');
    // Whole UTC days: 7 days ending today starts 6 days before 00:00 on the 16th, and the
    // previous window is the 7 days before that.
    expect(filter.createdAt.$gte.getTime()).toBe(Date.parse('2026-07-03T00:00:00.000Z'));
    expect(options.limit).toBeLessThanOrEqual(1000);
  });

  it('flags truncation when the scan limit is hit', async () => {
    fakeDb.findWithOptions.mockImplementationOnce(async () =>
      Array.from({ length: 1000 }, (_, index) => ({
        _id: `c${index}`,
        participants: [{ userId: 'user-1', role: 'supplier' }],
        createdAt: new Date(NOW - HOUR),
      }))
    );

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    expect(result.enquiries.truncated).toBe(true);
  });

  it('counts quote requests and contact enquiries only for the named supplier', async () => {
    fakeDb.__reset({
      quoteRequests: [
        {
          id: 'qr_1',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          id: 'qr_2',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-2' }],
        },
        { id: 'qr_3', createdAt: new Date(NOW - HOUR).toISOString() },
      ],
      enquiries: [
        { id: 'enq_1', supplierId: 'sup-1', createdAt: new Date(NOW - HOUR).toISOString() },
        { id: 'enq_2', supplierId: 'sup-2', createdAt: new Date(NOW - HOUR).toISOString() },
      ],
    });

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    expect(result.enquiries.sources).toEqual({
      conversations: 0,
      quoteRequests: 1,
      contactForm: 1,
    });
  });
});

describe('quote request and contact-form reads', () => {
  const iso = hoursAgoMs => new Date(NOW - hoursAgoMs * HOUR).toISOString();

  beforeEach(() => {
    fakeDb.__reset({});
    clearEngagementCache();
  });

  it('selects only this supplier quote requests in the database and projects just the needed fields', async () => {
    fakeDb.__reset({
      quoteRequests: [
        {
          id: 'qr_1',
          createdAt: iso(5),
          name: 'Alice Customer',
          email: 'alice@example.com',
          phone: '0123',
          notes: 'private notes',
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          id: 'qr_2',
          createdAt: iso(5),
          name: 'Bob Other',
          email: 'bob@example.com',
          suppliers: [{ supplierId: 'sup-2' }],
        },
      ],
    });
    fakeDb.aggregate.mockClear();
    fakeDb.find.mockClear();

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    expect(result.enquiries.sources.quoteRequests).toBe(1);
    const call = fakeDb.aggregate.mock.calls.find(item => item[0] === 'quoteRequests');
    const [, pipeline] = call;
    expect(pipeline[0].$match['suppliers.supplierId']).toBe('sup-1');
    // Newest first and capped like the supplier's enquiry list, so the two cannot disagree.
    expect(pipeline[1]).toEqual({ $sort: { createdAt: -1 } });
    expect(pipeline[2]).toEqual({ $limit: 1000 });
    expect(pipeline[3].$project).toEqual({ id: 1, createdAt: 1, userId: 1, email: 1 });
    // Never a platform-wide read of quote requests.
    expect(fakeDb.find.mock.calls.filter(item => item[0] === 'quoteRequests')).toHaveLength(0);
  });

  it('ignores rows whose id is not a quote request or contact enquiry id, like the list does', async () => {
    fakeDb.__reset({
      quoteRequests: [
        {
          id: 'qr_ok',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          id: 'odd-id',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
      ],
      enquiries: [
        { id: 'enq_ok', supplierId: 'sup-1', createdAt: new Date(NOW - HOUR).toISOString() },
        { id: 'weird', supplierId: 'sup-1', createdAt: new Date(NOW - HOUR).toISOString() },
      ],
    });

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    expect(result.enquiries.requests.received).toBe(2);
    expect(result.enquiries.sources).toMatchObject({ quoteRequests: 1, contactForm: 1 });
  });

  it('asks for errors on every read so a failure is not mistaken for "no enquiries"', async () => {
    fakeDb.aggregate.mockClear();
    fakeDb.find.mockClear();
    fakeDb.findWithOptions.mockClear();

    await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });
    await getMessagingSummary('user-1');

    const calls = [
      ...fakeDb.aggregate.mock.calls,
      ...fakeDb.find.mock.calls,
      ...fakeDb.findWithOptions.mock.calls,
      ...fakeDb.count.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach(call => {
      expect(call[call.length - 1]).toMatchObject({ throwOnError: true });
    });
  });

  it.each(['conversations_v4', 'chat_messages_v4', 'quoteRequests', 'enquiries'])(
    'rejects (rather than returning zeros) when %s cannot be read',
    async collection => {
      fakeDb.__reset({
        conversations_v4: [
          {
            _id: 'c1',
            participants: [
              { userId: 'user-1', role: 'supplier' },
              { userId: 'cust', role: 'customer' },
            ],
            messageCount: 1,
            createdAt: new Date(NOW - 3 * HOUR),
          },
        ],
        chat_messages_v4: [
          { conversationId: 'c1', senderId: 'cust', createdAt: new Date(NOW - 3 * HOUR) },
        ],
      });
      fakeDb.__failOn(collection);

      await expect(
        getEngagementMetrics({
          supplierId: 'sup-1',
          ownerUserId: 'user-1',
          days: 7,
          now: new Date(NOW),
        })
      ).rejects.toThrow(/fake db failure/);
    }
  );

  it('rejects when the inbox cannot be read', async () => {
    fakeDb.__failOn('conversations_v4');

    await expect(getMessagingSummary('user-1')).rejects.toThrow(/fake db failure/);
  });

  it('the test double itself swallows errors unless asked, like the real db-unified', async () => {
    fakeDb.__failOn('events');

    expect(await fakeDb.find('events', {})).toEqual([]);
    expect(await fakeDb.count('events', {})).toBe(0);
    await expect(fakeDb.find('events', {}, { throwOnError: true })).rejects.toThrow();
  });
});

describe('de-duplicating enquiries across channels', () => {
  const entry = (source, key, ms = 1) => ({ ms, key, source });

  it('counts one customer once even when they used several channels', () => {
    const kept = dedupeEnquiries([
      entry('contactForm', 'e:a@x.com'),
      entry('quoteRequests', 'e:a@x.com'),
      entry('conversations', 'u:1'),
      entry('quoteRequests', 'u:1'),
    ]);

    // The channel listed first (conversations, then quote requests, then contact form) keeps the count.
    expect(kept.map(item => `${item.source}:${item.key}`).sort()).toEqual([
      'conversations:u:1',
      'quoteRequests:e:a@x.com',
    ]);
  });

  it('counts a customer who sends two quote requests once, keeping the earliest', () => {
    const kept = dedupeEnquiries([
      entry('quoteRequests', 'u:1', 20),
      entry('quoteRequests', 'u:1', 10),
    ]);

    expect(kept).toEqual([entry('quoteRequests', 'u:1', 10)]);
  });

  it('keeps every enquiry that cannot be identified', () => {
    const kept = dedupeEnquiries([entry('quoteRequests', null), entry('quoteRequests', null)]);

    expect(kept).toHaveLength(2);
  });

  it('builds customer keys from account id first, then a normalised email', () => {
    expect(customerKey('user-1', 'A@X.com')).toBe('u:user-1');
    expect(customerKey(null, '  A@X.com ')).toBe('e:a@x.com');
    expect(customerKey(null, '')).toBeNull();
    expect(customerKey(undefined, undefined)).toBeNull();
  });

  it('counts a signed-in customer who both messaged and requested a quote once, and sources add up', async () => {
    fakeDb.__reset({
      conversations_v4: [
        {
          _id: 'c1',
          participants: [
            { userId: 'user-1', role: 'supplier' },
            { userId: 'cust-1', role: 'customer' },
          ],
          messageCount: 1,
          createdAt: new Date(NOW - 5 * HOUR),
        },
      ],
      chat_messages_v4: [
        { conversationId: 'c1', senderId: 'cust-1', createdAt: new Date(NOW - 5 * HOUR) },
      ],
      quoteRequests: [
        {
          id: 'qr_1',
          userId: 'cust-1',
          createdAt: new Date(NOW - 6 * HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          id: 'qr_2',
          userId: 'cust-2',
          createdAt: new Date(NOW - 7 * HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
      ],
      enquiries: [
        {
          id: 'enq_1',
          supplierId: 'sup-1',
          senderEmail: 'walkin@example.com',
          createdAt: new Date(NOW - 8 * HOUR).toISOString(),
        },
      ],
    });

    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
      now: new Date(NOW),
    });

    expect(result.enquiries.newThisPeriod).toBe(3);
    expect(result.enquiries.sources).toEqual({
      conversations: 1,
      quoteRequests: 1,
      contactForm: 1,
    });
    expect(result.enquiryTimestamps).toHaveLength(3);
  });
});

describe('result reuse', () => {
  beforeEach(() => {
    fakeDb.__reset({});
    clearEngagementCache();
  });

  it('reuses a result for the same supplier and window, but never across suppliers', async () => {
    fakeDb.findWithOptions.mockClear();

    await getEngagementMetrics({ supplierId: 'sup-1', ownerUserId: 'user-1', days: 7 });
    await getEngagementMetrics({ supplierId: 'sup-1', ownerUserId: 'user-1', days: 7 });
    // One computation reads conversations and contact enquiries once each.
    expect(fakeDb.findWithOptions).toHaveBeenCalledTimes(2);

    await getEngagementMetrics({ supplierId: 'sup-2', ownerUserId: 'user-2', days: 7 });
    await getEngagementMetrics({ supplierId: 'sup-1', ownerUserId: 'user-1', days: 30 });
    expect(fakeDb.findWithOptions).toHaveBeenCalledTimes(6);
  });

  it('does not reuse a failure', async () => {
    fakeDb.__failOn('conversations_v4');
    await expect(
      getEngagementMetrics({ supplierId: 'sup-1', ownerUserId: 'user-1', days: 7 })
    ).rejects.toThrow();

    fakeDb.__reset({});
    const result = await getEngagementMetrics({
      supplierId: 'sup-1',
      ownerUserId: 'user-1',
      days: 7,
    });

    expect(result.enquiries.newThisPeriod).toBe(0);
  });

  it('is bypassed when the caller supplies a clock', async () => {
    fakeDb.findWithOptions.mockClear();
    const params = { supplierId: 'sup-1', ownerUserId: 'user-1', days: 7, now: new Date(NOW) };

    await getEngagementMetrics(params);
    await getEngagementMetrics(params);

    expect(fakeDb.findWithOptions).toHaveBeenCalledTimes(4);
  });
});

describe('getMessagingSummary', () => {
  it('uses the real collection name conversations_v4 (not conversationsV4)', async () => {
    fakeDb.__reset({});
    fakeDb.findWithOptions.mockClear();
    fakeDb.count.mockClear();
    fakeDb.read.mockClear();

    await getMessagingSummary('user-1');

    const collections = [
      ...fakeDb.findWithOptions.mock.calls.map(call => call[0]),
      ...fakeDb.count.mock.calls.map(call => call[0]),
    ];
    expect(collections.length).toBeGreaterThan(0);
    expect(new Set(collections)).toEqual(new Set(['conversations_v4']));
    expect(fakeDb.read).not.toHaveBeenCalled();
  });

  it('is a real zero for an empty inbox', async () => {
    fakeDb.__reset({});

    expect(await getMessagingSummary('user-1')).toEqual({
      unreadMessages: 0,
      conversationsWithUnread: 0,
      total: 0,
      latestAt: null,
    });
  });
});
