/**
 * Unit tests for feature flag middleware
 */

const { featureRequired, getFeatureFlags } = require('../../middleware/features');
const dbUnified = require('../../db-unified');

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

describe('Feature Flag Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFeatureFlags', () => {
    it('preserves existing defaults while keeping incomplete commercial features disabled', async () => {
      dbUnified.read.mockResolvedValue({});

      await expect(getFeatureFlags()).resolves.toEqual({
        registration: true,
        supplierApplications: true,
        reviews: true,
        photoUploads: true,
        supportTickets: true,
        pexelsCollage: false,
        photoAutoApprove: true,
        marketplaceAvailability: false,
        quoteBooking: false,
        bookingPayments: false,
      });
    });

    it('returns configured flags and prevents booking payments without quote booking', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: false,
          supplierApplications: true,
          reviews: false,
          photoUploads: true,
          supportTickets: false,
          pexelsCollage: true,
          marketplaceAvailability: true,
          quoteBooking: false,
          bookingPayments: true,
        },
      });

      const flags = await getFeatureFlags();

      expect(flags).toMatchObject({
        registration: false,
        supplierApplications: true,
        reviews: false,
        photoUploads: true,
        supportTickets: false,
        pexelsCollage: true,
        marketplaceAvailability: true,
        quoteBooking: false,
        bookingPayments: false,
      });
    });

    it('enables booking payments only when quote booking is also enabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          quoteBooking: true,
          bookingPayments: true,
        },
      });

      const flags = await getFeatureFlags();
      expect(flags.quoteBooking).toBe(true);
      expect(flags.bookingPayments).toBe(true);
    });

    it('uses safe fallback values when settings cannot be read', async () => {
      dbUnified.read.mockRejectedValue(new Error('Database error'));

      const flags = await getFeatureFlags();

      expect(flags.registration).toBe(true);
      expect(flags.reviews).toBe(true);
      expect(flags.marketplaceAvailability).toBe(false);
      expect(flags.quoteBooking).toBe(false);
      expect(flags.bookingPayments).toBe(false);
    });
  });

  describe('featureRequired middleware', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
      req = {};
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      next = jest.fn();
    });

    it('calls next when an existing feature is enabled', async () => {
      dbUnified.read.mockResolvedValue({ features: { registration: true } });

      await featureRequired('registration')(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 503 when an existing feature is disabled', async () => {
      dbUnified.read.mockResolvedValue({ features: { registration: false } });

      await featureRequired('registration')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The registration feature is currently disabled. Please try again later.',
        feature: 'registration',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it.each(['marketplaceAvailability', 'quoteBooking', 'bookingPayments'])(
      'keeps %s disabled when the flag is missing',
      async featureName => {
        dbUnified.read.mockResolvedValue({ features: {} });

        await featureRequired(featureName)(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Feature temporarily unavailable',
            feature: featureName,
          })
        );
        expect(next).not.toHaveBeenCalled();
      }
    );

    it('does not expose booking payments when quote booking is disabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          quoteBooking: false,
          bookingPayments: true,
        },
      });

      await featureRequired('bookingPayments')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('keeps commercial features disabled on database failure', async () => {
      dbUnified.read.mockRejectedValue(new Error('Database error'));

      await featureRequired('quoteBooking')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
