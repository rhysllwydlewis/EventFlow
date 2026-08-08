/**
 * Unit tests for RBAC Permission System
 * Tests permission checking, caching, and role definitions
 */

const {
  PERMISSIONS,
  ROLES,
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  clearPermissionCache,
  getPermissionCacheStats,
} = require('../../middleware/permissions');

describe('RBAC Permission System', () => {
  // Mock users
  const ownerUser = {
    id: 'usr_owner_123',
    email: 'admin@event-flow.co.uk',
    role: 'admin',
    isOwner: true,
  };

  const adminUser = {
    id: 'usr_admin_456',
    email: 'admin@example.com',
    role: 'admin',
  };

  const moderatorUser = {
    id: 'usr_mod_789',
    email: 'moderator@example.com',
    role: 'moderator',
  };

  const supportUser = {
    id: 'usr_support_101',
    email: 'support@example.com',
    role: 'support',
  };

  const customerUser = {
    id: 'usr_customer_202',
    email: 'customer@example.com',
    role: 'customer',
  };

  beforeEach(() => {
    // Clear cache before each test
    clearPermissionCache();
  });

  describe('Permission Definitions', () => {
    it('should have all required permission categories', () => {
      expect(PERMISSIONS).toHaveProperty('USERS_READ');
      expect(PERMISSIONS).toHaveProperty('SUPPLIERS_READ');
      expect(PERMISSIONS).toHaveProperty('PACKAGES_READ');
      expect(PERMISSIONS).toHaveProperty('REVIEWS_READ');
      expect(PERMISSIONS).toHaveProperty('PHOTOS_READ');
      expect(PERMISSIONS).toHaveProperty('SYSTEM_AUDIT_LOG');
      expect(PERMISSIONS).toHaveProperty('AUDIT_READ');
    });

    it('should have properly formatted permission strings', () => {
      Object.values(PERMISSIONS).forEach(permission => {
        expect(permission).toMatch(/^admin:[a-z]+:[a-z-]+$/);
      });
    });
  });

  describe('Role Definitions', () => {
    it('should have all required roles', () => {
      expect(ROLES).toHaveProperty('owner');
      expect(ROLES).toHaveProperty('admin');
      expect(ROLES).toHaveProperty('moderator');
      expect(ROLES).toHaveProperty('support');
    });

    it('should have owner role with all permissions', () => {
      const ownerRole = ROLES.owner;
      expect(ownerRole.permissions).toEqual(Object.values(PERMISSIONS));
      expect(ownerRole.canBeRevoked).toBe(false);
    });

    it('should have admin role with all permissions', () => {
      const adminRole = ROLES.admin;
      expect(adminRole.permissions).toEqual(Object.values(PERMISSIONS));
      expect(adminRole.canBeRevoked).toBe(true);
    });

    it('should have moderator role with limited permissions', () => {
      const moderatorRole = ROLES.moderator;
      expect(moderatorRole.permissions).toContain(PERMISSIONS.REVIEWS_READ);
      expect(moderatorRole.permissions).toContain(PERMISSIONS.PHOTOS_APPROVE);
      expect(moderatorRole.permissions).not.toContain(PERMISSIONS.USERS_DELETE);
    });

    it('should have support role with read-only permissions', () => {
      const supportRole = ROLES.support;
      expect(supportRole.permissions).toContain(PERMISSIONS.USERS_READ);
      expect(supportRole.permissions).toContain(PERMISSIONS.AUDIT_READ);
      expect(supportRole.permissions).not.toContain(PERMISSIONS.USERS_UPDATE);
    });
  });

  describe('getUserPermissions', () => {
    it('should return empty set for null user', () => {
      const permissions = getUserPermissions(null);
      expect(permissions.size).toBe(0);
    });

    it('should return all permissions for owner', () => {
      const permissions = getUserPermissions(ownerUser);
      expect(permissions.size).toBe(Object.values(PERMISSIONS).length);
    });

    it('should return all permissions for admin', () => {
      const permissions = getUserPermissions(adminUser);
      expect(permissions.size).toBe(Object.values(PERMISSIONS).length);
    });

    it('should return limited permissions for moderator', () => {
      const permissions = getUserPermissions(moderatorUser);
      expect(permissions.has(PERMISSIONS.REVIEWS_READ)).toBe(true);
      expect(permissions.has(PERMISSIONS.USERS_DELETE)).toBe(false);
    });

    it('should return read-only permissions for support', () => {
      const permissions = getUserPermissions(supportUser);
      expect(permissions.has(PERMISSIONS.USERS_READ)).toBe(true);
      expect(permissions.has(PERMISSIONS.USERS_UPDATE)).toBe(false);
    });

    it('should return empty permissions for customer', () => {
      const permissions = getUserPermissions(customerUser);
      expect(permissions.size).toBe(0);
    });

    it('should include custom permissions', () => {
      const userWithCustomPerms = {
        ...customerUser,
        customPermissions: [PERMISSIONS.REVIEWS_READ],
      };

      const permissions = getUserPermissions(userWithCustomPerms);
      expect(permissions.has(PERMISSIONS.REVIEWS_READ)).toBe(true);
    });

    it('should cache permissions after first call', () => {
      const firstCall = getUserPermissions(adminUser);
      const secondCall = getUserPermissions(adminUser);

      expect(firstCall).toEqual(secondCall);

      const stats = getPermissionCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('hasPermission', () => {
    it('should return false for null user', () => {
      expect(hasPermission(null, PERMISSIONS.USERS_READ)).toBe(false);
    });

    it('should always return true for owner', () => {
      expect(hasPermission(ownerUser, PERMISSIONS.USERS_DELETE)).toBe(true);
      expect(hasPermission(ownerUser, PERMISSIONS.PACKAGES_DELETE)).toBe(true);
    });

    it('should return true for admin with any permission', () => {
      expect(hasPermission(adminUser, PERMISSIONS.USERS_READ)).toBe(true);
      expect(hasPermission(adminUser, PERMISSIONS.SUPPLIERS_UPDATE)).toBe(true);
    });

    it('should return true for moderator with review permissions', () => {
      expect(hasPermission(moderatorUser, PERMISSIONS.REVIEWS_READ)).toBe(true);
      expect(hasPermission(moderatorUser, PERMISSIONS.REVIEWS_APPROVE)).toBe(true);
    });

    it('should return false for moderator without user permissions', () => {
      expect(hasPermission(moderatorUser, PERMISSIONS.USERS_DELETE)).toBe(false);
    });

    it('should return true for support with read permissions', () => {
      expect(hasPermission(supportUser, PERMISSIONS.USERS_READ)).toBe(true);
      expect(hasPermission(supportUser, PERMISSIONS.AUDIT_READ)).toBe(true);
    });

    it('should return false for support with write permissions', () => {
      expect(hasPermission(supportUser, PERMISSIONS.USERS_UPDATE)).toBe(false);
    });

    it('should return false for customer with any permission', () => {
      expect(hasPermission(customerUser, PERMISSIONS.USERS_READ)).toBe(false);
    });

    it('should respect custom permissions', () => {
      const userWithCustomPerm = {
        ...customerUser,
        customPermissions: [PERMISSIONS.REVIEWS_READ],
      };

      expect(hasPermission(userWithCustomPerm, PERMISSIONS.REVIEWS_READ)).toBe(true);
      expect(hasPermission(userWithCustomPerm, PERMISSIONS.USERS_READ)).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return false for null user', () => {
      expect(hasAnyPermission(null, [PERMISSIONS.USERS_READ])).toBe(false);
    });

    it('should return true if user has at least one permission', () => {
      expect(
        hasAnyPermission(moderatorUser, [PERMISSIONS.REVIEWS_READ, PERMISSIONS.USERS_DELETE])
      ).toBe(true);
    });

    it('should return false if user has none of the permissions', () => {
      expect(
        hasAnyPermission(moderatorUser, [PERMISSIONS.USERS_DELETE, PERMISSIONS.SUPPLIERS_DELETE])
      ).toBe(false);
    });

    it('should always return true for owner', () => {
      expect(hasAnyPermission(ownerUser, [PERMISSIONS.USERS_DELETE])).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return false for null user', () => {
      expect(hasAllPermissions(null, [PERMISSIONS.USERS_READ])).toBe(false);
    });

    it('should return true if user has all permissions', () => {
      expect(hasAllPermissions(adminUser, [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_UPDATE])).toBe(
        true
      );
    });

    it('should return false if user is missing any permission', () => {
      expect(
        hasAllPermissions(moderatorUser, [PERMISSIONS.REVIEWS_READ, PERMISSIONS.USERS_DELETE])
      ).toBe(false);
    });

    it('should always return true for owner', () => {
      expect(
        hasAllPermissions(ownerUser, [PERMISSIONS.USERS_DELETE, PERMISSIONS.SUPPLIERS_DELETE])
      ).toBe(true);
    });
  });

  describe('Permission Cache', () => {
    it('should cache user permissions', () => {
      getUserPermissions(adminUser);

      const stats = getPermissionCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should clear cache for all users', () => {
      getUserPermissions(adminUser);
      getUserPermissions(moderatorUser);

      clearPermissionCache();

      const stats = getPermissionCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should clear cache for specific user', () => {
      getUserPermissions(adminUser);
      getUserPermissions(moderatorUser);

      clearPermissionCache(adminUser.id);

      const stats = getPermissionCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should return cached permissions on subsequent calls', () => {
      const firstCall = getUserPermissions(adminUser);
      const secondCall = getUserPermissions(adminUser);

      // Should be the same object (cached)
      expect(Array.from(firstCall)).toEqual(Array.from(secondCall));
    });
  });

  describe('Edge Cases', () => {
    it('should handle user with undefined role', () => {
      const userWithNoRole = {
        id: 'usr_norole',
        email: 'test@example.com',
      };

      const permissions = getUserPermissions(userWithNoRole);
      expect(permissions.size).toBe(0);
    });

    it('should handle user with invalid role', () => {
      const userWithInvalidRole = {
        id: 'usr_invalid',
        email: 'test@example.com',
        role: 'invalid_role',
      };

      const permissions = getUserPermissions(userWithInvalidRole);
      expect(permissions.size).toBe(0);
    });

    it('should handle empty customPermissions array', () => {
      const userWithEmptyCustom = {
        ...customerUser,
        customPermissions: [],
      };

      const permissions = getUserPermissions(userWithEmptyCustom);
      expect(permissions.size).toBe(0);
    });

    it('should handle null customPermissions', () => {
      const userWithNullCustom = {
        ...customerUser,
        customPermissions: null,
      };

      const permissions = getUserPermissions(userWithNullCustom);
      expect(permissions.size).toBe(0);
    });

    it('should detect owner by email (case insensitive)', () => {
      const ownerByEmail = {
        id: 'usr_owner2',
        email: 'ADMIN@EVENT-FLOW.CO.UK',
        role: 'customer',
      };

      expect(hasPermission(ownerByEmail, PERMISSIONS.USERS_DELETE)).toBe(true);
    });

    it('should detect owner by isOwner flag', () => {
      const ownerByFlag = {
        id: 'usr_owner3',
        email: 'other@example.com',
        role: 'customer',
        isOwner: true,
      };

      expect(hasPermission(ownerByFlag, PERMISSIONS.USERS_DELETE)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle large number of permission checks efficiently', () => {
      const startTime = Date.now();

      // Perform 1000 permission checks
      for (let i = 0; i < 1000; i++) {
        hasPermission(adminUser, PERMISSIONS.USERS_READ);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in under 100ms due to caching
      expect(duration).toBeLessThan(100);
    });

    it('should serve repeated calls from the cache rather than recomputing', () => {
      // Wall-clock timing comparisons between two near-instantaneous calls
      // are dominated by millisecond quantization and CI scheduler/GC jitter
      // (flaky under load — see git history), not by whether the cache was
      // actually used. Assert the cache's real, observable effect instead:
      // a cached result keeps reflecting the role it was computed for even
      // after the user object's role changes, until the cache is cleared.
      clearPermissionCache();
      const user = { id: 'usr_cache_behaviour_test', email: 'cache@example.com', role: 'admin' };

      const firstCall = getUserPermissions(user);
      expect(getPermissionCacheStats().size).toBeGreaterThan(0);

      user.role = 'moderator';
      const secondCall = getUserPermissions(user);
      expect(secondCall).toEqual(firstCall);

      clearPermissionCache();
      const thirdCall = getUserPermissions(user);
      expect(thirdCall).not.toEqual(firstCall);
    });
  });
});
