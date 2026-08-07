'use strict';

const { ObjectId } = require('mongodb');
const NotificationService = require('../../services/notification.service');
const {
  createFanoutState,
  markFanoutQueued,
  markFanoutProcessed,
  markFanoutFailed,
  reconcileNotificationFanout,
  startNotificationFanoutReconciler,
  sanitizeFanoutError,
} = require('../../services/notificationFanout.service');

describe('notification fan-out durability', () => {
  it('creates a pending marker with deduplicated recipients', () => {
    expect(createFanoutState(['u2', 'u2', 'u3'])).toMatchObject({
      status: 'pending',
      recipientIds: ['u2', 'u3'],
      attempts: 0,
    });
    expect(createFanoutState([])).toMatchObject({ status: 'not_required', recipientIds: [] });
  });

  it('requeues a claimed failed fan-out and records queued state', async () => {
    const message = {
      _id: new ObjectId(),
      conversationId: new ObjectId(),
      senderName: 'Alice',
      content: 'Hello',
      notificationFanout: {
        status: 'failed',
        recipientIds: ['u2'],
      },
    };
    const updates = [];
    const messages = {
      find: jest.fn(() => ({
        sort: () => ({
          limit: () => ({ toArray: async () => [message] }),
        }),
      })),
      findOneAndUpdate: jest.fn(async () => ({
        ...message,
        notificationFanout: { ...message.notificationFanout, status: 'reconciling' },
      })),
      updateOne: jest.fn(async (...args) => {
        updates.push(args);
        return { modifiedCount: 1 };
      }),
    };
    const conversations = {
      findOne: jest.fn(async () => ({ context: { referenceTitle: 'Wedding venue' } })),
    };
    const db = {
      collection: jest.fn(name => (name === 'chat_messages_v4' ? messages : conversations)),
    };
    const enqueue = jest.fn(async () => ({ id: `message:${message._id}` }));

    const summary = await reconcileNotificationFanout({ db, enqueue });

    expect(summary).toEqual({ scanned: 1, queued: 1, failed: 0, notRequired: 0 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: String(message._id),
        recipients: ['u2'],
        contextTitle: 'Wedding venue',
      })
    );
    expect(
      updates.some(([, update]) => update.$set?.['notificationFanout.status'] === 'queued')
    ).toBe(true);
    expect(messages.findOneAndUpdate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({
            'notificationFanout.status': { $in: ['pending', 'failed'] },
            'notificationFanout.nextRetryAt': expect.any(Object),
          }),
        ]),
      })
    );
  });

  it('redacts Redis credentials from persisted errors', () => {
    expect(sanitizeFanoutError(new Error('connect redis://user:secret@example.test failed'))).toBe(
      'connect redis://[redacted]@example.test failed'
    );
  });

  it('does not let an enqueue acknowledgement regress a completed worker state', async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    await markFanoutQueued({ updateOne }, new ObjectId());

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        'notificationFanout.status': { $in: ['pending', 'reconciling'] },
      }),
      expect.any(Object)
    );
  });

  it('records terminal processing and retryable failure states', async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const messages = { updateOne };
    const messageId = new ObjectId();
    const now = new Date('2026-08-07T12:00:00.000Z');

    await markFanoutProcessed(messages, messageId, now);
    await markFanoutFailed(messages, messageId, new Error('temporary failure'), {
      now,
      retryDelayMs: 5_000,
    });

    expect(updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: messageId,
        'notificationFanout.status': { $nin: ['processed', 'not_required'] },
      },
      expect.objectContaining({
        $set: expect.objectContaining({ 'notificationFanout.status': 'processed' }),
      })
    );
    expect(updateOne).toHaveBeenNthCalledWith(
      2,
      {
        _id: messageId,
        'notificationFanout.status': { $nin: ['processed', 'not_required'] },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          'notificationFanout.status': 'failed',
          'notificationFanout.nextRetryAt': new Date('2026-08-07T12:00:05.000Z'),
        }),
        $inc: { 'notificationFanout.attempts': 1 },
      })
    );
  });

  it('recovers stale queued markers that may have lost their Redis job', async () => {
    const now = new Date('2026-08-07T12:00:00.000Z');
    const message = {
      _id: new ObjectId(),
      conversationId: new ObjectId(),
      content: 'Hello',
      notificationFanout: {
        status: 'queued',
        queuedAt: new Date('2026-08-07T11:50:00.000Z'),
        recipientIds: ['u2'],
      },
    };
    const messages = {
      find: jest.fn(() => ({
        sort: () => ({ limit: () => ({ toArray: async () => [message] }) }),
      })),
      findOneAndUpdate: jest.fn(async () => ({
        ...message,
        notificationFanout: { ...message.notificationFanout, status: 'reconciling' },
      })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const conversations = { findOne: jest.fn(async () => null) };
    const db = {
      collection: jest.fn(name => (name === 'chat_messages_v4' ? messages : conversations)),
    };
    const enqueue = jest.fn(async () => ({}));

    await expect(reconcileNotificationFanout({ db, enqueue, now })).resolves.toMatchObject({
      queued: 1,
    });
    expect(messages.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ 'notificationFanout.status': 'queued' }),
        ]),
      })
    );
    expect(messages.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.arrayContaining([
          expect.objectContaining({ 'notificationFanout.status': 'queued' }),
        ]),
      }),
      expect.any(Object),
      { returnDocument: 'after' }
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not advertise a reconciler after its initial recovery scan fails', async () => {
    const createIndex = jest.fn(async () => ({}));
    const db = {
      collection: jest.fn(() => ({
        createIndex,
        find: jest.fn(() => {
          throw new Error('database unavailable');
        }),
      })),
    };
    const logger = { error: jest.fn() };

    await expect(startNotificationFanoutReconciler({ db, logger })).rejects.toThrow(
      'database unavailable'
    );
    expect(createIndex).toHaveBeenCalled();
    expect(createIndex).toHaveBeenCalledWith(
      expect.objectContaining({ 'notificationFanout.queuedAt': 1 }),
      { name: 'messenger_notification_fanout_queued_recovery' }
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation run failed'),
      expect.objectContaining({ error: 'database unavailable' })
    );
  });

  it('settles a claimed message with no recipients without enqueueing', async () => {
    const message = {
      _id: new ObjectId(),
      conversationId: new ObjectId(),
      notificationFanout: { status: 'pending', recipientIds: [] },
    };
    const messages = {
      find: jest.fn(() => ({
        sort: () => ({ limit: () => ({ toArray: async () => [message] }) }),
      })),
      findOneAndUpdate: jest.fn(async () => ({
        ...message,
        notificationFanout: { ...message.notificationFanout, status: 'reconciling' },
      })),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const db = {
      collection: jest.fn(() => messages),
    };
    const enqueue = jest.fn();

    await expect(reconcileNotificationFanout({ db, enqueue })).resolves.toEqual({
      scanned: 1,
      queued: 0,
      failed: 0,
      notRequired: 1,
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(messages.updateOne).toHaveBeenCalledWith(
      { _id: message._id },
      expect.objectContaining({
        $set: expect.objectContaining({ 'notificationFanout.status': 'not_required' }),
      })
    );
  });
});

describe('message notification idempotency', () => {
  it('returns the existing deterministic notification on a duplicate delivery attempt', async () => {
    let inserted;
    const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
    const collection = {
      insertOne: jest
        .fn()
        .mockImplementationOnce(async value => {
          inserted = value;
          return { insertedId: value.id };
        })
        .mockRejectedValueOnce(duplicate),
      findOne: jest.fn(async () => inserted),
    };
    const service = new NotificationService({ collection: () => collection }, null);

    const first = await service.notifyNewMessage('u2', 'Alice', 'c1', 'Hello', {
      messageId: 'm1',
    });
    const second = await service.notifyNewMessage('u2', 'Alice', 'c1', 'Hello', {
      messageId: 'm1',
    });

    expect(second.id).toBe(first.id);
    expect(first.id).toMatch(/^message-/);
    expect(first.metadata.messageId).toBe('m1');
    expect(collection.findOne).toHaveBeenCalledWith({ id: first.id });
  });
});
