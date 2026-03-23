/**
 * Unit tests for calendarPermissions utility and supplier type list.
 *
 * Tests:
 *   - VALID_CATEGORIES includes all required new types
 *   - PUBLISHER_CATEGORIES is a subset of VALID_CATEGORIES
 *   - canPublishPublicCalendar correctly derives permission from category
 *   - canPublishPublicCalendar respects admin override (tri-state)
 */

'use strict';

const { VALID_CATEGORIES, PUBLISHER_CATEGORIES } = require('../../models/Supplier');
const { canPublishPublicCalendar } = require('../../utils/calendarPermissions');

// ─── Supplier type list ───────────────────────────────────────────────────────

describe('Supplier VALID_CATEGORIES', () => {
  // Preserve existing categories
  const preExisting = [
    'Venues',
    'Catering',
    'Photography',
    'Videography',
    'Entertainment',
    'Florist',
    'Decor',
    'Transport',
    'Cake',
    'Stationery',
    'Hair & Makeup',
    'Planning',
    'Other',
  ];

  it('preserves all pre-existing categories', () => {
    for (const cat of preExisting) {
      expect(VALID_CATEGORIES).toContain(cat);
    }
  });

  it('includes Event Planner', () => {
    expect(VALID_CATEGORIES).toContain('Event Planner');
  });

  it('includes Wedding Fayre', () => {
    expect(VALID_CATEGORIES).toContain('Wedding Fayre');
  });

  it('includes Beauty', () => {
    expect(VALID_CATEGORIES).toContain('Beauty');
  });

  it('includes Bridalwear', () => {
    expect(VALID_CATEGORIES).toContain('Bridalwear');
  });

  it('includes Jewellery', () => {
    expect(VALID_CATEGORIES).toContain('Jewellery');
  });

  it('includes Celebrant', () => {
    expect(VALID_CATEGORIES).toContain('Celebrant');
  });

  it('includes Music/DJ', () => {
    expect(VALID_CATEGORIES).toContain('Music/DJ');
  });

  it('has no duplicates', () => {
    expect(new Set(VALID_CATEGORIES).size).toBe(VALID_CATEGORIES.length);
  });
});

// ─── PUBLISHER_CATEGORIES ─────────────────────────────────────────────────────

describe('PUBLISHER_CATEGORIES', () => {
  it('contains Event Planner', () => {
    expect(PUBLISHER_CATEGORIES).toContain('Event Planner');
  });

  it('contains Wedding Fayre', () => {
    expect(PUBLISHER_CATEGORIES).toContain('Wedding Fayre');
  });

  it('is a subset of VALID_CATEGORIES', () => {
    for (const cat of PUBLISHER_CATEGORIES) {
      expect(VALID_CATEGORIES).toContain(cat);
    }
  });

  it('does not include non-publisher categories like Photography', () => {
    expect(PUBLISHER_CATEGORIES).not.toContain('Photography');
    expect(PUBLISHER_CATEGORIES).not.toContain('Catering');
    expect(PUBLISHER_CATEGORIES).not.toContain('Venues');
  });
});

// ─── canPublishPublicCalendar ─────────────────────────────────────────────────

describe('canPublishPublicCalendar', () => {
  it('returns false for null/undefined supplier', () => {
    expect(canPublishPublicCalendar(null)).toBe(false);
    expect(canPublishPublicCalendar(undefined)).toBe(false);
  });

  describe('derived from category (override is null/undefined)', () => {
    it('returns true for Event Planner', () => {
      expect(canPublishPublicCalendar({ category: 'Event Planner' })).toBe(true);
    });

    it('returns true for Wedding Fayre', () => {
      expect(canPublishPublicCalendar({ category: 'Wedding Fayre' })).toBe(true);
    });

    it('returns false for Photography supplier', () => {
      expect(canPublishPublicCalendar({ category: 'Photography' })).toBe(false);
    });

    it('returns false for Catering supplier', () => {
      expect(canPublishPublicCalendar({ category: 'Catering' })).toBe(false);
    });

    it('returns false for Venues supplier', () => {
      expect(canPublishPublicCalendar({ category: 'Venues' })).toBe(false);
    });

    it('returns false when category is undefined', () => {
      expect(canPublishPublicCalendar({ category: undefined })).toBe(false);
    });
  });

  describe('admin override — true', () => {
    it('grants publish rights even for non-publisher category', () => {
      expect(
        canPublishPublicCalendar({
          category: 'Photography',
          publicCalendarPublisherOverride: true,
        })
      ).toBe(true);
    });

    it('grants publish rights when category is missing', () => {
      expect(
        canPublishPublicCalendar({
          publicCalendarPublisherOverride: true,
        })
      ).toBe(true);
    });
  });

  describe('admin override — false', () => {
    it('denies publish rights even for Event Planner', () => {
      expect(
        canPublishPublicCalendar({
          category: 'Event Planner',
          publicCalendarPublisherOverride: false,
        })
      ).toBe(false);
    });

    it('denies publish rights even for Wedding Fayre', () => {
      expect(
        canPublishPublicCalendar({
          category: 'Wedding Fayre',
          publicCalendarPublisherOverride: false,
        })
      ).toBe(false);
    });
  });

  describe('admin override — null (reset to auto)', () => {
    it('derives from category when override is null', () => {
      expect(
        canPublishPublicCalendar({
          category: 'Event Planner',
          publicCalendarPublisherOverride: null,
        })
      ).toBe(true);

      expect(
        canPublishPublicCalendar({
          category: 'Photography',
          publicCalendarPublisherOverride: null,
        })
      ).toBe(false);
    });
  });
});
