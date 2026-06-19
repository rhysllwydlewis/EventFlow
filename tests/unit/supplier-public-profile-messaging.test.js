'use strict';

const { safePublicSupplier } = require('../../utils/supplierPublicProfile');
const { hydrateSupplierProfilePhoto } = require('../../utils/supplierProfilePhoto');

describe('safe public supplier messaging recipient projection', () => {
  it('keeps a sanitised ownerUserId for authenticated quick-compose recipient resolution', () => {
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

    const projected = safePublicSupplier(hydrated);

    expect(projected).toMatchObject({
      ownerUserId: 'user_owner',
      messagingRecipientId: 'user_owner',
    });
    expect(projected.contactEmail).toBeUndefined();
    expect(projected.ownerEmail).toBeUndefined();
    expect(projected.passwordHash).toBeUndefined();
  });

  it('strips markup from the messaging recipient id before returning it', () => {
    const projected = safePublicSupplier({
      id: 'sup_2',
      approved: true,
      name: 'Markup Supplier',
      ownerUserId: '<strong>user_markup</strong>',
    });

    expect(projected.ownerUserId).toBe('user_markup');
    expect(projected.messagingRecipientId).toBe('user_markup');
  });
});
