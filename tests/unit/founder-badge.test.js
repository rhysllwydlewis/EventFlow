/**
 * Unit tests for founder badge functionality
 */

describe('Founder Badge Logic', () => {
  // Helper function to determine if a user should receive founder badge
  function shouldReceiveFounderBadge(createdAt, launchTimestamp) {
    const launchDate = new Date(launchTimestamp);
    const founderEndDate = new Date(launchDate);
    founderEndDate.setUTCMonth(founderEndDate.getUTCMonth() + 6); // 6 months from launch

    const userCreatedDate = new Date(createdAt);
    return userCreatedDate <= founderEndDate;
  }

  describe('Badge Eligibility', () => {
    const launchTs = '2026-01-01T00:00:00Z';

    it('should award founder badge to user registered on launch day', () => {
      const createdAt = '2026-01-01T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(true);
    });

    it('should award founder badge to user registered 1 day after launch', () => {
      const createdAt = '2026-01-02T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(true);
    });

    it('should award founder badge to user registered 5 months after launch', () => {
      const createdAt = '2026-06-01T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(true);
    });

    it('should award founder badge to user registered exactly 6 months after launch', () => {
      const createdAt = '2026-07-01T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(true);
    });

    it('should NOT award founder badge to user registered 6 months + 1 day after launch', () => {
      const createdAt = '2026-07-02T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(false);
    });

    it('should NOT award founder badge to user registered 1 year after launch', () => {
      const createdAt = '2027-01-01T00:00:00Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(false);
    });

    it('should allow founder badge to user registered before launch (already committed users)', () => {
      const createdAt = '2025-12-31T23:59:59Z';
      const shouldReceive = shouldReceiveFounderBadge(createdAt, launchTs);
      expect(shouldReceive).toBe(true); // Users who registered before launch can also be founders
    });
  });

  describe('Badge Data Structure', () => {
    it('should have founder badge in badges array', () => {
      const user = {
        id: 'usr_123',
        email: 'test@example.com',
        badges: ['founder'],
      };

      expect(user.badges).toContain('founder');
      expect(user.badges.length).toBe(1);
    });

    it('should allow multiple badges', () => {
      const user = {
        id: 'usr_123',
        email: 'test@example.com',
        badges: ['founder', 'verified', 'pro'],
      };

      expect(user.badges).toContain('founder');
      expect(user.badges).toContain('verified');
      expect(user.badges).toContain('pro');
      expect(user.badges.length).toBe(3);
    });

    it('should handle empty badges array for non-founder', () => {
      const user = {
        id: 'usr_456',
        email: 'late@example.com',
        badges: [],
      };

      expect(user.badges).not.toContain('founder');
      expect(user.badges.length).toBe(0);
    });
  });

  describe('Launch Timestamp Configuration', () => {
    it('should parse valid ISO 8601 timestamp', () => {
      const launchTs = '2026-01-01T00:00:00Z';
      const date = new Date(launchTs);

      expect(date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(date.getUTCFullYear()).toBe(2026);
      expect(date.getUTCMonth()).toBe(0); // January (0-indexed)
      expect(date.getUTCDate()).toBe(1);
    });

    it('should handle timestamp with timezone offset', () => {
      const launchTs = '2026-01-01T00:00:00+00:00';
      const date = new Date(launchTs);

      expect(date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should calculate correct 6-month end date', () => {
      const launchDate = new Date('2026-01-01T00:00:00Z');
      const endDate = new Date(launchDate);
      endDate.setUTCMonth(endDate.getUTCMonth() + 6);

      expect(endDate.getUTCFullYear()).toBe(2026);
      expect(endDate.getUTCMonth()).toBe(6); // July (0-indexed)
      expect(endDate.getUTCDate()).toBe(1);
    });

    it('should handle year overflow when adding 6 months', () => {
      const launchDate = new Date('2026-08-01T00:00:00Z');
      const endDate = new Date(launchDate);
      endDate.setUTCMonth(endDate.getUTCMonth() + 6);

      expect(endDate.getUTCFullYear()).toBe(2027);
      expect(endDate.getUTCMonth()).toBe(1); // February (0-indexed)
    });
  });

  describe('Registration Timestamp Handling', () => {
    it('should correctly compare timestamps', () => {
      const earlier = new Date('2026-01-01T00:00:00Z');
      const later = new Date('2026-07-02T00:00:00Z');

      expect(earlier < later).toBe(true);
      expect(later > earlier).toBe(true);
    });

    it('should handle exact timestamp equality', () => {
      const date1 = new Date('2026-01-01T00:00:00Z');
      const date2 = new Date('2026-01-01T00:00:00Z');

      expect(date1.getTime()).toBe(date2.getTime());
      expect(date1 <= date2).toBe(true);
      expect(date1 >= date2).toBe(true);
    });

    it('should handle millisecond precision', () => {
      const date1 = new Date('2026-01-01T00:00:00.000Z');
      const date2 = new Date('2026-01-01T00:00:00.001Z');

      expect(date1 < date2).toBe(true);
      expect(date2 > date1).toBe(true);
    });
  });
});
