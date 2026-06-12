const express = require('express');
const request = require('supertest');

function buildDeps() {
  const listings = [
    {
      id: 'mkt_1',
      userId: 'user_1',
      images: [],
      updatedAt: new Date().toISOString(),
    },
  ];

  const dbUnified = {
    read: jest.fn(async collection => {
      if (collection === 'marketplace_listings') {
        return listings;
      }
      return [];
    }),
    // findOne used by the refactored route (marketplace listing lookup)
    findOne: jest.fn(async (collection, filter) => {
      if (collection === 'marketplace_listings') {
        return listings.find(l => l.id === filter.id) || null;
      }
      if (collection === 'suppliers') {
        return null; // no supplier needed for marketplace type
      }
      return null;
    }),
    find: jest.fn().mockResolvedValue([]),
    write: jest.fn(async () => {}),
    updateOne: jest.fn().mockResolvedValue(true),
    insertOne: jest.fn().mockResolvedValue(true),
    deleteOne: jest.fn().mockResolvedValue(true),
  };

  const upload = {
    fields: jest.fn(fields => {
      return (req, _res, next) => {
        const fieldName = req.headers['x-test-field'] || 'photos';
        const fakeFile = {
          originalname: 'test.jpg',
          buffer: Buffer.from('fake-image-bytes'),
          mimetype: 'image/jpeg',
        };

        req.files = {
          [fieldName]: [fakeFile],
        };
        req._uploadFields = fields;
        next();
      };
    }),
  };

  const photoUpload = {
    upload,
    processAndSaveImage: jest.fn(async () => ({
      optimized: '/uploads/optimized/test.jpg',
      thumbnail: '/uploads/thumbnails/test.jpg',
      large: '/uploads/large/test.jpg',
      original: '/uploads/original/test.jpg',
    })),
    processAndSaveMarketplaceImage: jest.fn(async () => ({
      optimized: '/uploads/optimized/test.jpg',
      thumbnail: '/uploads/thumbnails/test.jpg',
      large: '/uploads/large/test.jpg',
      original: '/uploads/original/test.jpg',
    })),
    getImageMetadata: jest.fn(async () => ({ width: 100, height: 100 })),
  };

  return {
    dbUnified,
    authRequired: (req, _res, next) => {
      req.user = { id: 'user_1', role: 'supplier' };
      next();
    },
    roleRequired: () => (_req, _res, next) => next(),
    featureRequired: () => (_req, _res, next) => next(),
    csrfProtection: (_req, _res, next) => next(),
    photoUpload,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
}

describe('Photos routes multipart field compatibility', () => {
  function buildApp() {
    jest.resetModules();
    const photosRouter = require('../../routes/photos');
    const deps = buildDeps();
    photosRouter.initializeDependencies(deps);

    const app = express();
    app.use('/api/v1', photosRouter);

    return { app, deps };
  }

  it('accepts single-upload marketplace image when multipart field is files', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post('/api/v1/photos/upload?type=marketplace&id=mkt_1')
      .set('x-test-field', 'files');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.urls).toEqual(['/uploads/optimized/test.jpg']);
  });

  it('accepts batch-upload marketplace image when multipart field is files', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post('/api/v1/photos/upload/batch?type=marketplace&id=mkt_1')
      .set('x-test-field', 'files');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.urls).toEqual(['/uploads/optimized/test.jpg']);
  });

  it('accepts batch-upload marketplace image when multipart field is photos', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post('/api/v1/photos/upload/batch?type=marketplace&id=mkt_1')
      .set('x-test-field', 'photos');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.urls).toEqual(['/uploads/optimized/test.jpg']);
  });
});
