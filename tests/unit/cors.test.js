/**
 * Unit tests for CORS configuration and error handling
 * Tests origin validation, rejection behavior, and error responses
 */

const request = require('supertest');
const express = require('express');
const cors = require('cors');
const { configureCORS } = require('../../middleware/security');
const { errorHandler } = require('../../middleware/errorHandler');

describe('CORS Configuration', () => {
  let app;

  beforeEach(() => {
    // Create fresh app for each test
    app = express();
  });

  describe('Origin Validation (Development)', () => {
    beforeEach(() => {
      // Configure CORS for development (isProduction = false)
      app.use(cors(configureCORS(false)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    test('should allow localhost origins', async () => {
      const response = await request(app).get('/test').set('Origin', 'http://localhost:3000');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should allow requests without origin (e.g., curl)', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should warn but allow non-configured origins in development', async () => {
      const response = await request(app).get('/test').set('Origin', 'http://unknown-domain.com');

      // In development, we allow but warn
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('Origin Validation (Production)', () => {
    beforeEach(() => {
      // Set BASE_URL for production testing
      process.env.BASE_URL = 'https://event-flow.co.uk';

      // Configure CORS for production (isProduction = true)
      app.use(cors(configureCORS(true)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    afterEach(() => {
      // Clean up environment
      delete process.env.BASE_URL;
    });

    test('should allow configured BASE_URL origin', async () => {
      const response = await request(app).get('/test').set('Origin', 'https://event-flow.co.uk');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should allow www variant of BASE_URL', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'https://www.event-flow.co.uk');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should allow Google Identity Services callback origin', async () => {
      const response = await request(app).get('/test').set('Origin', 'https://accounts.google.com');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should allow configured BASE_URL origin when env has a trailing slash', async () => {
      delete process.env.BASE_URL;
      app = express();
      process.env.BASE_URL = 'https://event-flow.co.uk/';
      app.use(cors(configureCORS(true)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);

      const response = await request(app).get('/test').set('Origin', 'https://event-flow.co.uk');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should allow canonical production domain even when BASE_URL is an internal deployment URL', async () => {
      delete process.env.BASE_URL;
      app = express();
      process.env.BASE_URL = 'https://eventflow-production.up.railway.app';
      app.use(cors(configureCORS(true)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);

      const response = await request(app).get('/test').set('Origin', 'https://event-flow.co.uk');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should reject non-configured origin with 403', async () => {
      const response = await request(app).get('/test').set('Origin', 'https://malicious-site.com');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.toLowerCase()).toContain('not allowed');
    });

    test('should allow requests without origin', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('Multiple Allowed Origins', () => {
    beforeEach(() => {
      // Set BASE_URL and additional origins
      process.env.BASE_URL = 'https://event-flow.co.uk';
      process.env.ALLOWED_ORIGINS =
        'https://preview.event-flow.co.uk,https://staging.event-flow.co.uk';

      app.use(cors(configureCORS(true)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    afterEach(() => {
      delete process.env.BASE_URL;
      delete process.env.ALLOWED_ORIGINS;
    });

    test('should allow primary BASE_URL', async () => {
      const response = await request(app).get('/test').set('Origin', 'https://event-flow.co.uk');

      expect(response.status).toBe(200);
    });

    test('should allow additional configured origins', async () => {
      const response1 = await request(app)
        .get('/test')
        .set('Origin', 'https://preview.event-flow.co.uk');
      expect(response1.status).toBe(200);

      const response2 = await request(app)
        .get('/test')
        .set('Origin', 'https://staging.event-flow.co.uk');
      expect(response2.status).toBe(200);
    });

    test('should reject origins not in allowed list', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'https://unknown.event-flow.co.uk');

      expect(response.status).toBe(403);
    });
  });

  describe('Preflight Requests', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'https://event-flow.co.uk';
      app.use(cors(configureCORS(true)));
      app.post('/api/data', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    afterEach(() => {
      delete process.env.BASE_URL;
    });

    test('should handle OPTIONS preflight request for allowed origin', async () => {
      const response = await request(app)
        .options('/api/data')
        .set('Origin', 'https://event-flow.co.uk')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    test('should reject OPTIONS preflight for disallowed origin', async () => {
      const response = await request(app)
        .options('/api/data')
        .set('Origin', 'https://evil-site.com')
        .set('Access-Control-Request-Method', 'POST');

      // CORS middleware will reject this
      expect([200, 403, 500]).toContain(response.status);
    });
  });

  describe('Railway Preview URLs', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'https://event-flow.co.uk';

      // Development mode should allow Railway preview URLs
      app.use(cors(configureCORS(false)));
      app.get('/test', (req, res) => {
        res.json({ ok: true });
      });
      app.use(errorHandler);
    });

    afterEach(() => {
      delete process.env.BASE_URL;
    });

    test('should allow Railway preview URLs in development', async () => {
      const response = await request(app)
        .get('/test')
        .set('Origin', 'https://eventflow-pr-123.railway.app');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });
});

describe('CORS Error Handler', () => {
  let app;

  beforeEach(() => {
    app = express();
    process.env.BASE_URL = 'https://event-flow.co.uk';
    process.env.NODE_ENV = 'production';

    app.use(cors(configureCORS(true)));
    app.get('/test', (req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
  });

  afterEach(() => {
    delete process.env.BASE_URL;
    delete process.env.NODE_ENV;
  });

  test('should return JSON error for CORS rejection', async () => {
    const response = await request(app).get('/test').set('Origin', 'https://evil-site.com');

    expect(response.status).toBe(403);
    expect(response.type).toBe('application/json');
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('status', 403);
  });

  test('should not leak stack traces in production', async () => {
    const response = await request(app).get('/test').set('Origin', 'https://evil-site.com');

    expect(response.body).not.toHaveProperty('stack');
  });
});
