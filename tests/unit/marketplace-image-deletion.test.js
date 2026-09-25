/**
 * Tests for marketplace image deletion functionality
 * Verifies that images are properly cleaned up when listings are deleted
 */

// "MongoDB is not available" has to be simulated, not left to whatever the
// environment happens to do: deleteMarketplaceImages only returns 0 quickly
// when db.isMongoAvailable() itself says no. If a real MONGODB_URI happens to
// be set (true in some environments, including CI) but the host is
// unreachable, isMongoAvailable() reports true anyway — it checks
// configuration, not connectivity — so the function goes on to attempt a real
// connection with a 30s server-selection timeout and up to 3 retries before
// its own catch block returns 0, which starved this test past Jest's default
// timeout. Mocking the module keeps this a fast, deterministic unit test of
// the documented "not available" path, matching the same convention used in
// tests/integration/photo-upload-integration.test.js.
jest.mock('../../db', () => ({
  isMongoAvailable: jest.fn().mockResolvedValue(false),
  getDb: jest.fn(),
}));

describe('Marketplace Image Deletion', () => {
  test('deleteImage function should be exported from photo-upload', () => {
    const photoUpload = require('../../photo-upload');
    expect(typeof photoUpload.deleteImage).toBe('function');
  });

  test('deleteMarketplaceImages function should be exported from photo-upload', () => {
    const photoUpload = require('../../photo-upload');
    expect(typeof photoUpload.deleteMarketplaceImages).toBe('function');
  });

  test('deleteMarketplaceImages should return 0 when MongoDB is not available', async () => {
    const photoUpload = require('../../photo-upload');

    // db.isMongoAvailable() is mocked to resolve false above, so this hits
    // the fast "not available" branch without attempting any connection.
    const deletedCount = await photoUpload.deleteMarketplaceImages('test-listing-123');

    expect(deletedCount).toBe(0);
  });
});

describe('Marketplace Routes - Image Cleanup', () => {
  test('DELETE /listings/:id route exists in marketplace routes', () => {
    const fs = require('fs');
    const path = require('path');
    const marketplaceRoutes = fs.readFileSync(
      path.join(__dirname, '../../routes/marketplace.js'),
      'utf8'
    );

    // Verify the route exists
    expect(marketplaceRoutes).toContain('router.delete');
    expect(marketplaceRoutes).toContain('/listings/:id');

    // Verify it calls deleteMarketplaceImages
    expect(marketplaceRoutes).toContain('deleteMarketplaceImages');
    expect(marketplaceRoutes).toContain('deletedImageCount');
  });
});

describe('Admin Routes - Marketplace Image Cleanup', () => {
  test('DELETE /marketplace/listings/:id admin endpoint exists', () => {
    const fs = require('fs');
    const path = require('path');
    const adminRoutes = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');

    // Verify the admin delete endpoint exists
    expect(adminRoutes).toContain('router.delete');
    expect(adminRoutes).toContain('/marketplace/listings/:id');

    // Verify it has proper authorization
    expect(adminRoutes).toContain('authRequired');
    expect(adminRoutes).toContain("roleRequired('admin')");

    // Verify it calls deleteMarketplaceImages
    expect(adminRoutes).toContain('deleteMarketplaceImages');

    // Verify it has audit logging
    expect(adminRoutes).toContain('auditLog');
    expect(adminRoutes).toContain('marketplace_listing_deleted');
  });
});

describe('Photo Upload - deleteImage Function', () => {
  test('deleteImage should be enhanced to check marketplace_images collection', () => {
    const fs = require('fs');
    const path = require('path');
    const photoUpload = fs.readFileSync(path.join(__dirname, '../../photo-upload.js'), 'utf8');

    // Verify it checks marketplace_images collection
    expect(photoUpload).toContain("collection('marketplace_images')");

    // Verify it falls back to photos collection
    expect(photoUpload).toContain("collection('photos')");

    // Verify it has proper logging
    expect(photoUpload).toContain('logger.info');
    expect(photoUpload).toContain('Deleted marketplace image');
  });
});
