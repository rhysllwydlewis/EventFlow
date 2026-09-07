'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));
jest.mock('../../sitemap', () => ({
  generateSitemap: jest.fn().mockResolvedValue('<urlset></urlset>'),
  generateRobotsTxt: jest.fn().mockReturnValue('User-agent: *'),
  generateLlmsTxt: jest.fn().mockReturnValue('# EventFlow\n'),
}));
jest.mock('../../middleware/rateLimits', () => ({
  authLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../../utils/sentry', () => ({
  captureException: jest.fn(),
}));

const { generateLlmsTxt } = require('../../sitemap');
const logger = require('../../utils/logger');
const sentry = require('../../utils/sentry');
const staticRoutes = require('../../routes/static');

function createApp() {
  const app = express();
  app.use(staticRoutes);
  app.use((req, res) => res.status(204).send());
  return app;
}

describe('GET /llms.txt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('serves the generated llms.txt as plain text', async () => {
    generateLlmsTxt.mockReturnValue('# EventFlow\n\n> A UK event services marketplace.\n');

    const response = await request(createApp()).get('/llms.txt').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('# EventFlow\n\n> A UK event services marketplace.\n');
    expect(generateLlmsTxt).toHaveBeenCalledWith(expect.any(String));
  });

  test('returns 500 and reports to sentry if generation fails', async () => {
    const boom = new Error('boom');
    generateLlmsTxt.mockImplementation(() => {
      throw boom;
    });

    await request(createApp()).get('/llms.txt').expect(500);

    expect(logger.error).toHaveBeenCalledWith('Error generating llms.txt:', boom);
    expect(sentry.captureException).toHaveBeenCalledWith(boom);
  });
});
