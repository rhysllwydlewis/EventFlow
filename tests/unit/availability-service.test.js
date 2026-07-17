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
  test('normalises valid UK postcodes and rejects invalid input', () => {
    expect(normaliseUkPostcode('sw1a1aa')).toEqual({ ok: true, postcode: 'SW1A 1AA' });
    expect(normaliseUkPostcode('not a postcode')).toEqual({ ok: false, error: 'invalid_postcode' });
  });

  test('creates GeoJSON points in longitude latitude order only for valid coordinates', () => {
    expect(createGeoPoint(-0.1419, 51.5014)).toEqual({
      type: 'Point',
      coordinates: [-0.1419, 51.5014],
    });
    expect(createGeoPoint(999, 51.5014)).toBeNull();
  });

  test('calculates radius distance using GeoJSON coordinate ordering', () => {
    const westminster = createGeoPoint(-0.1419, 51.5014);
    const cardiff = createGeoPoint(-3.1791, 51.4816);
    expect(distanceMiles(westminster, cardiff)).toBeGreaterThan(130);
    expect(distanceMiles(westminster, cardiff)).toBeLessThan(140);
  });

  test('uses inclusive local calendar date range overlap semantics', () => {
    expect(rangesOverlap('2026-03-28', '2026-03-29', '2026-03-29', '2026-03-30')).toBe(true);
    expect(rangesOverlap('2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31')).toBe(false);
  });

  test('redacts booked entries to public unavailable and keeps unknown separate from available', () => {
    const calendar = {
      weeklyPattern: { 6: true },
      exceptions: [
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
    expect(publicAvailabilityForRange(null, '2026-07-18')).toEqual({
      status: STATUSES.UNKNOWN,
      reason: 'no_calendar',
    });
  });

  test('classifies calendar freshness without exposing private entry details', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    expect(classifyCalendarFreshness(null, now)).toBe('never_confirmed');
    expect(classifyCalendarFreshness('2026-07-01T12:00:00Z', now)).toBe('up_to_date');
    expect(classifyCalendarFreshness('2026-06-01T12:00:00Z', now)).toBe('needs_review_soon');
    expect(classifyCalendarFreshness('2026-04-01T12:00:00Z', now)).toBe('stale');
  });

  test('declares required geospatial and availability indexes', () => {
    const indexes = supplierAvailabilityIndexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'suppliers', key: { locationGeo: '2dsphere' } }),
      ])
    );
    expect(indexes.some(index => index.collection === 'supplierAvailabilityCalendars')).toBe(true);
  });
});
