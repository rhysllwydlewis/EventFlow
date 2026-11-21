/**
 * POST /api/reviews/photos/upload records whose each stored review photo is.
 *
 * A review photo is a customer's. Stored images carry no owner by default, so a supplier could copy
 * a review photo's address into their own gallery and delete it from there, destroying the
 * customer's photo (for example on a bad review of that supplier). Recording the customer as the
 * owner lets the delete routes see that the image is not the supplier's.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/rateLimits', () => {
  const pass = (_req, _res, next) => next();
  return { uploadLimiter: pass, writeLimiter: pass, apiLimiter: pass };
});

const pass = (_req, _res, next) => next();

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/reviews');
  const processAndSaveImage = jest.fn(async (_buffer, name) => ({
    optimized: `/api/photos/opt_${name}`,
  }));
  const photoUpload = {
    upload: {
      fields: () => (req, _res, done) => {
        req.files = {
          photos: [{ originalname: 'one.jpg', buffer: Buffer.from('x') }],
        };
        done();
      },
    },
    processAndSaveImage,
  };
  router.initializeDependencies({
    dbUnified: {},
    authRequired: (req, _res, next) => {
      req.user = { id: 'customer_9', role: 'customer' };
      next();
    },
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    featureRequired: () => pass,
    csrfProtection: pass,
    reviewsSystem: {},
    photoUpload,
  });
  const app = express();
  app.use('/api', router);
  return { app, processAndSaveImage };
}

describe('review photo upload', () => {
  test('stores the photo with the customer as its owner', async () => {
    const { app, processAndSaveImage } = buildApp();

    const response = await request(app).post('/api/reviews/photos/upload').expect(200);

    expect(response.body.urls).toEqual(['/api/photos/opt_one.jpg']);
    expect(processAndSaveImage).toHaveBeenCalledWith(Buffer.from('x'), 'one.jpg', 'supplier', {
      ownerUserId: 'customer_9',
      uploadedBy: 'customer_9',
    });
  });
});
