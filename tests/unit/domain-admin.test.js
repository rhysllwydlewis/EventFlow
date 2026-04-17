/**
 * Unit Tests for Domain-Based Admin Authentication Middleware
 * Tests domain validation, role determination, and owner checks
 */

'use strict';

const domainAdmin = require('../../middleware/domain-admin');

// Store original env vars to restore after tests
const originalEnv = { ...process.env };

describe('Domain-Admin Middleware', () => {
  beforeEach(() => {
    // Reset to defaults before each test
    delete process.env.OWNER_EMAIL;
    delete process.env.ADMIN_DOMAINS;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('isOwnerEmail', () => {
    it('should return true for default owner email', () => {
      const result = domainAdmin.isOwnerEmail('admin@event-flow.co.uk');
      expect(result).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(domainAdmin.isOwnerEmail('ADMIN@event-flow.co.uk')).toBe(true);
      expect(domainAdmin.isOwnerEmail('Admin@Event-Flow.Co.Uk')).toBe(true);
    });

    // Testing custom OWNER_EMAIL requires reloading the middleware because
    // `OWNER_EMAIL` is captured at require-time. `jest.isolateModules` gives
    // us a clean module registry scoped to this test only.
    it('should handle custom owner email from env (reload via isolateModules)', () => {
      process.env.OWNER_EMAIL = 'custom-owner@vexi.example';
      jest.isolateModules(() => {
        const reloaded = require('../../middleware/domain-admin');
        expect(reloaded.isOwnerEmail('custom-owner@vexi.example')).toBe(true);
        expect(reloaded.isOwnerEmail('CUSTOM-OWNER@vexi.example')).toBe(true);
        // Default owner no longer matches once overridden
        expect(reloaded.isOwnerEmail('admin@event-flow.co.uk')).toBe(false);
      });
      delete process.env.OWNER_EMAIL;
    });

    it('should return false for non-owner emails', () => {
      expect(domainAdmin.isOwnerEmail('user@example.com')).toBe(false);
      expect(domainAdmin.isOwnerEmail('test@event-flow.co.uk')).toBe(false);
    });

    it('should handle null/undefined gracefully', () => {
      expect(domainAdmin.isOwnerEmail(null)).toBe(false);
      expect(domainAdmin.isOwnerEmail(undefined)).toBe(false);
      expect(domainAdmin.isOwnerEmail('')).toBe(false);
    });
  });

  describe('isAdminDomain', () => {
    beforeEach(() => {
      process.env.ADMIN_DOMAINS = 'event-flow.co.uk,example.com';
    });

    it('should return true for emails from admin domains', () => {
      expect(domainAdmin.isAdminDomain('user@event-flow.co.uk')).toBe(true);
      expect(domainAdmin.isAdminDomain('admin@example.com')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(domainAdmin.isAdminDomain('User@Event-Flow.Co.Uk')).toBe(true);
      expect(domainAdmin.isAdminDomain('ADMIN@EXAMPLE.COM')).toBe(true);
    });

    it('should return false for non-admin domains', () => {
      expect(domainAdmin.isAdminDomain('user@other.com')).toBe(false);
      expect(domainAdmin.isAdminDomain('test@gmail.com')).toBe(false);
    });

    it('should handle subdomains correctly (no match)', () => {
      // Subdomains should NOT match - exact domain only
      expect(domainAdmin.isAdminDomain('user@sub.example.com')).toBe(false);
      expect(domainAdmin.isAdminDomain('user@mail.event-flow.co.uk')).toBe(false);
    });

    it('should return false when no admin domains configured', () => {
      delete process.env.ADMIN_DOMAINS;
      expect(domainAdmin.isAdminDomain('user@event-flow.co.uk')).toBe(false);
    });

    it('should handle invalid emails gracefully', () => {
      expect(domainAdmin.isAdminDomain('notanemail')).toBe(false);
      expect(domainAdmin.isAdminDomain(null)).toBe(false);
      expect(domainAdmin.isAdminDomain(undefined)).toBe(false);
      expect(domainAdmin.isAdminDomain('')).toBe(false);
    });
  });

  describe('determineRole', () => {
    beforeEach(() => {
      process.env.ADMIN_DOMAINS = 'event-flow.co.uk';
    });

    describe('owner email', () => {
      it('should always return admin role for owner', () => {
        const result = domainAdmin.determineRole('admin@event-flow.co.uk', 'customer', false);
        expect(result.role).toBe('admin');
        expect(result.shouldUpgrade).toBe(true);
        expect(result.reason).toBe('owner_email');
      });

      it('should return admin regardless of verification status', () => {
        const unverified = domainAdmin.determineRole('admin@event-flow.co.uk', 'customer', false);
        const verified = domainAdmin.determineRole('admin@event-flow.co.uk', 'customer', true);
        expect(unverified.role).toBe('admin');
        expect(verified.role).toBe('admin');
      });
    });

    describe('admin domain - unverified', () => {
      it('should return requested role when not verified', () => {
        const result = domainAdmin.determineRole('user@event-flow.co.uk', 'customer', false);
        expect(result.role).toBe('customer');
        expect(result.shouldUpgrade).toBe(false);
        expect(result.willUpgradeOnVerification).toBe(true);
        expect(result.reason).toBe('admin_domain_pending_verification');
      });

      it('should preserve supplier role when not verified', () => {
        const result = domainAdmin.determineRole('user@event-flow.co.uk', 'supplier', false);
        expect(result.role).toBe('supplier');
        expect(result.willUpgradeOnVerification).toBe(true);
      });
    });

    describe('admin domain - verified', () => {
      it('should return admin role when verified', () => {
        const result = domainAdmin.determineRole('user@event-flow.co.uk', 'customer', true);
        expect(result.role).toBe('admin');
        expect(result.shouldUpgrade).toBe(true);
        expect(result.reason).toBe('admin_domain_verified');
      });
    });

    describe('regular user', () => {
      it('should return requested role', () => {
        const customer = domainAdmin.determineRole('user@gmail.com', 'customer', false);
        expect(customer.role).toBe('customer');
        expect(customer.shouldUpgrade).toBe(false);
        expect(customer.reason).toBe('regular_user');

        const supplier = domainAdmin.determineRole('user@gmail.com', 'supplier', true);
        expect(supplier.role).toBe('supplier');
        expect(supplier.shouldUpgrade).toBe(false);
      });

      it('should default to customer if no role provided', () => {
        const result = domainAdmin.determineRole('user@gmail.com', null, false);
        expect(result.role).toBe('customer');
      });
    });
  });

  describe('shouldUpgradeToAdminOnVerification', () => {
    beforeEach(() => {
      process.env.ADMIN_DOMAINS = 'event-flow.co.uk';
    });

    it('should return true for admin domain emails', () => {
      expect(domainAdmin.shouldUpgradeToAdminOnVerification('user@event-flow.co.uk')).toBe(true);
    });

    it('should return false for owner email (already admin)', () => {
      expect(domainAdmin.shouldUpgradeToAdminOnVerification('admin@event-flow.co.uk')).toBe(false);
    });

    it('should return false for regular domains', () => {
      expect(domainAdmin.shouldUpgradeToAdminOnVerification('user@gmail.com')).toBe(false);
    });

    it('should return false when no admin domains configured', () => {
      delete process.env.ADMIN_DOMAINS;
      expect(domainAdmin.shouldUpgradeToAdminOnVerification('user@event-flow.co.uk')).toBe(false);
    });
  });

  describe('validateAdminDomainsFormat', () => {
    it('should accept valid single domain', () => {
      process.env.ADMIN_DOMAINS = 'example.com';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(true);
    });

    it('should accept valid multiple domains', () => {
      process.env.ADMIN_DOMAINS = 'example.com,test.org,another.co.uk';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(true);
    });

    it('should accept empty/unset domains', () => {
      delete process.env.ADMIN_DOMAINS;
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(true);
    });

    it('should reject wildcards', () => {
      process.env.ADMIN_DOMAINS = '*.example.com';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Wildcards not allowed');
    });

    it('should reject domains with protocols', () => {
      process.env.ADMIN_DOMAINS = 'https://example.com';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('protocol');
    });

    it('should reject domains starting with dot', () => {
      process.env.ADMIN_DOMAINS = '.example.com';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot start or end with dot');
    });

    it('should reject domains ending with dot', () => {
      process.env.ADMIN_DOMAINS = 'example.com.';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot start or end with dot');
    });

    it('should reject invalid domain format (no dot)', () => {
      process.env.ADMIN_DOMAINS = 'localhost';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });

    it('should reject domains with spaces', () => {
      process.env.ADMIN_DOMAINS = 'exam ple.com';
      const result = domainAdmin.validateAdminDomainsFormat();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });
  });

  describe('getOwnerEmail', () => {
    it('should return default owner email', () => {
      const email = domainAdmin.getOwnerEmail();
      expect(email).toBe('admin@event-flow.co.uk');
    });

    // See comment on the isOwnerEmail custom-env test above for the
    // rationale — `OWNER_EMAIL` is captured at require-time.
    it('should return custom owner email from env (reload via isolateModules)', () => {
      process.env.OWNER_EMAIL = 'owner-from-env@vexi.example';
      jest.isolateModules(() => {
        const reloaded = require('../../middleware/domain-admin');
        expect(reloaded.getOwnerEmail()).toBe('owner-from-env@vexi.example');
      });
      delete process.env.OWNER_EMAIL;
    });
  });

  describe('getAdminDomainsList', () => {
    it('should return empty array when not configured', () => {
      delete process.env.ADMIN_DOMAINS;
      const domains = domainAdmin.getAdminDomainsList();
      expect(domains).toEqual([]);
    });

    it('should return single domain as array', () => {
      process.env.ADMIN_DOMAINS = 'example.com';
      const domains = domainAdmin.getAdminDomainsList();
      expect(domains).toEqual(['example.com']);
    });

    it('should return multiple domains as array', () => {
      process.env.ADMIN_DOMAINS = 'example.com,test.org';
      const domains = domainAdmin.getAdminDomainsList();
      expect(domains).toEqual(['example.com', 'test.org']);
    });

    it('should trim whitespace from domains', () => {
      process.env.ADMIN_DOMAINS = 'example.com , test.org  ,  another.com';
      const domains = domainAdmin.getAdminDomainsList();
      expect(domains).toEqual(['example.com', 'test.org', 'another.com']);
    });

    it('should convert to lowercase', () => {
      process.env.ADMIN_DOMAINS = 'Example.COM,Test.ORG';
      const domains = domainAdmin.getAdminDomainsList();
      expect(domains).toEqual(['example.com', 'test.org']);
    });
  });

  describe('Integration scenarios', () => {
    beforeEach(() => {
      // Note: Can't test custom OWNER_EMAIL without module reload
      // Using default owner email for these tests
      process.env.ADMIN_DOMAINS = 'event-flow.co.uk,partner.com';
    });

    it('should handle complete registration flow for owner', () => {
      // Using default owner email (admin@event-flow.co.uk)
      // Step 1: Determine role during registration (not verified)
      const regRole = domainAdmin.determineRole('admin@event-flow.co.uk', 'customer', false);
      expect(regRole.role).toBe('admin');
      expect(regRole.shouldUpgrade).toBe(true);

      // Step 2: Check if should upgrade on verification (no, already admin)
      const shouldUpgrade =
        domainAdmin.shouldUpgradeToAdminOnVerification('admin@event-flow.co.uk');
      expect(shouldUpgrade).toBe(false);
    });

    it('should handle complete registration flow for admin domain', () => {
      // Step 1: Determine role during registration (not verified)
      const regRole = domainAdmin.determineRole('user@event-flow.co.uk', 'customer', false);
      expect(regRole.role).toBe('customer');
      expect(regRole.willUpgradeOnVerification).toBe(true);

      // Step 2: Check if should upgrade on verification (yes)
      const shouldUpgrade = domainAdmin.shouldUpgradeToAdminOnVerification('user@event-flow.co.uk');
      expect(shouldUpgrade).toBe(true);

      // Step 3: Determine role after verification
      const verifiedRole = domainAdmin.determineRole('user@event-flow.co.uk', 'customer', true);
      expect(verifiedRole.role).toBe('admin');
      expect(verifiedRole.shouldUpgrade).toBe(true);
    });

    it('should handle complete registration flow for regular user', () => {
      // Step 1: Determine role during registration
      const regRole = domainAdmin.determineRole('user@gmail.com', 'supplier', false);
      expect(regRole.role).toBe('supplier');
      expect(regRole.willUpgradeOnVerification).toBeFalsy();

      // Step 2: Check if should upgrade on verification (no)
      const shouldUpgrade = domainAdmin.shouldUpgradeToAdminOnVerification('user@gmail.com');
      expect(shouldUpgrade).toBe(false);

      // Step 3: Determine role after verification (unchanged)
      const verifiedRole = domainAdmin.determineRole('user@gmail.com', 'supplier', true);
      expect(verifiedRole.role).toBe('supplier');
      expect(verifiedRole.shouldUpgrade).toBe(false);
    });
  });
});
