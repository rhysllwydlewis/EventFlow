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
      repliedPct: null,
      medianMinutes: null,
    });
  });

  it('is null (and zero sample) when there is nothing at all', () => {
    expect(summariseResponses([], NOW)).toEqual({
      sampleSize: 0,
      matureSampleSize: 0,
      repliedPct: null,
      medianMinutes: null,
    });
  });

  it('computes the share replied and the median gap at exactly 3 conversations', () => {
    const result = summariseResponses([sample(48, 10), sample(48, 30), sample(48, null)], NOW);

    expect(result.sampleSize).toBe(3);
    expect(result.repliedPct).toBe(67);
    expect(result.medianMinutes).toBe(20);
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

  it('leaves repliedPct null while every conversation is still too young, but still gives the median', () => {
    const result = summariseResponses([sample(2, 15), sample(3, 45), sample(4, null)], NOW);

    expect(result.repliedPct).toBeNull();
    expect(result.medianMinutes).toBe(30);
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

    expect(fakeDb.aggregate).toHaveBeenCalledTimes(1);
    expect(fakeDb.aggregate.mock.calls[0][0]).toBe('chat_messages_v4');
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
    expect(filter.createdAt.$gte.getTime()).toBe(NOW - 14 * 24 * HOUR);
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
          id: 'q1',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-1' }],
        },
        {
          id: 'q2',
          createdAt: new Date(NOW - HOUR).toISOString(),
          suppliers: [{ supplierId: 'sup-2' }],
        },
        { id: 'q3', createdAt: new Date(NOW - HOUR).toISOString() },
      ],
      enquiries: [
        { id: 'e1', supplierId: 'sup-1', createdAt: new Date(NOW - HOUR).toISOString() },
        { id: 'e2', supplierId: 'sup-2', createdAt: new Date(NOW - HOUR).toISOString() },
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
