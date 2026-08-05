/**
 * Index manifest tests for the UK location pages.
 *
 * Every query the matcher and the admin API run must have an index behind it,
 * and every index must be named so a repeated deploy reconciles rather than
 * duplicating.
 */

'use strict';

const { COLLECTIONS } = require('../../models/LocationContent');
const { _test } = require('../../services/locationIndexes.service');

/**
 * Build a MongoDB double that records every createIndex call.
 * @returns {{db: Object, calls: Object[]}} Recorder.
 */
function createRecorder() {
  const calls = [];
  const db = {
    collection(name) {
      return {
        createIndex: async (keys, options) => {
          calls.push({ collection: name, keys, options: options || {} });
          return options && options.name;
        },
      };
    },
  };
  return { db, calls };
}

describe('location index manifest', () => {
  let calls;

  beforeAll(async () => {
    const recorder = createRecorder();
    await _test.createIndexes(recorder.db);
    calls = recorder.calls;
  });

  it('names every index', () => {
    expect(calls.filter(call => !call.options.name)).toEqual([]);
  });

  it('uses a unique index for the location page slug', () => {
    const slugIndex = calls.find(
      call => call.collection === COLLECTIONS.locationPages && call.keys.locationSlug === 1
    );
    expect(slugIndex.options.unique).toBe(true);
  });

  it('indexes the supplier base city and service area lookups', () => {
    const keys = calls.filter(call => call.collection === 'suppliers').map(call => call.keys);
    expect(keys).toContainEqual({ 'baseLocation.citySlug': 1, approved: 1 });
    expect(keys).toContainEqual({ 'serviceAreas.slug': 1, approved: 1 });
  });

  it('indexes supplier coordinates for geospatial radius matching', () => {
    const geo = calls.find(call => call.keys['baseLocation.coordinates'] === '2dsphere');
    expect(geo).toBeTruthy();
    expect(geo.collection).toBe('suppliers');
  });

  it('creates no duplicate index names', () => {
    const names = calls.map(call => call.options.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
