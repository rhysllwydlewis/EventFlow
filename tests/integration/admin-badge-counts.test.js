/**
 * Integration tests for badge-counts endpoint
 */

const fs = require('fs');
const path = require('path');

describe('Admin Badge Counts Endpoint', () => {
  let adminRoutesContent;
  let adminNavbarContent;

  beforeAll(() => {
    adminRoutesContent = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
    adminNavbarContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/admin-navbar.js'),
      'utf8'
    );
  });

  describe('GET /api/admin/badge-counts', () => {
    it('should exist in admin routes', () => {
      expect(adminRoutesContent).toContain("router.get('/badge-counts'");
      expect(adminRoutesContent).toContain('authRequired');
      expect(adminRoutesContent).toContain("roleRequired('admin')");
    });

    it('should return pending counts structure', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pending:');
      expect(badgeCountsSection).toContain('suppliers:');
      expect(badgeCountsSection).toContain('packages:');
      expect(badgeCountsSection).toContain('photos:');
      expect(badgeCountsSection).toContain('reviews:');
      expect(badgeCountsSection).toContain('reports:');
    });

    it('should return totals structure', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('totals');
    });

    it('should use dbUnified for data access', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('dbUnified.read');
    });

    it('should count pending suppliers', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pendingSuppliers');
      expect(badgeCountsSection).toContain('!s.approved');
    });

    it('should count pending packages', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pendingPackages');
      expect(badgeCountsSection).toContain("dbUnified.count('packages', { approved: false })");
    });

    it('should count pending photos the same way the photos moderation page does', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      // Must mirror GET /api/admin/photos/pending exactly: same 'photos'
      // collection, same status:'pending' filter, same photoAutoApprove gate.
      // (Counting unapproved supplier/package gallery entries here previously
      // disagreed with what the moderation page actually lists.)
      expect(badgeCountsSection).toContain('pendingPhotos');
      expect(badgeCountsSection).toContain('photoAutoApprove');
      expect(badgeCountsSection).toContain("dbUnified.read('photos')");
      expect(badgeCountsSection).toContain("p.status === 'pending'");
    });

    it('should count pending/flagged reviews', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pendingReviews');
      expect(badgeCountsSection).toContain("'pending'");
      expect(badgeCountsSection).toContain('flagged');
    });

    it('should count pending reports', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pendingReports');
    });

    it('should count auto-published locations awaiting review', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('pendingLocationsReview');
      expect(badgeCountsSection).toContain("managedBy === 'automation'");
      expect(badgeCountsSection).toContain('locations: pendingLocationsReview');
    });

    it('should handle errors gracefully', () => {
      const badgeCountsSection = adminRoutesContent.substring(
        adminRoutesContent.indexOf('GET /api/admin/badge-counts'),
        adminRoutesContent.indexOf('GET /api/admin/badge-counts') + 4500
      );

      expect(badgeCountsSection).toContain('catch');
      expect(badgeCountsSection).toContain('status(500)');
    });
  });

  describe('Frontend Integration - admin-navbar.js', () => {
    it('should call badge-counts endpoint', () => {
      expect(adminNavbarContent).toContain('/api/admin/badge-counts');
    });

    it('should handle pending suppliers badge', () => {
      expect(adminNavbarContent).toContain('navBadgeSuppliers');
      expect(adminNavbarContent).toContain('pending.suppliers');
    });

    it('should handle pending packages badge', () => {
      expect(adminNavbarContent).toContain('navBadgePackages');
      expect(adminNavbarContent).toContain('pending.packages');
    });

    it('should handle pending photos badge', () => {
      expect(adminNavbarContent).toContain('navBadgePhotos');
      expect(adminNavbarContent).toContain('pending.photos');
    });

    it('should handle pending reviews badge', () => {
      expect(adminNavbarContent).toContain('navBadgeReviews');
      expect(adminNavbarContent).toContain('pending.reviews');
    });

    it('should handle pending reports badge', () => {
      expect(adminNavbarContent).toContain('navBadgeReports');
      expect(adminNavbarContent).toContain('pending.reports');
    });

    it('should handle locations-needing-review badge', () => {
      expect(adminNavbarContent).toContain('navBadgeLocations');
      expect(adminNavbarContent).toContain('pending.locations');
    });

    it('should display errors to user', () => {
      const updateBadgeCountsSection = adminNavbarContent.substring(
        adminNavbarContent.indexOf('function updateBadgeCounts'),
        adminNavbarContent.indexOf('function updateBadgeCounts') + 5500
      );

      expect(updateBadgeCountsSection).toContain('catch');
      expect(updateBadgeCountsSection).toContain('navErrorContainer');
      expect(updateBadgeCountsSection).toContain('Failed to load badge counts');
    });

    it('should hide badges when count is zero', () => {
      const updateBadgeCountsSection = adminNavbarContent.substring(
        adminNavbarContent.indexOf('function updateBadgeCounts'),
        adminNavbarContent.indexOf('function updateBadgeCounts') + 5500
      );

      expect(updateBadgeCountsSection).toContain("style.display = 'none'");
    });

    it('should show badges when count is greater than zero', () => {
      const updateBadgeCountsSection = adminNavbarContent.substring(
        adminNavbarContent.indexOf('function updateBadgeCounts'),
        adminNavbarContent.indexOf('function updateBadgeCounts') + 5500
      );

      expect(updateBadgeCountsSection).toContain("style.display = 'flex'");
    });

    it('should handle HTTP errors with status code', () => {
      const updateBadgeCountsSection = adminNavbarContent.substring(
        adminNavbarContent.indexOf('function updateBadgeCounts'),
        adminNavbarContent.indexOf('function updateBadgeCounts') + 5500
      );

      expect(updateBadgeCountsSection).toContain('response.status');
      expect(updateBadgeCountsSection).toContain('HTTP');
    });

    it('should check for error in response data', () => {
      const updateBadgeCountsSection = adminNavbarContent.substring(
        adminNavbarContent.indexOf('function updateBadgeCounts'),
        adminNavbarContent.indexOf('function updateBadgeCounts') + 5500
      );

      expect(updateBadgeCountsSection).toContain('data.error');
    });
  });
});
