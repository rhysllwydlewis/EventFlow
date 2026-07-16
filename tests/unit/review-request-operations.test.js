'use strict';

const operations = require('../../utils/reviewRequestOperations');

describe('review request operations', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  test('derives expired state without mutating the stored request', () => {
    const request = {
      status: 'sent',
      expiresAt: '2026-07-15T12:00:00.000Z',
    };

    expect(operations.getEffectiveStatus(request, now)).toBe('expired');
    expect(request.status).toBe('sent');
    expect(operations.getRetryState(request, now)).toEqual(
      expect.objectContaining({ retryable: true, retryReason: 'expired' })
    );
  });

  test('keeps completed requests unavailable during the 30-day cooldown', () => {
    const request = {
      status: 'completed',
      completedAt: '2026-07-01T12:00:00.000Z',
    };

    expect(operations.getRetryState(request, now)).toEqual({
      retryable: false,
      retryAt: '2026-07-31T12:00:00.000Z',
      retryReason: 'cooldown',
    });
  });

  test('returns supplier-safe fields while retaining operational fields for admins', () => {
    const request = {
      id: 'request-1',
      supplierId: 'supplier-1',
      supplierName: 'Moor Audio',
      supplierOwnerUserId: 'supplier-user',
      customerEmail: 'customer@example.com',
      customerName: 'Alex',
      status: 'failed',
      deliveryStatus: 'bounced',
      tokenHash: 'never-return-this',
      providerMessageId: 'postmark-message',
      emailLogId: 'email-log-1',
      lastError: 'Detailed provider diagnostic',
      createdAt: now.toISOString(),
    };

    const supplier = operations.toSupplierItem(request, now);
    const admin = operations.toAdminItem(request, now);

    expect(supplier).not.toHaveProperty('tokenHash');
    expect(supplier).not.toHaveProperty('providerMessageId');
    expect(supplier).not.toHaveProperty('emailLogId');
    expect(supplier.lastError).toMatch(/safely retry/i);
    expect(admin).toEqual(
      expect.objectContaining({
        providerMessageId: 'postmark-message',
        emailLogId: 'email-log-1',
        lastError: 'Detailed provider diagnostic',
      })
    );
    expect(admin).not.toHaveProperty('tokenHash');
  });

  test('filters and paginates supplier requests newest first', () => {
    const records = [
      {
        id: 'old',
        customerEmail: 'old@example.com',
        customerName: 'Old',
        status: 'completed',
        completedAt: '2026-05-01T12:00:00.000Z',
        createdAt: '2026-05-01T12:00:00.000Z',
      },
      {
        id: 'new',
        customerEmail: 'new@example.com',
        customerName: 'New',
        status: 'failed',
        createdAt: '2026-07-16T11:00:00.000Z',
      },
    ];

    const result = operations.listSupplierRequests(
      records,
      { status: 'failed', search: 'new@', page: '1', limit: '1' },
      now
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('new');
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(result.summary).toEqual(expect.objectContaining({ total: 2, failed: 1, completed: 1 }));
  });

  test('filters admin requests by supplier and recipient', () => {
    const records = [
      {
        id: 'one',
        supplierId: 'supplier-1',
        supplierName: 'Moor Audio',
        customerEmail: 'alex@example.com',
        status: 'sent',
        expiresAt: '2026-07-20T12:00:00.000Z',
        createdAt: '2026-07-16T10:00:00.000Z',
      },
      {
        id: 'two',
        supplierId: 'supplier-2',
        supplierName: 'Other Supplier',
        customerEmail: 'other@example.com',
        status: 'failed',
        createdAt: '2026-07-16T11:00:00.000Z',
      },
    ];

    const result = operations.listAdminRequests(
      records,
      { supplier: 'moor', recipient: 'alex' },
      now
    );

    expect(result.items.map(item => item.id)).toEqual(['one']);
  });
});
