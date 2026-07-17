const {
  STATUSES,
  normaliseUkPostcode,
  createGeoPoint,
  distanceMiles,
  rangesOverlap,
  publicAvailabilityForRange,
  classifyCalendarFreshness,
  supplierAvailabilityIndexes,
} = require('../../services/availability.service');

describe('availability service', () => {
  test('normalises valid UK postcodes, including GIR 0AA, and rejects invalid input', () => {
    expect(normaliseUkPostcode('sw1a1aa')).toEqual({ ok: true, postcode: 'SW1A 1AA' });
    expect(normaliseUkPostcode('gir0aa')).toEqual({ ok: true, postcode: 'GIR 0AA' });
    expect(normaliseUkPostcode('not a postcode')).toEqual({
      ok: false,
      error: 'invalid_postcode',
    });
  });

  test('creates and validates GeoJSON points in longitude latitude order', () => {
    expect(createGeoPoint(-0.1419, 51.5014)).toEqual({
      type: 'Point',
      coordinates: [-0.1419, 51.5014],
    });
    expect(createGeoPoint(999, 51.5014)).toBeNull();
    expect(() => distanceMiles({ type: 'Point', coordinates: [0] }, createGeoPoint(0, 0))).toThrow(
      'invalid_geo_point'
    );
  });

  test('calculates radius distance using GeoJSON coordinate ordering', () => {
    const westminster = createGeoPoint(-0.1419, 51.5014);
    const cardiff = createGeoPoint(-3.1791, 51.4816);
    expect(distanceMiles(westminster, cardiff)).toBeGreaterThan(130);
    expect(distanceMiles(westminster, cardiff)).toBeLessThan(140);
  });

  test('uses inclusive valid local date ranges and rejects invalid or reversed dates', () => {
    expect(rangesOverlap('2026-03-28', '2026-03-29', '2026-03-29', '2026-03-30')).toBe(true);
    expect(rangesOverlap('2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31')).toBe(false);
    expect(() => rangesOverlap('2026-02-30', null, '2026-03-01', null)).toThrow(
      'must_be_valid_local_date'
    );
    expect(() => rangesOverlap('2026-03-02', '2026-03-01', '2026-03-01', null)).toThrow(
      'start_must_not_be_after_end'
    );
  });

  test('redacts booked entries and applies blocking status precedence independent of array order', () => {
    const calendar = {
      weeklyPattern: { 6: true },
      exceptions: [
        {
          startDate: '2026-07-18',
          endDate: '2026-07-18',
          status: STATUSES.PROVISIONAL,
          source: 'manual',
        },
        {
          startDate: '2026-07-18',
          endDate: '2026-07-18',
          status: STATUSES.BOOKED,
          source: 'booking',
        },
      ],
    };
    expect(publicAvailabilityForRange(calendar, '2026-07-18')).toEqual({
      status: STATUSES.UNAVAILABLE,
      reason: 'booking',
    });
  });

  test('evaluates every date in a multi-day weekly range', () => {
    const calendar = {
      weeklyPattern: {
        5: true,
        6: true,
        0: false,
      },
      exceptions: [],
    };

    expect(publicAvailabilityForRange(calendar, '2026-07-17', '2026-07-18')).toEqual({
      status: STATUSES.AVAILABLE,
      reason: 'weekly_pattern',
    });
    expect(publicAvailabilityForRange(calendar, '2026-07-18', '2026-07-19')).toEqual({
      status: STATUSES.UNAVAILABLE,
      reason: 'weekly_pattern',
    });
  });

  test('does not let a package-specific exception affect an unscoped availability result', () => {
    const calendar = {
      weeklyPattern: { 6: true },
      exceptions: [
        {
          startDate: '2026-07-18',
          status: STATUSES.UNAVAILABLE,
          packageId: 'package-a',
        },
      ],
    };

    expect(publicAvailabilityForRange(calendar, '2026-07-18')).toEqual({
      status: STATUSES.AVAILABLE,
      reason: 'weekly_pattern',
    });
    expect(publicAvailabilityForRange(calendar, '2026-07-18', '2026-07-18', 'package-a')).toEqual({
      status: STATUSES.UNAVAILABLE,
      reason: 'exception',
    });
  });

  test('keeps missing calendars and invalid confirmation timestamps safely unconfirmed', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    expect(publicAvailabilityForRange(null, '2026-07-18')).toEqual({
      status: STATUSES.UNKNOWN,
      reason: 'no_calendar',
    });
    expect(classifyCalendarFreshness(null, now)).toBe('never_confirmed');
    expect(classifyCalendarFreshness('invalid', now)).toBe('never_confirmed');
    expect(classifyCalendarFreshness('2027-07-01T12:00:00Z', now)).toBe('never_confirmed');
    expect(classifyCalendarFreshness('2026-07-01T12:00:00Z', now)).toBe('up_to_date');
    expect(classifyCalendarFreshness('2026-06-01T12:00:00Z', now)).toBe('needs_review_soon');
    expect(classifyCalendarFreshness('2026-04-01T12:00:00Z', now)).toBe('stale');
  });

  test('declares valid geospatial, geocoding and separate exception indexes', () => {
    const indexes = supplierAvailabilityIndexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'suppliers', key: { locationGeo: '2dsphere' } }),
        expect.objectContaining({ collection: 'supplierAvailabilityExceptions' }),
      ])
    );
    expect(
      indexes.some(index => index.options?.name === 'suppliers_geocoding_status_updatedAt')
    ).toBe(true);
  });
});
