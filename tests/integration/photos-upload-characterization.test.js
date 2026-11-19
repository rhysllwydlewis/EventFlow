/**
 * Characterisation of POST /api/photos/upload and POST /api/photos/upload/batch.
 *
 * Those two handlers were each a single 300-line function (cyclomatic complexity 44 and 49) and
 * were refactored into small functions without changing what they do. This test pins what they
 * do: it drives the real router with fake database, photo pipeline, logger and feature flags
 * across a matrix of scenarios, and compares everything observable (the HTTP status and body,
 * every database call, every photo pipeline call, every log line, cache invalidations) with a
 * recorded fixture generated from the code *before* the refactor.
 *
 * To regenerate the fixture after an intended behaviour change:
 *   UPDATE_PHOTOS_CHARACTERIZATION=1 npx jest tests/integration/photos-upload-characterization.test.js
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
const world = { flags: { photoAutoApprove: true }, allowance: { allowed: true } };

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
jest.mock('../../middleware/rateLimits', () => {
  const pass = (_req, _res, next) => next();
  return { uploadLimiter: pass, apiLimiter: pass };
});
jest.mock('../../middleware/features', () => ({
  getFeatureFlags: jest.fn(async () => world.flags),
}));
jest.mock('../../utils/photoGalleryAllowance', () => ({
  checkPhotoAllowance: jest.fn(async () => world.allowance),
  photoLimitError: jest.fn((limit, current) => ({ error: 'photo limit', limit, current })),
}));

const router = require('../../routes/photos');
const suppliersRouter = require('../../routes/suppliers');

// ── The world a scenario runs in ────────────────────────────────────────────

const clone = value => JSON.parse(JSON.stringify(value));

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

function makePhotoUpload(calls, files) {
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
      const failure = failureFor(name);
      if (failure) {
        throw failure;
      }
      return results(name);
    }),
    processAndSaveMarketplaceImage: jest.fn(async (buffer, name, listingId, userId, order) => {
      calls.push(['processAndSaveMarketplaceImage', name, listingId, userId, order, buffer.length]);
      const failure = failureFor(name);
      if (failure) {
        throw failure;
      }
      return { optimized: `/api/photos/mk_${name}_${order}` };
    }),
    getImageMetadata: jest.fn(async buffer => {
      calls.push(['getImageMetadata', buffer.length]);
      return { width: 100, height: 80, format: 'jpeg' };
    }),
  };
}

function mount(scenario) {
  const db = scenario.db ? scenario.db(freshDb()) : freshDb();
  const dbCalls = [];
  const uploadCalls = [];
  const logs = [];
  const files = scenario.files || [file('a.jpg')];

  const find = (collection, query) =>
    (db[collection] || []).find(item => Object.entries(query).every(([k, v]) => item[k] === v)) ||
    null;
  const dbUnified = {
    findOne: jest.fn(async (collection, query) => {
      dbCalls.push(['findOne', collection, query]);
      if (scenario.findOneThrows === collection) {
        throw new Error('db down');
      }
      return find(collection, query);
    }),
    updateOne: jest.fn(async (collection, filter, update) => {
      dbCalls.push(['updateOne', collection, filter, update]);
      return true;
    }),
    insertOne: jest.fn(async (collection, doc) => {
      dbCalls.push(['insertOne', collection, doc]);
      return scenario.insertOk === false ? null : doc;
    }),
  };
  const logger = ['info', 'warn', 'error', 'debug'].reduce((acc, level) => {
    acc[level] = jest.fn(message => logs.push([level, message]));
    return acc;
  }, {});
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
    photoUpload: makePhotoUpload(uploadCalls, files),
    logger,
  });
  const app = express();
  app.use('/api', router);
  return { app, dbCalls, uploadCalls, logs };
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

async function record(endpoint, scenario) {
  const originalEnv = process.env.NODE_ENV;
  if (scenario.nodeEnv) {
    process.env.NODE_ENV = scenario.nodeEnv;
  }
  world.flags = scenario.flags || { photoAutoApprove: true };
  world.allowance = scenario.allowance || { allowed: true };
  suppliersRouter.invalidatePackageCaches.mockClear();
  try {
    const { app, dbCalls, uploadCalls, logs } = mount(scenario);
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
    });
  } finally {
    process.env.NODE_ENV = originalEnv;
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
