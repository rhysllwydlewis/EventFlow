/**
 * Integration tests for feature flag enforcement on API routes
 */

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const dbUnified = require('../../db-unified');
const { featureRequired } = require('../../middleware/features');

describe('Feature Flag Enforcement Integration', () => {
  let app;

  beforeAll(async () => {
    // Initialize database
    await dbUnified.initializeDatabase();
  });

  beforeEach(() => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use(cookieParser());
  });

  describe('Registration endpoint with feature flag', () => {
    it('should allow registration when feature is enabled', async () => {
      // Mock endpoint with feature flag
      app.post('/api/auth/register', featureRequired('registration'), (req, res) => {
        res.json({ success: true, message: 'Registration successful' });
      });

      // Ensure registration is enabled
      const settings = await dbUnified.read('settings');
      if (Array.isArray(settings)) {
        // Using local storage, features are enabled by default
        const response = await request(app)
          .post('/api/auth/register')
          .send({ email: 'test@example.com', password: 'Test123!' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should keep registration enabled when stale settings contain false', async () => {
      // Create endpoint with feature flag
      app.post('/api/auth/register', featureRequired('registration'), (req, res) => {
        res.json({ success: true, message: 'Registration successful' });
      });

      // Mock dbUnified to return disabled feature
      const originalRead = dbUnified.read;
      dbUnified.read = jest.fn().mockResolvedValue({
        features: {
          registration: false,
        },
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'Test123!' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original function
      dbUnified.read = originalRead;
    });
  });

  describe('Reviews endpoint with feature flag', () => {
    it('should allow review submission when feature is enabled', async () => {
      app.post('/api/reviews', featureRequired('reviews'), (req, res) => {
        res.json({ success: true, message: 'Review submitted' });
      });

      const response = await request(app)
        .post('/api/reviews')
        .send({ rating: 5, comment: 'Great!' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should keep reviews enabled when stale settings contain false', async () => {
      app.post('/api/reviews', featureRequired('reviews'), (req, res) => {
        res.json({ success: true, message: 'Review submitted' });
      });

      // Mock dbUnified to return disabled feature
      const originalRead = dbUnified.read;
      dbUnified.read = jest.fn().mockResolvedValue({
        features: {
          reviews: false,
        },
      });

      const response = await request(app)
        .post('/api/reviews')
        .send({ rating: 5, comment: 'Great!' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original function
      dbUnified.read = originalRead;
    });
  });

  describe('Photo uploads endpoint with feature flag', () => {
    it('should keep photo uploads enabled when stale settings contain false', async () => {
      app.post('/api/photos/upload', featureRequired('photoUploads'), (req, res) => {
        res.json({ success: true, message: 'Photo uploaded' });
      });

      // Mock dbUnified to return disabled feature
      const originalRead = dbUnified.read;
      dbUnified.read = jest.fn().mockResolvedValue({
        features: {
          photoUploads: false,
        },
      });

      const response = await request(app).post('/api/photos/upload').send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original function
      dbUnified.read = originalRead;
    });
  });

  describe('Support tickets endpoint with feature flag', () => {
    it('should keep support tickets enabled when stale settings contain false', async () => {
      app.post('/api/tickets', featureRequired('supportTickets'), (req, res) => {
        res.json({ success: true, message: 'Ticket created' });
      });

      // Mock dbUnified to return disabled feature
      const originalRead = dbUnified.read;
      dbUnified.read = jest.fn().mockResolvedValue({
        features: {
          supportTickets: false,
        },
      });

      const response = await request(app)
        .post('/api/tickets')
        .send({ subject: 'Help', message: 'Need assistance' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original function
      dbUnified.read = originalRead;
    });
  });

  describe('Supplier applications with feature flag', () => {
    it('should keep supplier applications enabled when stale settings contain false', async () => {
      app.post('/api/auth/register', featureRequired('supplierApplications'), (req, res) => {
        res.json({ success: true, message: 'Supplier registered' });
      });

      // Mock dbUnified to return disabled feature
      const originalRead = dbUnified.read;
      dbUnified.read = jest.fn().mockResolvedValue({
        features: {
          supplierApplications: false,
        },
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ email: 'supplier@example.com', role: 'supplier' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Restore original function
      dbUnified.read = originalRead;
    });
  });
});
