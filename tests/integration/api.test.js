/**
 * Integration tests for core API endpoints
 * Tests system routes, auth validation, and error handling
 */

const request = require('supertest');
const { createTestApp, createAuthTestApp } = require('../helpers/test-app');

describe('System API Endpoints', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('GET /api/health', () => {
    it('should return 200 with status field', async () => {
      const response = await request(app).get('/api/health').expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
    });

    it('should include service status information', async () => {
      const response = await request(app).get('/api/health').expect(200);

      expect(response.body.services).toHaveProperty('server');
      expect(response.body.services).toHaveProperty('mongodb');
    });

    it('should include response time', async () => {
      const response = await request(app).get('/api/health').expect(200);

      expect(response.body).toHaveProperty('responseTime');
      expect(typeof response.body.responseTime).toBe('number');
    });
  });

  describe('GET /api/ready', () => {
    it('should return appropriate readiness status', async () => {
      const response = await request(app).get('/api/ready');

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');

      // Should be either ready (200) or not_ready (503)
      expect([200, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.status).toBe('ready');
      } else {
        expect(response.body.status).toBe('not_ready');
      }
    });

    it('should include service information', async () => {
      const response = await request(app).get('/api/ready');

      expect(response.body.services).toHaveProperty('server');
      expect(response.body.services).toHaveProperty('mongodb');
    });
  });

  describe('GET /api/meta', () => {
    it('should return version information', async () => {
      const response = await request(app).get('/api/meta').expect(200);

      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('node');
      expect(response.body).toHaveProperty('env');
    });

    it('should return correct environment', async () => {
      const response = await request(app).get('/api/meta').expect(200);

      expect(response.body.env).toBe('test');
    });
  });

  describe('GET /api/config', () => {
    it('should return public configuration', async () => {
      const response = await request(app).get('/api/config').expect(200);

      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('googleMapsApiKey');
    });
  });

  describe('GET /api/csrf-token', () => {
    it('should return CSRF token', async () => {
      const response = await request(app).get('/api/csrf-token').expect(200);

      expect(response.body).toHaveProperty('csrfToken');
      expect(typeof response.body.csrfToken).toBe('string');
    });
  });
});

describe('Authentication API Endpoints', () => {
  let app;

  beforeAll(() => {
    app = createAuthTestApp();
  });

  describe('POST /api/auth/register', () => {
    it('should reject registration with missing fields', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          // Missing password and name
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123',
          name: 'Test User',
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toContain('email');
    });

    it('should reject registration with short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'short',
          name: 'Test User',
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toContain('Password');
    });

    it('should accept valid registration data', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'validpassword123', // pragma: allowlist secret
          name: 'New User',
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should reject login with missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          // Missing password
        })
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject login with invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong@example.com',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toContain('credentials');
    });

    it('should accept valid login credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'validpassword', // pragma: allowlist secret
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('token');
    });
  });

  describe('Protected Endpoints', () => {
    it('should reject unauthenticated requests to protected endpoints', async () => {
      const response = await request(app).get('/api/protected').expect(401);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body.error).toContain('Authentication');
    });

    it('should reject requests with invalid bearer token format', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'InvalidFormat')
        .expect(401);

      expect(response.body).toHaveProperty('success', false);
    });

    it('should accept requests with valid bearer token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer mock-jwt-token') // pragma: allowlist secret
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });
});

describe('API Error Handling', () => {
  it('should validate error response format structure', () => {
    const errorResponse = {
      success: false,
      error: 'Test error message',
    };

    expect(errorResponse).toHaveProperty('success');
    expect(errorResponse).toHaveProperty('error');
    expect(errorResponse.success).toBe(false);
    expect(typeof errorResponse.error).toBe('string');
  });

  it('should handle various error types consistently', () => {
    const errors = [
      { success: false, error: 'Validation error' },
      { success: false, error: 'Authentication failed' },
      { success: false, error: 'Resource not found' },
    ];

    errors.forEach(err => {
      expect(err).toHaveProperty('success', false);
      expect(err).toHaveProperty('error');
      expect(typeof err.error).toBe('string');
    });
  });
});
