/**
 * utils/supplierProGrant.js — the shared field-set builder used by all three
 * admin comp-Pro grant/revoke endpoints (routes/admin.js and
 * routes/supplier-admin.js POST /suppliers/:id/pro, and
 * routes/admin-user-management.js POST/DELETE /suppliers/:id/subscription).
 */
'use strict';

const {
  buildSupplierProGrantUpdate,
  buildSupplierProRevokeUpdate,
} = require('../../utils/supplierProGrant');

describe('buildSupplierProGrantUpdate', () => {
  it('defaults to tier "pro" when none is given', () => {
    const update = buildSupplierProGrantUpdate({ expiresAt: '2027-01-01T00:00:00Z' });
    expect(update.subscription.tier).toBe('pro');
    expect(update.proPlan).toBe('Pro');
  });

  it('grants pro_plus when requested', () => {
    const update = buildSupplierProGrantUpdate({
      tier: 'pro_plus',
      expiresAt: '2027-01-01T00:00:00Z',
    });
    expect(update.subscription.tier).toBe('pro_plus');
    expect(update.proPlan).toBe('Pro+');
  });

  it('sets isPro true and mirrors expiry across every field a reader might check', () => {
    const expiresAt = '2027-06-15T00:00:00Z';
    const update = buildSupplierProGrantUpdate({ tier: 'pro', expiresAt, grantedBy: 'admin-1' });

    expect(update.isPro).toBe(true);
    expect(update.proExpiresAt).toBe(expiresAt);
    expect(update.proPlanExpiry).toBe(expiresAt);
    expect(update.subscription.endDate).toBe(expiresAt);
    expect(update.subscription.status).toBe('active');
    expect(update.subscription.grantedBy).toBe('admin-1');
  });

  it('supports a lifetime grant with no expiry', () => {
    const update = buildSupplierProGrantUpdate({ tier: 'pro' });
    expect(update.proExpiresAt).toBeNull();
    expect(update.subscription.endDate).toBeNull();
  });
});

describe('buildSupplierProRevokeUpdate', () => {
  it('clears every Pro-related field consistently', () => {
    const update = buildSupplierProRevokeUpdate({ revokedBy: 'admin-1' });
    expect(update.isPro).toBe(false);
    expect(update.proExpiresAt).toBeNull();
    expect(update.proPlan).toBeNull();
    expect(update.proPlanExpiry).toBeNull();
    expect(update.subscription).toMatchObject({
      tier: 'free',
      status: 'cancelled',
      cancelledBy: 'admin-1',
    });
  });
});
