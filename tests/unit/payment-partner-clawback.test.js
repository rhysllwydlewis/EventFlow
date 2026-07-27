'use strict';

const mockPayment = {
  id: 'pay_1',
  userId: 'usr_supplier',
  stripePaymentId: 'pi_1',
  status: 'succeeded',
  metadata: {},
};
const mockDb = {
  findOne: jest.fn(async (_collection, query) =>
    query.id === mockPayment.id ? { ...mockPayment } : null
  ),
  updateOne: jest.fn(async (_collection, _query, update) => update),
};
const mockClawback = {
  clawBackForPaymentRecord: jest.fn(async () => ({ id: 'ptx_clawback' })),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../services/partnerRewardClawbackService', () => mockClawback);
jest.mock('../../utils/logger', () => mockLogger);
jest.mock('../../store', () => ({ uid: jest.fn(() => 'pay_test') }));

const paymentService = require('../../services/paymentService');

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.findOne.mockImplementation(async (_collection, query) =>
    query.id === mockPayment.id ? { ...mockPayment } : null
  );
  mockDb.updateOne.mockImplementation(async (_collection, _query, update) => update);
  mockClawback.clawBackForPaymentRecord.mockResolvedValue({ id: 'ptx_clawback' });
});

test.each(['refunded', 'disputed', 'chargeback'])(
  'claws back the partner subscription reward when payment becomes %s',
  async status => {
    const updated = await paymentService.updatePaymentRecord('pay_1', { status });

    expect(updated.status).toBe(status);
    expect(mockClawback.clawBackForPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay_1', status }),
      status
    );
  }
);

test('does not invoke reward clawback for a successful payment update', async () => {
  await paymentService.updatePaymentRecord('pay_1', { status: 'succeeded' });
  expect(mockClawback.clawBackForPaymentRecord).not.toHaveBeenCalled();
});

test('does not claw back when the adverse payment status fails to persist', async () => {
  mockDb.updateOne.mockResolvedValueOnce(null);

  await expect(
    paymentService.updatePaymentRecord('pay_1', { status: 'refunded' })
  ).rejects.toMatchObject({
    code: 'PAYMENT_UPDATE_WRITE_FAILED',
  });
  expect(mockClawback.clawBackForPaymentRecord).not.toHaveBeenCalled();
});

test('propagates clawback failures so Stripe can retry the webhook', async () => {
  mockClawback.clawBackForPaymentRecord.mockRejectedValueOnce(
    new Error('clawback audit write failed')
  );

  await expect(
    paymentService.updatePaymentRecord('pay_1', { status: 'refunded' })
  ).rejects.toThrow('clawback audit write failed');
  expect(mockLogger.error).toHaveBeenCalledWith(
    '[PARTNER-ANTI-ABUSE] Automatic reward clawback failed',
    expect.objectContaining({
      paymentId: 'pay_1',
      status: 'refunded',
      error: 'clawback audit write failed',
    })
  );
});

test('rejects updates for an unknown payment before any write or clawback', async () => {
  await expect(
    paymentService.updatePaymentRecord('pay_missing', { status: 'refunded' })
  ).rejects.toThrow('Payment not found');
  expect(mockDb.updateOne).not.toHaveBeenCalled();
  expect(mockClawback.clawBackForPaymentRecord).not.toHaveBeenCalled();
});
