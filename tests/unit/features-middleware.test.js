/**
 * Unit tests for feature flag middleware
 */

const { featureRequired, getFeatureFlags } = require('../../middleware/features');
const dbUnified = require('../../db-unified');

// Mock dbUnified
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

describe('Feature Flag Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFeatureFlags', () => {
    it('should return all features enabled by default', async () => {
      dbUnified.read.mockResolvedValue({});

      const flags = await getFeatureFlags();

      expect(flags).toEqual({
        registration: true,
        supplierApplications: true,
        reviews: true,
        photoUploads: true,
        supportTickets: true,
        pexelsCollage: false,
        photoAutoApprove: true,
      });
    });

    it('should return feature flags from settings', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: false,
          supplierApplications: true,
          reviews: false,
          photoUploads: true,
          supportTickets: false,
          pexelsCollage: true,
        },
      });

      const flags = await getFeatureFlags();

      expect(flags.registration).toBe(false);
      expect(flags.supplierApplications).toBe(true);
      expect(flags.reviews).toBe(false);
      expect(flags.photoUploads).toBe(true);
      expect(flags.supportTickets).toBe(false);
      expect(flags.pexelsCollage).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      dbUnified.read.mockRejectedValue(new Error('Database error'));

      const flags = await getFeatureFlags();

      // Should return all features enabled as fallback
      expect(flags.registration).toBe(true);
      expect(flags.supplierApplications).toBe(true);
      expect(flags.reviews).toBe(true);
      expect(flags.photoUploads).toBe(true);
      expect(flags.supportTickets).toBe(true);
    });

    it('should treat undefined features as enabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: undefined,
        },
      });

      const flags = await getFeatureFlags();

      expect(flags.registration).toBe(true);
    });

    it('should treat null features as enabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: null,
        },
      });

      const flags = await getFeatureFlags();

      expect(flags.registration).toBe(true);
    });
  });

  describe('featureRequired middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {};
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      next = jest.fn();
    });

    it('should call next() when feature is enabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: true,
        },
      });

      const middleware = featureRequired('registration');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should return 503 when feature is disabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          registration: false,
        },
      });

      const middleware = featureRequired('registration');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The registration feature is currently disabled. Please try again later.',
        feature: 'registration',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle reviews feature flag', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          reviews: false,
        },
      });

      const middleware = featureRequired('reviews');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The reviews feature is currently disabled. Please try again later.',
        feature: 'reviews',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle photoUploads feature flag', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          photoUploads: false,
        },
      });

      const middleware = featureRequired('photoUploads');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The photoUploads feature is currently disabled. Please try again later.',
        feature: 'photoUploads',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle supportTickets feature flag', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          supportTickets: false,
        },
      });

      const middleware = featureRequired('supportTickets');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The supportTickets feature is currently disabled. Please try again later.',
        feature: 'supportTickets',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle supplierApplications feature flag', async () => {
      dbUnified.read.mockResolvedValue({
        features: {
          supplierApplications: false,
        },
      });

      const middleware = featureRequired('supplierApplications');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Feature temporarily unavailable',
        message: 'The supplierApplications feature is currently disabled. Please try again later.',
        feature: 'supplierApplications',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() on database error to prevent breaking site', async () => {
      dbUnified.read.mockRejectedValue(new Error('Database error'));

      const middleware = featureRequired('registration');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should treat missing feature flag as enabled', async () => {
      dbUnified.read.mockResolvedValue({
        features: {},
      });

      const middleware = featureRequired('registration');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
