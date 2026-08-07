'use strict';

const mockNotifyNewMessage = jest.fn(async () => ({}));
const mockCreateWorker = jest.fn((_name, processor) => ({ processor }));
const mockGetQueueContext = jest.fn();
const mockEnqueueEmailJob = jest.fn(async () => ({}));
const mockMarkFanoutProcessed = jest.fn(async () => {});
const mockMarkFanoutFailed = jest.fn(async () => {});

jest.mock('../../services/notification.service', () =>
  jest.fn().mockImplementation(() => ({ notifyNewMessage: mockNotifyNewMessage }))
);
jest.mock('../../services/queue', () => ({
  createWorker: mockCreateWorker,
  getQueueContext: mockGetQueueContext,
  enqueueEmailJob: mockEnqueueEmailJob,
}));
jest.mock('../../services/notificationFanout.service', () => ({
  markFanoutProcessed: mockMarkFanoutProcessed,
  markFanoutFailed: mockMarkFanoutFailed,
}));

const {
  processNotificationJob,
  startNotificationWorker,
} = require('../../services/queue/workers/notification.worker');
const { processEmailJob, startEmailWorker } = require('../../services/queue/workers/email.worker');

describe('notification queue worker', () => {
  const messages = { updateOne: jest.fn(async () => ({})) };
  const db = {
    collection: jest.fn(name =>
      name === 'chat_messages_v4'
        ? messages
        : { findOne: jest.fn(async () => ({ email: 'recipient@example.test' })) }
    ),
  };
  const logger = { info: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQueueContext.mockReturnValue({ db, logger });
  });

  it('creates idempotent notifications, queues email and marks fan-out processed', async () => {
    const data = {
      messageId: '507f1f77bcf86cd799439011',
      conversationId: 'c1',
      recipients: ['u2', 'u3'],
      senderName: 'Alice',
      preview: 'Hello',
      contextTitle: 'Venue',
    };

    await processNotificationJob({ data });

    expect(mockNotifyNewMessage).toHaveBeenCalledTimes(2);
    expect(mockNotifyNewMessage).toHaveBeenCalledWith('u2', 'Alice', 'c1', 'Hello', {
      messageId: data.messageId,
    });
    expect(mockEnqueueEmailJob).toHaveBeenCalledTimes(2);
    expect(mockMarkFanoutProcessed).toHaveBeenCalledWith(messages, data.messageId);
    expect(startNotificationWorker()).toEqual({ processor: processNotificationJob });
  });

  it('fails fast without a database and records processing failures', async () => {
    mockGetQueueContext.mockReturnValueOnce({ db: null, logger });
    await expect(processNotificationJob({ data: {} })).rejects.toThrow(/db unavailable/);

    mockNotifyNewMessage.mockRejectedValueOnce(new Error('notification failed'));
    await expect(
      processNotificationJob({
        data: {
          messageId: '507f1f77bcf86cd799439011',
          conversationId: 'c1',
          recipients: ['u2'],
        },
      })
    ).rejects.toThrow('notification failed');
    expect(mockMarkFanoutFailed).toHaveBeenCalled();
  });
});

describe('email queue worker', () => {
  const sendMail = jest.fn(async () => ({}));
  const logger = { info: jest.fn() };
  const db = {
    collection: jest.fn(() => ({
      findOne: jest.fn(async () => ({ email: 'recipient@example.test' })),
    })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing context and sends with a complete worker context', async () => {
    mockGetQueueContext.mockReturnValueOnce({ db: null, logger });
    await expect(processEmailJob({ data: {} })).rejects.toThrow(/context unavailable/);

    mockGetQueueContext.mockReturnValueOnce({
      db,
      logger,
      postmark: { sendMail, FROM_NOREPLY: 'noreply@example.test' },
    });
    await processEmailJob({
      data: {
        messageId: 'm1',
        conversationId: 'c1',
        recipientId: 'u2',
        senderName: 'Alice',
        preview: 'Hello',
      },
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'recipient@example.test', from: 'noreply@example.test' })
    );
    expect(startEmailWorker()).toEqual({ processor: processEmailJob });
  });
});
