/**
 * Characterisation of POST /api/photos/upload and POST /api/photos/upload/batch.
 *
 * Those two handlers were each a single 300-line function (cyclomatic complexity 44 and 49). They
 * were refactored into small functions without changing what they do, and then changed to look up
 * and authorise the target before any file is processed. This test pins what they do: it drives
 * the real router with fake database, photo pipeline, logger and feature flags across a matrix of
 * scenarios, and compares everything observable (the HTTP status and body, every database call,
 * every photo pipeline call, every log line, cache invalidations) with a recorded fixture.
 *
 * The fixture was recorded from the code before the refactor and regenerated for the ordering
 * change. What differs from the original is only: a refused target never reaches the photo
 * pipeline, the resulting order of database calls, and a supplier or package single upload taking
 * exactly one file.
 *
 * To regenerate the fixture after an intended behaviour change:
 *   UPDATE_PHOTOS_CHARACTERIZATION=1 npx jest tests/integration/photos-upload-characterization.test.js
 *   npx prettier --write tests/fixtures/photos-upload-characterization.json
 * The second step matters: the test writes plain JSON, and CI's formatting check rejects it.
 *
 * @jest-environment node
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const FIXTURE = path.join(__dirname, '../fixtures/photos-upload-characterization.json');

// ── Fakes the router reaches for at require time ────────────────────────────

/** Mutable per-scenario state that the module mocks below read. */
const mockWorld = { flags: { photoAutoApprove: true }, allowance: { allowed: true } };

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
jest.mock('../../middleware/rateLimits', () => {
  const pass = (_req, _res, next) => next();
  return { uploadLimiter: pass, apiLimiter: pass };
});
jest.mock('../../middleware/features', () => ({
  getFeatureFlags: jest.fn(async () => mockWorld.flags),
}));
jest.mock('../../utils/photoGalleryAllowance', () => ({
  checkPhotoAllowance: jest.fn(async () => mockWorld.allowance),
  photoLimitError: jest.fn((limit, current) => ({ error: 'photo limit', limit, current })),
}));

const router = require('../../routes/photos');
const { checkPhotoAllowance } = require('../../utils/photoGalleryAllowance');
const suppliersRouter = require('../../routes/suppliers');

// ── The mockWorld a scenario runs in ────────────────────────────────────────────

function freshDb() {
  return {
    marketplace_listings: [
      { id: 'L1', userId: 'u1', images: ['/api/photos/old1'] },
      { id: 'L-other', userId: 'someone-else', images: [] },
      { id: 'L-full', userId: 'u1', images: ['/a', '/b', '/c', '/d'] },
      {
        id: 'L-mixed',
        userId: 'u1',
        images: ['/s', { url: '/o' }, { nope: true }, null, 42],
      },
    ],
    suppliers: [
      { id: 'S1', name: 'Sup One', ownerUserId: 'u1', photosGallery: [{ url: '/g1' }] },
      { id: 'S-other', name: 'Sup Other', ownerUserId: 'someone-else', photosGallery: [] },
      { id: 'S-null', name: 'Sup Null', ownerUserId: 'u1', photosGallery: null },
      { id: 'S-nogallery', name: 'Sup None', ownerUserId: 'u1' },
    ],
    packages: [
      { id: 'P1', supplierId: 'S1', gallery: [{ url: '/pg1' }], image: '' },
      { id: 'P-img', supplierId: 'S1', gallery: [], image: '/api/photos/existing' },
      {
        id: 'P-placeholder',
        supplierId: 'S1',
        gallery: [],
        image: '/assets/images/package-placeholder.webp',
      },
      { id: 'P-nogallery', supplierId: 'S1', image: '' },
      { id: 'P-orphan', supplierId: 'S-missing', gallery: [], image: '' },
      { id: 'P-foreign', supplierId: 'S-other', gallery: [], image: '' },
    ],
    photos: [],
  };
}

const file = (name, extra = {}) => ({
  originalname: name,
  buffer: Buffer.from(`data-${name}`),
  size: 100,
  mimetype: 'image/jpeg',
  ...extra,
});

/** Throws the error a file's name asks for, so scenarios can fail one file among several. */
function failureFor(name) {
  const make = (errName, message) => Object.assign(new Error(message), { name: errName });
  if (name.includes('validation')) {
    return make('ValidationError', 'File too small');
  }
  if (name.includes('mongo-msg')) {
    return make('Error', 'MongoDB write failed');
  }
  if (name.includes('unavailable')) {
    return make('MongoDBUnavailableError', 'no mongo');
  }
  if (name.includes('storage')) {
    return make('MongoDBStorageError', 'disk');
  }
  if (name.includes('boom')) {
    return make('Error', 'boom');
  }
  return null;
}

function makePhotoUpload(calls, files, events, onProcess = () => {}) {
  const results = name => ({
    optimized: `/api/photos/opt_${name}`,
    thumbnail: `/api/photos/thumb_${name}`,
    large: `/api/photos/large_${name}`,
    original: `/api/photos/orig_${name}`,
  });
  return {
    // The router asks multer for `fields(...)`; hand back the scenario's files as if parsed.
    upload: {
      fields: () => (req, _res, done) => {
        req.files = { files };
        done();
      },
    },
    processAndSaveImage: jest.fn(async (buffer, name, type) => {
      calls.push(['processAndSaveImage', name, type, buffer.length]);
      events.push('pipeline');
      onProcess();
      const failure = failureFor(name);
      if (failure) {
        throw failure;
      }
      return results(name);
    }),
    processAndSaveMarketplaceImage: jest.fn(async (buffer, name, listingId, userId, order) => {
      calls.push(['processAndSaveMarketplaceImage', name, listingId, userId, order, buffer.length]);
      events.push('pipeline');
      onProcess();
      const failure = failureFor(name);
      if (failure) {
        throw failure;
      }
      return { optimized: `/api/photos/mk_${name}_${order}` };
    }),
    getImageMetadata: jest.fn(async buffer => {
      calls.push(['getImageMetadata', buffer.length]);
      events.push('pipeline');
      return { width: 100, height: 80, format: 'jpeg' };
    }),
  };
}

function mount(scenario) {
  const db = scenario.db ? scenario.db(freshDb()) : freshDb();
  const dbCalls = [];
  const uploadCalls = [];
  const logs = [];
  // Database calls and photo pipeline calls in the one order they happened, which the two
  // separate lists above cannot show
  const events = [];
  const files = scenario.files || [file('a.jpg')];

  const find = (collection, query) =>
    (db[collection] || []).find(item => Object.entries(query).every(([k, v]) => item[k] === v)) ||
    null;
  const dbUnified = {
    findOne: jest.fn(async (collection, query) => {
      dbCalls.push(['findOne', collection, query]);
      events.push(`findOne:${collection}`);
      if (scenario.findOneThrows === collection) {
        throw new Error('db down');
      }
      const found = find(collection, query);
      // A real database hands back a copy. The fake hands back the stored object itself unless a
      // scenario asks for copies, which a scenario about stale reads needs.
      return found && scenario.cloneReads ? JSON.parse(JSON.stringify(found)) : found;
    }),
    updateOne: jest.fn(async (collection, filter, update) => {
      dbCalls.push(['updateOne', collection, filter, update]);
      events.push(`updateOne:${collection}`);
      return true;
    }),
    insertOne: jest.fn(async (collection, doc) => {
      dbCalls.push(['insertOne', collection, doc]);
      events.push(`insertOne:${collection}`);
      return scenario.insertOk === false ? null : doc;
    }),
  };
  const logger = ['info', 'warn', 'error', 'debug'].reduce((acc, level) => {
    // Stack traces carry machine-specific paths, so only they are left out of the comparison.
    acc[level] = jest.fn((message, meta) => {
      const { stack, ...fields } = meta || {};
      logs.push([level, message, { ...fields, hasStack: stack !== undefined }]);
    });
    return acc;
  }, {});
  // A scenario can change the stored data while the first file is being processed, as another
  // request finishing in the meantime would
  let processing = false;
  const onProcess = () => {
    if (scenario.duringProcessing && !processing) {
      processing = true;
      scenario.duringProcessing(db);
    }
  };
  const pass = (_req, _res, next) => next();
  router.initializeDependencies({
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = scenario.user || { id: 'u1', role: 'supplier' };
      next();
    },
    roleRequired: () => pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    photoUpload: makePhotoUpload(uploadCalls, files, events, onProcess),
    logger,
  });
  const app = express();
  app.use('/api', router);
  return { app, dbCalls, uploadCalls, logs, events };
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const scenarios = {};
const add = (name, scenario) => {
  scenarios[name] = scenario;
};

// Request validation
add('no files', { type: 'supplier', id: 'S1', files: [] });
add('missing type', { id: 'S1' });
add('missing id', { type: 'supplier' });
add('invalid type', { type: 'banner', id: 'S1' });
add('id given twice', { rawQuery: 'type=supplier&id=S1&id=S-other' });

// Marketplace listings
add('marketplace: listing not found', { type: 'marketplace', id: 'nope' });
add('marketplace: not the owner', { type: 'marketplace', id: 'L-other' });
add('marketplace: admin may upload', {
  type: 'marketplace',
  id: 'L-other',
  user: { id: 'admin1', role: 'admin' },
});
add('marketplace: one file', { type: 'marketplace', id: 'L1' });
add('marketplace: three files', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file('b.jpg'), file('c.jpg')],
});
add('marketplace: capped at five images', {
  type: 'marketplace',
  id: 'L-full',
  files: [file('a.jpg'), file('b.jpg'), file('c.jpg')],
});
add('marketplace: existing images of mixed shapes', {
  type: 'marketplace',
  id: 'L-mixed',
  files: [file('a.jpg'), file('b.jpg')],
});
add('marketplace: empty file among good ones', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file('empty.jpg', { buffer: Buffer.alloc(0) }), file('c.jpg')],
});
add('marketplace: file with no name', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file(undefined)],
});
add('marketplace: file with a non-string name', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file(42)],
});
add('marketplace: a file whose buffer is not a Buffer', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file('str.jpg', { buffer: 'not-a-buffer' })],
});
add('marketplace: an empty file that also has no name', {
  type: 'marketplace',
  id: 'L1',
  files: [file(undefined, { buffer: Buffer.alloc(0) }), file('c.jpg')],
});
add('marketplace: a file with no buffer', {
  type: 'marketplace',
  id: 'L1',
  files: [file('a.jpg'), file('nobuf.jpg', { buffer: undefined })],
});
add('supplier: a file with no buffer, and one with a bad name', {
  type: 'supplier',
  id: 'S1',
  files: [file('nobuf.jpg', { buffer: undefined }), file(undefined), file('c.jpg')],
});
add('marketplace: one file fails validation, one succeeds', {
  type: 'marketplace',
  id: 'L1',
  files: [file('validation.jpg'), file('good.jpg')],
});
add('marketplace: a MongoDB error message is softened', {
  type: 'marketplace',
  id: 'L1',
  files: [file('mongo-msg.jpg'), file('good.jpg')],
});
add('marketplace: every file fails', {
  type: 'marketplace',
  id: 'L1',
  files: [file('validation.jpg'), file('boom.jpg')],
});
add('marketplace: every file is empty', {
  type: 'marketplace',
  id: 'L1',
  files: [file('e1.jpg', { buffer: Buffer.alloc(0) })],
});

// Suppliers
add('supplier: not found', { type: 'supplier', id: 'nope' });
add('supplier: not the owner', { type: 'supplier', id: 'S-other' });
add('supplier: admin may upload', {
  type: 'supplier',
  id: 'S-other',
  user: { id: 'admin1', role: 'admin' },
});
add('supplier: over the photo allowance', {
  type: 'supplier',
  id: 'S1',
  allowance: { allowed: false, limit: 10, current: 10 },
});
add('supplier: auto-approve on', { type: 'supplier', id: 'S1' });
add('supplier: auto-approve flag missing counts as on', {
  type: 'supplier',
  id: 'S1',
  flags: {},
});
add('supplier: auto-approve off, saved for moderation', {
  type: 'supplier',
  id: 'S1',
  flags: { photoAutoApprove: false },
});
add('supplier: auto-approve off, the record cannot be saved', {
  type: 'supplier',
  id: 'S1',
  flags: { photoAutoApprove: false },
  insertOk: false,
});
add('supplier: three files', {
  type: 'supplier',
  id: 'S1',
  files: [file('a.jpg'), file('b.jpg'), file('c.jpg')],
});
add('supplier: three files, moderation on', {
  type: 'supplier',
  id: 'S1',
  flags: { photoAutoApprove: false },
  files: [file('a.jpg'), file('b.jpg'), file('c.jpg')],
});
add('supplier: legacy null gallery', { type: 'supplier', id: 'S-null' });
add('supplier: no gallery field', { type: 'supplier', id: 'S-nogallery' });
add('supplier: one of three files fails', {
  type: 'supplier',
  id: 'S1',
  files: [file('a.jpg'), file('validation.jpg'), file('c.jpg')],
});
add('supplier: every file fails', {
  type: 'supplier',
  id: 'S1',
  files: [file('validation.jpg'), file('boom.jpg')],
});

// Packages
add('package: not found', { type: 'package', id: 'nope' });
add('package: its supplier is missing', { type: 'package', id: 'P-orphan' });
add('package: someone else’s supplier', { type: 'package', id: 'P-foreign' });
add('package: admin may upload', {
  type: 'package',
  id: 'P-foreign',
  user: { id: 'admin1', role: 'admin' },
});
add('package: empty image becomes the first photo', { type: 'package', id: 'P1' });
add('package: placeholder image is replaced', { type: 'package', id: 'P-placeholder' });
add('package: an existing image is kept', { type: 'package', id: 'P-img' });
add('package: no gallery field yet', { type: 'package', id: 'P-nogallery' });
add('package: three files', {
  type: 'package',
  id: 'P1',
  files: [file('a.jpg'), file('b.jpg'), file('c.jpg')],
});
add('package: every file is empty', {
  type: 'package',
  id: 'P1',
  files: [file('e1.jpg', { buffer: Buffer.alloc(0) })],
});
add('package: every file fails', {
  type: 'package',
  id: 'P-img',
  files: [file('validation.jpg')],
});

// How errors are reported
add('error: validation', { type: 'supplier', id: 'S1', files: [file('validation.jpg')] });
add('error: mongo unavailable', { type: 'supplier', id: 'S1', files: [file('unavailable.jpg')] });
add('error: mongo storage', { type: 'supplier', id: 'S1', files: [file('storage.jpg')] });
add('error: unexpected', { type: 'supplier', id: 'S1', files: [file('boom.jpg')] });
add('error: unexpected, production hides details', {
  type: 'supplier',
  id: 'S1',
  files: [file('boom.jpg')],
  nodeEnv: 'production',
});
add('error: database down for suppliers', {
  type: 'supplier',
  id: 'S1',
  findOneThrows: 'suppliers',
});
add('error: database down for packages', { type: 'package', id: 'P1', findOneThrows: 'packages' });
add('error: database down for listings', {
  type: 'marketplace',
  id: 'L1',
  findOneThrows: 'marketplace_listings',
});

// ── Running and recording ───────────────────────────────────────────────────

/** Replace what legitimately differs between runs: generated ids and timestamps. */
function normalise(value) {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/photo_\d+_[0-9a-f]{16}/g, 'photo_<ID>')
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
  );
}

async function record(endpoint, scenario, { withEvents = false } = {}) {
  const originalEnv = process.env.NODE_ENV;
  const changesEnv = Boolean(scenario.nodeEnv);
  if (changesEnv) {
    process.env.NODE_ENV = scenario.nodeEnv;
  }
  mockWorld.flags = scenario.flags || { photoAutoApprove: true };
  mockWorld.allowance = scenario.allowance || { allowed: true };
  suppliersRouter.invalidatePackageCaches.mockClear();
  try {
    const { app, dbCalls, uploadCalls, logs, events } = mount(scenario);
    const query =
      scenario.rawQuery ||
      [scenario.type && `type=${scenario.type}`, scenario.id && `id=${scenario.id}`]
        .filter(Boolean)
        .join('&');
    const res = await request(app).post(`/api/photos${endpoint}?${query}`);
    let body = res.text;
    try {
      body = JSON.parse(res.text);
    } catch (_) {
      /* leave text */
    }
    return normalise({
      status: res.status,
      body,
      db: dbCalls,
      uploads: uploadCalls,
      logs,
      cacheInvalidations: suppliersRouter.invalidatePackageCaches.mock.calls.length,
      ...(withEvents ? { events } : {}),
    });
  } finally {
    if (changesEnv) {
      if (originalEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalEnv;
      }
    }
  }
}

const ENDPOINTS = ['/upload', '/upload/batch'];

describe('photo upload routes, characterised', () => {
  const generating = process.env.UPDATE_PHOTOS_CHARACTERIZATION === '1';
  const fixture = generating ? {} : JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const recorded = {};

  afterAll(() => {
    if (generating) {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
    }
  });

  test('the matrix is wide enough to mean something', () => {
    expect(Object.keys(scenarios).length).toBeGreaterThanOrEqual(50);
  });

  for (const endpoint of ENDPOINTS) {
    describe(endpoint, () => {
      test.each(Object.keys(scenarios))('%s', async name => {
        const key = `${endpoint} :: ${name}`;
        const actual = await record(endpoint, scenarios[name]);
        if (generating) {
          recorded[key] = actual;
          return;
        }
        expect(fixture).toHaveProperty([key]);
        expect(actual).toEqual(fixture[key]);
      });
    });
  }

  if (!generating) {
    test('the fixture has no scenarios the matrix no longer runs', () => {
      const expected = ENDPOINTS.flatMap(endpoint =>
        Object.keys(scenarios).map(name => `${endpoint} :: ${name}`)
      ).sort();
      expect(Object.keys(fixture).sort()).toEqual(expected);
    });
  }
});

// ── The target is checked before any file is processed ──────────────────────
//
// The fixture lists database calls and pipeline calls separately, so it cannot tell whether a
// request was authorised before or after its images were stored. These tests can.

describe('the target is looked up and authorised before any file is processed', () => {
  const run = (endpoint, scenario) => record(endpoint, scenario, { withEvents: true });
  const noWrites = result => {
    expect(result.uploads).toEqual([]);
    expect(
      result.events.filter(e => e.startsWith('updateOne') || e.startsWith('insertOne'))
    ).toEqual([]);
    expect(result.cacheInvalidations).toBe(0);
  };

  const refused = [
    ['an unknown type', { type: 'banner', id: 'S1' }, 400],
    ['a supplier that does not exist', { type: 'supplier', id: 'nope' }, 404],
    ['someone else’s supplier', { type: 'supplier', id: 'S-other' }, 403],
    [
      'a supplier already at its photo allowance',
      { type: 'supplier', id: 'S1', allowance: { allowed: false, limit: 10, current: 10 } },
      403,
    ],
    ['a package that does not exist', { type: 'package', id: 'nope' }, 404],
    ['a package whose supplier is missing', { type: 'package', id: 'P-orphan' }, 403],
    ['a package of someone else’s supplier', { type: 'package', id: 'P-foreign' }, 403],
  ];

  describe.each(ENDPOINTS)('%s', endpoint => {
    test.each(refused)('%s stores nothing', async (_name, scenario, status) => {
      const result = await run(endpoint, scenario);
      expect(result.status).toBe(status);
      noWrites(result);
    });

    test('a listing that does not exist or is someone else’s stores nothing', async () => {
      for (const [id, status] of [
        ['nope', 404],
        ['L-other', 403],
      ]) {
        const result = await run(endpoint, { type: 'marketplace', id });
        expect(result.status).toBe(status);
        noWrites(result);
      }
    });

    test('an unknown type is refused without looking anything up', async () => {
      const result = await run(endpoint, { type: 'banner', id: 'S1' });
      expect(result.events).toEqual([]);
    });

    test.each([
      ['supplier', 'S1', ['findOne:suppliers']],
      ['package', 'P1', ['findOne:packages', 'findOne:suppliers']],
      ['marketplace', 'L1', ['findOne:marketplace_listings']],
    ])('a %s is looked up before the first file is processed', async (type, id, lookups) => {
      const result = await run(endpoint, { type, id });
      expect(result.status).toBe(200);
      const firstPipeline = result.events.indexOf('pipeline');
      expect(firstPipeline).toBe(lookups.length);
      expect(result.events.slice(0, firstPipeline)).toEqual(lookups);
    });
  });

  test.each([1, 3])(
    'a batch of %i files is checked against the allowance as that many',
    async count => {
      checkPhotoAllowance.mockClear();
      const files = Array.from({ length: count }, (_, i) => file(`f${i}.jpg`));
      const result = await run('/upload/batch', { type: 'supplier', id: 'S1', files });
      expect(result.status).toBe(200);
      expect(checkPhotoAllowance).toHaveBeenCalledTimes(1);
      expect(checkPhotoAllowance.mock.calls[0][1]).toBe(count);
      // and that check came before the first file was processed
      expect(result.events.indexOf('pipeline')).toBeGreaterThan(
        result.events.indexOf('findOne:suppliers')
      );
    }
  );

  test('a file that then fails to process still counts towards the batch allowance', async () => {
    checkPhotoAllowance.mockClear();
    await run('/upload/batch', {
      type: 'supplier',
      id: 'S1',
      files: [file('a.jpg'), file('validation.jpg')],
    });
    expect(checkPhotoAllowance.mock.calls[0][1]).toBe(2);
  });

  test('the single upload checks the allowance for the one photo it adds', async () => {
    checkPhotoAllowance.mockClear();
    await run('/upload', { type: 'supplier', id: 'S1' });
    expect(checkPhotoAllowance.mock.calls[0][1]).toBe(1);
  });

  test('the single upload refuses several files for a supplier or package, without storing any', async () => {
    const files = [file('a.jpg'), file('b.jpg')];
    for (const [type, id] of [
      ['supplier', 'S1'],
      ['package', 'P1'],
    ]) {
      const result = await run('/upload', { type, id, files });
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/Only one file/);
      expect(result.events).toEqual([]);
    }
  });

  test('the single upload still takes several files for a marketplace listing', async () => {
    const result = await run('/upload', {
      type: 'marketplace',
      id: 'L1',
      files: [file('a.jpg'), file('b.jpg')],
    });
    expect(result.status).toBe(200);
    expect(
      result.uploads.filter(([name]) => name === 'processAndSaveMarketplaceImage')
    ).toHaveLength(2);
  });
});

// ── A package that changes while its photo is processed ─────────────────────
//
// The package is looked up before the file is processed, to authorise the upload. Processing takes
// a while, and another request can add a photo or pick a cover for the same package in that time.
// The write must build on the package as it is when it is saved, or that photo or cover is lost.

describe('a package changed by another request while its photo is processed', () => {
  const run = (endpoint, scenario) => record(endpoint, scenario, { withEvents: true });
  const packageUpdate = result =>
    result.db.find(([call, collection]) => call === 'updateOne' && collection === 'packages');

  describe.each(ENDPOINTS)('%s', endpoint => {
    test('keeps a photo and a cover saved in the meantime', async () => {
      const result = await run(endpoint, {
        type: 'package',
        id: 'P1',
        cloneReads: true,
        duringProcessing: db => {
          const pkg = db.packages.find(p => p.id === 'P1');
          pkg.gallery.push({ url: '/concurrent' });
          pkg.image = '/api/photos/concurrent-cover';
        },
      });

      expect(result.status).toBe(200);
      const [, , , update] = packageUpdate(result);
      expect(update.$set.gallery.map(p => p.url)).toEqual([
        '/pg1',
        '/concurrent',
        '/api/photos/opt_a.jpg',
      ]);
      // P1 had no cover when it was first read, but has one now, so the upload must not replace it
      expect(update.$set).not.toHaveProperty('image');
    });

    test('reads the package again after processing and before writing it', async () => {
      const result = await run(endpoint, { type: 'package', id: 'P1' });
      const lastPipeline = result.events.lastIndexOf('pipeline');
      const reload = result.events.indexOf('findOne:packages', lastPipeline);
      const write = result.events.indexOf('updateOne:packages');
      expect(reload).toBeGreaterThan(lastPipeline);
      expect(write).toBeGreaterThan(reload);
    });

    test('answers 404, and writes nothing, if the package was deleted in the meantime', async () => {
      const result = await run(endpoint, {
        type: 'package',
        id: 'P1',
        duringProcessing: db => {
          db.packages = db.packages.filter(p => p.id !== 'P1');
        },
      });

      expect(result.status).toBe(404);
      expect(result.body).toEqual({ error: 'Package not found' });
      expect(packageUpdate(result)).toBeUndefined();
      expect(result.cacheInvalidations).toBe(0);
    });
  });
});
