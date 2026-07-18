'use strict';

const { calculateDistance, isValidUKPostcode } = require('../../utils/geocoding');

function createRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomBetween(random, min, max) {
  return min + random() * (max - min);
}

describe('geocoding property and fuzz contracts', () => {
  test('distance is finite, non-negative and symmetric across random valid coordinates', () => {
    const random = createRandom();

    for (let index = 0; index < 1000; index += 1) {
      const lat1 = randomBetween(random, -90, 90);
      const lon1 = randomBetween(random, -180, 180);
      const lat2 = randomBetween(random, -90, 90);
      const lon2 = randomBetween(random, -180, 180);

      const forward = calculateDistance(lat1, lon1, lat2, lon2);
      const reverse = calculateDistance(lat2, lon2, lat1, lon1);

      expect(Number.isFinite(forward)).toBe(true);
      expect(forward).toBeGreaterThanOrEqual(0);
      expect(forward).toBeLessThanOrEqual(12450);
      expect(reverse).toBeCloseTo(forward, 9);
    }
  });

  test('distance from a coordinate to itself is always zero', () => {
    const random = createRandom(0xc0ffee);

    for (let index = 0; index < 500; index += 1) {
      const latitude = randomBetween(random, -90, 90);
      const longitude = randomBetween(random, -180, 180);
      expect(calculateDistance(latitude, longitude, latitude, longitude)).toBeCloseTo(
        0,
        12
      );
    }
  });

  test.each(['CF10 1AA', 'SW1A 1AA', 'M1 1AE', 'B33 8TH', 'CR2 6XH', 'DN55 1PT'])(
    'postcode validation is invariant to case and optional internal spacing for %s',
    postcode => {
      const compact = postcode.replace(/\s/g, '');
      expect(isValidUKPostcode(postcode)).toBe(true);
      expect(isValidUKPostcode(postcode.toLowerCase())).toBe(true);
      expect(isValidUKPostcode(compact)).toBe(true);
      expect(isValidUKPostcode(`  ${postcode}  `)).toBe(true);
    }
  );

  test('arbitrary malformed values never throw and remain invalid', () => {
    const values = [
      null,
      undefined,
      12345,
      {},
      [],
      '',
      'NOT A POSTCODE',
      '<script>alert(1)</script>',
      'CF10 1A',
      'CF10 1AAA',
      '\u0000CF10 1AA',
    ];

    for (const value of values) {
      expect(() => isValidUKPostcode(value)).not.toThrow();
      expect(isValidUKPostcode(value)).toBe(false);
    }
  });
});
