/**
 * Unit tests for Swagger/OpenAPI endpoint protection.
 *
 * Verifies that:
 *  - In production mode (ENABLE_API_DOCS not set), doc endpoints return 404.
 *  - When ENABLE_API_DOCS=true, doc endpoints are accessible in production.
 *  - In non-production mode, doc endpoints are accessible by default.
 *  - apiDocsLimiter is exported from middleware/rateLimits.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app that replicates the server.js API-docs gating
 * logic without loading the entire application.
 */
function buildApp({ nodeEnv = 'production', enableApiDocs = undefined } = {}) {
  const app = express();

  const isProduction = nodeEnv === 'production';
  const apiDocsEnabled = enableApiDocs === 'true' || !isProduction;

  if (apiDocsEnabled) {
    app.get('/api-docs', (_req, res) => res.status(200).json({ status: 'docs available' }));
    app.get('/api-docs/swagger.json', (_req, res) =>
      res.status(200).json({ openapi: '3.0.0', info: { title: 'Test' } })
    );
  } else {
    const handler = (req, res) => res.status(404).json({ error: 'Not found', status: 404 });
    app.use(['/api-docs', '/swagger', '/swagger.json', '/openapi', '/openapi.json'], handler);
  }

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API docs endpoint protection', () => {
  describe('Production mode (ENABLE_API_DOCS not set)', () => {
    let app;
    beforeAll(() => {
      app = buildApp({ nodeEnv: 'production', enableApiDocs: undefined });
    });

    it('returns 404 for GET /api-docs', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /api-docs/swagger.json', async () => {
      const res = await request(app).get('/api-docs/swagger.json');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /swagger', async () => {
      const res = await request(app).get('/swagger');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /openapi.json', async () => {
      const res = await request(app).get('/openapi.json');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /openapi', async () => {
      const res = await request(app).get('/openapi');
      expect(res.status).toBe(404);
    });

    it('404 response body has expected shape', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.body).toMatchObject({ error: 'Not found', status: 404 });
    });
  });

  describe('Production mode with ENABLE_API_DOCS=true', () => {
    let app;
    beforeAll(() => {
      app = buildApp({ nodeEnv: 'production', enableApiDocs: 'true' });
    });

    it('returns 200 for GET /api-docs when explicitly enabled', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.status).toBe(200);
    });

    it('returns 200 for GET /api-docs/swagger.json when explicitly enabled', async () => {
      const res = await request(app).get('/api-docs/swagger.json');
      expect(res.status).toBe(200);
    });
  });

  describe('Non-production mode (development)', () => {
    let app;
    beforeAll(() => {
      app = buildApp({ nodeEnv: 'development', enableApiDocs: undefined });
    });

    it('returns 200 for GET /api-docs in development', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.status).toBe(200);
    });

    it('returns 200 for GET /api-docs/swagger.json in development', async () => {
      const res = await request(app).get('/api-docs/swagger.json');
      expect(res.status).toBe(200);
    });
  });
});

describe('apiDocsLimiter export', () => {
  it('is exported from middleware/rateLimits', () => {
    const { apiDocsLimiter } = require('../../middleware/rateLimits');
    expect(typeof apiDocsLimiter).toBe('function');
  });
});
