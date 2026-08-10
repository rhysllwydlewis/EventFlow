/**
 * checkPhotoAllowance (routes/photos.js) must not count photos hidden by a
 * plan downgrade (subscriptionService.enforcePhotoGalleryLimit sets
 * hiddenByPlanLimit: true rather than deleting them) toward the allowance —
 * otherwise a supplier who downgraded could never upload again without first
 * manually deleting old photos, unlike a paused package which doesn't count
 * toward the active package limit either.
 */
'use strict';

jest.mock('../../services/subscriptionService', () => ({
  getPhotoAllowance: jest.fn(),
}));

const subscriptionService = require('../../services/subscriptionService');
const { checkPhotoAllowance } = require('../../routes/photos');

describe('checkPhotoAllowance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts only visible photos toward the allowance', async () => {
    subscriptionService.getPhotoAllowance.mockResolvedValue(10);
    const supplier = {
      ownerUserId: 'usr-1',
      photosGallery: [
        ...Array.from({ length: 10 }, () => ({ url: 'visible.jpg' })),
        ...Array.from({ length: 5 }, () => ({ url: 'hidden.jpg', hiddenByPlanLimit: true })),
      ],
    };

    const result = await checkPhotoAllowance(supplier, 1);

    expect(result.current).toBe(10);
    expect(result.allowed).toBe(false);
  });

  it('allows a new upload once hidden photos are excluded from the count', async () => {
    subscriptionService.getPhotoAllowance.mockResolvedValue(10);
    const supplier = {
      ownerUserId: 'usr-1',
      photosGallery: [
        ...Array.from({ length: 8 }, () => ({ url: 'visible.jpg' })),
        ...Array.from({ length: 20 }, () => ({ url: 'hidden.jpg', hiddenByPlanLimit: true })),
      ],
    };

    const result = await checkPhotoAllowance(supplier, 1);

    expect(result.current).toBe(8);
    expect(result.allowed).toBe(true);
  });

  it('always allows uploads on an unlimited plan regardless of hidden photos', async () => {
    subscriptionService.getPhotoAllowance.mockResolvedValue(-1);
    const supplier = {
      ownerUserId: 'usr-1',
      photosGallery: [{ url: 'hidden.jpg', hiddenByPlanLimit: true }],
    };

    const result = await checkPhotoAllowance(supplier, 5);

    expect(result.allowed).toBe(true);
  });
});
