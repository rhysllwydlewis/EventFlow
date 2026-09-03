'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../cache', () => ({ delPattern: jest.fn().mockResolvedValue(undefined) }));

const cache = require('../../cache');
const abTesting = require('../../middleware/ab-testing');
const { invalidateCacheMiddleware } = require('../../middleware/cache');
const { invalidateSearchCacheMiddleware } = require('../../middleware/searchCache');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('middleware/ab-testing router', () => {
  function buildApp() {
    const app = express();
    app.use('/api/experiments', abTesting);
    return app;
  }

  it('lists active experiments', async () => {
    const response = await request(buildApp()).get('/api/experiments');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.experiments)).toBe(true);
    expect(response.body.experiments.length).toBeGreaterThan(0);
  });

  it('assigns a consistent variant for a known experiment', async () => {
    const response = await request(buildApp()).get(
      '/api/experiments/homepage-hero-cta/variant?userId=user-123'
    );
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.variant).toBe('string');
  });
});

describe('invalidateCacheMiddleware', () => {
  it('invalidates the cache pattern after a successful write response', done => {
    const middleware = invalidateCacheMiddleware();
    const req = { method: 'POST', baseUrl: '/api/widgets' };
    const res = {
      statusCode: 200,
      json(data) {
        setImmediate(() => {
          expect(cache.delPattern).toHaveBeenCalledWith('cache:GET:/api/widgets*');
          done();
        });
        return data;
      },
    };
    middleware(req, res, () => {
      res.json({ ok: true });
    });
  });
});

describe('invalidateSearchCacheMiddleware', () => {
  it('invalidates the search cache pattern after a successful write response', done => {
    const middleware = invalidateSearchCacheMiddleware();
    const req = { method: 'PUT' };
    const res = {
      statusCode: 200,
      json(data) {
        setImmediate(() => {
          expect(cache.delPattern).toHaveBeenCalledWith('search:v2:*');
          done();
        });
        return data;
      },
    };
    middleware(req, res, () => {
      res.json({ ok: true });
    });
  });
});
