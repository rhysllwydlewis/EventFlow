/**
 * Table-driven tests for services/seoEligibility.service.js — the shared
 * public/index/sitemap eligibility policy the SEO audit's SEO-002 finding
 * asked for. Covers every lifecycle/test/completeness combination for both
 * suppliers and packages, and the four decisions' reason codes.
 */

'use strict';

const {
  REASON_CODES,
  canBeViewedPublicly,
  canAppearInDirectory,
  canBeIndexed,
  canAppearInSitemap,
  isKnownTestFixture,
} = require('../../services/seoEligibility.service');

const owners = new Set(['user-1']);

const completeSupplier = (overrides = {}) => ({
  id: 'supplier-1',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cwm Valley Photography',
  category: 'Photography',
  location: 'Cardiff',
  description_short: 'Natural wedding and event photography across South Wales.',
  ...overrides,
});

const completePackage = (overrides = {}) => ({
  id: 'pkg-1',
  supplierId: 'supplier-1',
  approved: true,
  title: 'Full Day Wedding Photography',
  description: 'A full day of documentary-style wedding photography across South Wales.',
  ...overrides,
});

describe('seoEligibility — suppliers', () => {
  const cases = [
    ['a complete, approved supplier', {}, true, []],
    ['a supplier awaiting approval', { approved: false }, false, [REASON_CODES.NOT_APPROVED]],
    ['a suspended-by-status supplier', { status: 'suspended' }, false, [REASON_CODES.SUSPENDED]],
    [
      'a suspended-by-verificationStatus supplier',
      { verificationStatus: 'suspended' },
      false,
      [REASON_CODES.SUSPENDED],
    ],
    ['a rejected supplier', { verificationStatus: 'rejected' }, false, [REASON_CODES.REJECTED]],
    [
      'a soft-deleted supplier',
      { deletedAt: '2026-01-01T00:00:00.000Z' },
      false,
      [REASON_CODES.DELETED],
    ],
    ['an explicit isTest supplier', { isTest: true }, false, [REASON_CODES.TEST_FIXTURE]],
    // A whole-word "Test" match (as opposed to the exact-name/slug or
    // explicit isTest cases below) does NOT block viewability — see the
    // "confident vs. likely fixture" tests further down. A real business
    // like "Test Valley Marquees" must not 404 for its own visitors.
    ['a supplier named with the word "Test"', { name: 'Romeo Test', approved: true }, true, []],
    [
      'a supplier whose entire name is literally "Test"',
      { name: 'Test' },
      false,
      [REASON_CODES.TEST_FIXTURE],
    ],
    [
      'an ordinary business name that merely contains "test" as a substring',
      { name: 'Contest Caterers Ltd' },
      true,
      [],
    ],
    ['a nameless supplier', { name: undefined }, false, [REASON_CODES.MISSING_IDENTITY]],
    [
      'an orphaned supplier (owner no longer exists)',
      { ownerUserId: 'missing-user' },
      false,
      [REASON_CODES.INVALID_OWNER],
    ],
    ['a supplier with no owner reference at all', { ownerUserId: undefined }, true, []],
  ];

  test.each(cases)(
    'canBeViewedPublicly — %s',
    (label, overrides, expectedEligible, expectedReasons) => {
      const decision = canBeViewedPublicly(completeSupplier(overrides), { validOwnerIds: owners });
      expect(decision.eligible).toBe(expectedEligible);
      expectedReasons.forEach(reason => expect(decision.reasons).toContain(reason));
      if (expectedEligible) {
        expect(decision.reasons).toEqual([]);
      }
    }
  );

  test('a viewable-but-incomplete supplier still passes canBeViewedPublicly', () => {
    const bare = { id: 'sup-bare', approved: true, name: 'Bare Bones Events' };
    expect(canBeViewedPublicly(bare, { validOwnerIds: owners }).eligible).toBe(true);
  });

  describe('canBeIndexed — the stricter, separate decision', () => {
    test('a complete supplier is indexable', () => {
      const decision = canBeIndexed(completeSupplier(), { validOwnerIds: owners });
      expect(decision.eligible).toBe(true);
      expect(decision.reasons).toEqual([]);
    });

    test('rejects a viewable supplier missing category classification', () => {
      const decision = canBeIndexed(completeSupplier({ category: '' }), { validOwnerIds: owners });
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toContain(REASON_CODES.MISSING_CLASSIFICATION);
    });

    test('rejects a viewable supplier with no usable location and no nationwide coverage', () => {
      const decision = canBeIndexed(completeSupplier({ location: '' }), { validOwnerIds: owners });
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toContain(REASON_CODES.MISSING_LOCATION);
    });

    test('accepts a supplier with no free-text location but declared nationwide coverage', () => {
      // price_display makes up the two profile-quality points location text
      // would otherwise have contributed, isolating this case to the location
      // check rather than also tripping the separate quality-threshold check.
      const decision = canBeIndexed(
        completeSupplier({
          location: '',
          serviceAreas: [{ type: 'nationwide' }],
          price_display: 'From £500',
        }),
        { validOwnerIds: owners }
      );
      expect(decision.eligible).toBe(true);
      expect(decision.reasons).not.toContain(REASON_CODES.MISSING_LOCATION);
    });

    test('rejects a near-empty supplier below the quality threshold', () => {
      const bare = completeSupplier({
        category: 'Photography',
        location: 'Cardiff',
        description_short: undefined,
      });
      const decision = canBeIndexed(bare, { validOwnerIds: owners });
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toContain(REASON_CODES.BELOW_QUALITY_THRESHOLD);
    });

    test('a record that fails viewability also fails indexing, carrying the same reason', () => {
      const decision = canBeIndexed(completeSupplier({ approved: false }), {
        validOwnerIds: owners,
      });
      expect(decision.eligible).toBe(false);
      expect(decision.reasons).toEqual([REASON_CODES.NOT_APPROVED]);
    });

    test('canAppearInDirectory matches canBeViewedPublicly for every check except the test-fixture heuristic', () => {
      const supplier = completeSupplier({ category: '' });
      expect(canAppearInDirectory(supplier, { validOwnerIds: owners })).toEqual(
        canBeViewedPublicly(supplier, { validOwnerIds: owners })
      );
    });

    test('canAppearInDirectory is stricter than canBeViewedPublicly for a likely (not confirmed) fixture name', () => {
      // "Romeo Test" carries "test" as a whole word — real (SEO-audit-found)
      // fixture pattern, but also indistinguishable from a real business
      // like "Test Valley Marquees". canBeViewedPublicly stays lenient (a
      // false positive there 404s a real page); canAppearInDirectory can
      // afford to be stricter since hiding from search/index is reversible.
      const supplier = completeSupplier({ name: 'Romeo Test' });
      expect(canBeViewedPublicly(supplier, { validOwnerIds: owners }).eligible).toBe(true);

      const directory = canAppearInDirectory(supplier, { validOwnerIds: owners });
      expect(directory.eligible).toBe(false);
      expect(directory.reasons).toEqual([REASON_CODES.TEST_FIXTURE]);

      const indexed = canBeIndexed(supplier, { validOwnerIds: owners });
      expect(indexed.eligible).toBe(false);
      expect(indexed.reasons).toContain(REASON_CODES.TEST_FIXTURE);
    });

    test('an explicit isTest flag or an exact "Test" name/slug still blocks canBeViewedPublicly itself', () => {
      expect(
        canBeViewedPublicly(completeSupplier({ isTest: true }), { validOwnerIds: owners }).eligible
      ).toBe(false);
      expect(
        canBeViewedPublicly(completeSupplier({ name: 'Test' }), { validOwnerIds: owners }).eligible
      ).toBe(false);
    });
  });

  describe('canAppearInSitemap', () => {
    test('requires canBeIndexed plus a resolved canonical slug', () => {
      const supplier = completeSupplier();
      expect(
        canAppearInSitemap(supplier, { validOwnerIds: owners, canonicalSlug: '' }).eligible
      ).toBe(false);
      expect(
        canAppearInSitemap(supplier, {
          validOwnerIds: owners,
          canonicalSlug: 'cwm-valley-photography--abc123',
        }).eligible
      ).toBe(true);
    });

    test('reports NO_CANONICAL_SLUG alongside any other failed checks', () => {
      const decision = canAppearInSitemap(completeSupplier({ category: '' }), {
        validOwnerIds: owners,
        canonicalSlug: '',
      });
      expect(decision.reasons).toEqual(
        expect.arrayContaining([
          REASON_CODES.MISSING_CLASSIFICATION,
          REASON_CODES.NO_CANONICAL_SLUG,
        ])
      );
    });
  });
});

describe('seoEligibility — packages', () => {
  const packageContext = (overrides = {}) => ({
    type: 'package',
    supplier: completeSupplier(),
    validOwnerIds: owners,
    ...overrides,
  });

  test('a complete, approved package under a viewable supplier is indexable', () => {
    const decision = canBeIndexed(completePackage(), packageContext());
    expect(decision.eligible).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  test('rejects an unapproved package', () => {
    const decision = canBeViewedPublicly(completePackage({ approved: false }), packageContext());
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(REASON_CODES.NOT_APPROVED);
  });

  test('rejects a paused package', () => {
    const decision = canBeViewedPublicly(completePackage({ paused: true }), packageContext());
    expect(decision.eligible).toBe(false);
  });

  test('rejects a package whose supplier is not itself viewable', () => {
    const decision = canBeViewedPublicly(
      completePackage(),
      packageContext({ supplier: completeSupplier({ approved: false }) })
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(REASON_CODES.SUPPLIER_NOT_VIEWABLE);
  });

  test('keeps a package noindex when its owning supplier is viewable but not indexable', () => {
    const decision = canBeIndexed(
      completePackage(),
      packageContext({ supplier: completeSupplier({ description_short: '', description: '' }) })
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(REASON_CODES.SUPPLIER_NOT_INDEXABLE);
  });

  test("rejects the audit's example: an explicit test/fixture package", () => {
    const decision = canBeViewedPublicly(
      completePackage({ id: 'pkg-test', slug: 'test-no2-yy7lo4', title: 'Test' }),
      packageContext()
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(REASON_CODES.TEST_FIXTURE);
  });

  test('rejects a package with no meaningful description of its own', () => {
    const decision = canBeIndexed(completePackage({ description: '' }), packageContext());
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain(REASON_CODES.BELOW_QUALITY_THRESHOLD);
  });

  test('canAppearInSitemap requires a resolved canonical slug', () => {
    const context = packageContext({ canonicalSlug: '' });
    expect(canAppearInSitemap(completePackage(), context).eligible).toBe(false);
    expect(
      canAppearInSitemap(completePackage(), {
        ...context,
        canonicalSlug: 'full-day-wedding-photography-pkg001',
      }).eligible
    ).toBe(true);
  });
});

describe('isKnownTestFixture', () => {
  test.each([
    [{ isTest: true, name: 'Anything' }, true],
    [{ name: 'Romeo Test' }, true],
    [{ name: 'Test' }, true],
    [{ slug: 'test-no2-yy7lo4' }, true],
    [{ name: 'Contest Caterers' }, false],
    [{ name: 'Westerly Tents & Marquees' }, false],
    [{ name: 'Testimonials by Grace' }, false],
  ])('%j -> %s', (record, expected) => {
    expect(isKnownTestFixture(record)).toBe(expected);
  });
});
