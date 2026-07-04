'use strict';

const { safePublicSupplier } = require('../../utils/supplierPublicProfile');
const { hydrateSupplierProfilePhoto } = require('../../utils/supplierProfilePhoto');

describe('safe public supplier messaging recipient projection', () => {
  it('exposes a sanitised messaging recipient only when quick-compose opts in', () => {
    const hydrated = hydrateSupplierProfilePhoto(
      {
        id: 'sup_1',
        approved: true,
        name: 'Messageable Supplier',
        contactEmail: 'supplier-private@example.com',
        ownerEmail: 'owner-private@example.com',
        passwordHash: 'private-hash',
      },
      { id: 'user_owner', email: 'owner@example.com' }
    );

    const projected = safePublicSupplier(hydrated, { exposeMessagingRecipient: true });

    expect(projected).toMatchObject({
      messagingRecipientId: 'user_owner',
    });
    expect(projected.ownerUserId).toBeUndefined();
    expect(projected.contactEmail).toBeUndefined();
    expect(projected.ownerEmail).toBeUndefined();
    expect(projected.passwordHash).toBeUndefined();
  });

  it('strips markup from the messaging recipient id before returning it', () => {
    const projected = safePublicSupplier(
      {
        id: 'sup_2',
        approved: true,
        name: 'Markup Supplier',
        ownerUserId: '<strong>user_markup</strong>',
      },
      { exposeMessagingRecipient: true }
    );

    expect(projected.ownerUserId).toBeUndefined();
    expect(projected.messagingRecipientId).toBe('user_markup');
  });
});
