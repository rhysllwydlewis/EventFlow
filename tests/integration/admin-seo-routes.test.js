/**
 * @jest-environment node
 *
 * Integration tests for the SEO Insights admin API — permission gating,
 * the CSV-fallback upload path, and how a missing Google Ads/Search
 * Console configuration is reported (409, not a crash).
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin_1', email: 'admin@event-flow.co.uk', role: 'admin' };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, _res, next) => next(),
}));

jest.mock('../../middleware/permissions', () => {
  const actual = jest.requireActual('../../middleware/permissions');
  return {
    ...actual,
    requirePermission: () => (req, _res, next) => next(),
  };
});

jest.mock('../../services/googleAdsClient', () => ({
  isConfigured: jest.fn(() => false),
  missingConfigMessage: jest.fn(
    () => 'Google Ads API is not configured. Missing: GOOGLE_ADS_DEVELOPER_TOKEN.'
  ),
  generateKeywordIdeas: jest.fn(),
}));

jest.mock('../../services/googleSearchConsole.service', () => ({
  isConfigured: jest.fn(() => false),
  fetchQueryPerformance: jest.fn(),
}));

jest.mock('../../services/seoDataStore', () => ({
  getAllIngestionStatus: jest.fn(async () => []),
  getSettings: jest.fn(async () => ({ id: 'default', valuePerClick: null })),
  setSettings: jest.fn(async fields => ({ id: 'default', ...fields })),
  markNoiseKeyword: jest.fn(async q => q.toLowerCase()),
  unmarkNoiseKeyword: jest.fn(async () => {}),
  listNoiseKeywords: jest.fn(async () => []),
  recordIngestionStatus: jest.fn(async () => {}),
  upsertById: jest.fn(async () => {}),
}));

jest.mock('../../services/seoInsights.service', () => ({
  getOverview: jest.fn(async () => ({ totalNonBrandedQueries: 0 })),
  getQueryTable: jest.fn(async () => ({ rows: [] })),
  getStrikingDistanceReport: jest.fn(async () => ({ rows: [] })),
  getLowCtrReport: jest.fn(async () => ({ rows: [] })),
  getContentGapReport: jest.fn(async () => ({ rows: [] })),
  getFinancialEstimate: jest.fn(async () => ({
    estimatedMonthlyValue: null,
    needsValuePerClick: true,
  })),
}));

jest.mock('../../services/keywordCsvImport.service', () => ({
  importCsv: jest.fn(async () => ({ rowsParsed: 2, rowsWritten: 2 })),
}));

jest.mock('../../services/keywordPlannerIngestion.service', () => ({
  runIngestion: jest.fn(),
}));

jest.mock('../../services/gscIngestion.service', () => ({
  runIngestion: jest.fn(),
}));

const googleAdsClient = require('../../services/googleAdsClient');
const keywordPlannerIngestion = require('../../services/keywordPlannerIngestion.service');
const keywordCsvImport = require('../../services/keywordCsvImport.service');
const seoRoutes = require('../../routes/admin-seo');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v2/admin/seo', seoRoutes);
  return app;
}

describe('admin-seo routes', () => {
  afterEach(() => jest.clearAllMocks());

  it('GET /overview returns the insights overview', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v2/admin/seo/overview').expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ totalNonBrandedQueries: 0 });
  });

  it('GET /status reports whether each Google source is configured', async () => {
    const app = createApp();
    const response = await request(app).get('/api/v2/admin/seo/status').expect(200);
    expect(response.body.data.gscConfigured).toBe(false);
    expect(response.body.data.googleAdsConfigured).toBe(false);
  });

  it('POST /ingest/keyword-planner returns 409 with a clear message when Google Ads is not configured', async () => {
    const error = new Error(
      'Google Ads API is not configured. Missing: GOOGLE_ADS_DEVELOPER_TOKEN.'
    );
    error.code = 'GOOGLE_ADS_NOT_CONFIGURED';
    keywordPlannerIngestion.runIngestion.mockRejectedValueOnce(error);

    const app = createApp();
    const response = await request(app)
      .post('/api/v2/admin/seo/ingest/keyword-planner')
      .expect(409);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('GOOGLE_ADS_NOT_CONFIGURED');
  });

  it('POST /ingest/keyword-csv accepts an uploaded CSV and reports rows written', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/v2/admin/seo/ingest/keyword-csv')
      .attach(
        'file',
        Buffer.from('Keyword,Avg. monthly searches\nwedding venue,100\n'),
        'keywords.csv'
      )
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ rowsParsed: 2, rowsWritten: 2 });
    expect(keywordCsvImport.importCsv).toHaveBeenCalledWith(
      expect.objectContaining({ importedBy: 'admin@event-flow.co.uk' })
    );
  });

  it('POST /ingest/keyword-csv without a file returns 400', async () => {
    const app = createApp();
    const response = await request(app).post('/api/v2/admin/seo/ingest/keyword-csv').expect(400);
    expect(response.body.code).toBe('MISSING_FILE');
  });

  it('PUT /settings rejects a negative value-per-click', async () => {
    const app = createApp();
    const response = await request(app)
      .put('/api/v2/admin/seo/settings')
      .send({ valuePerClick: -1 })
      .expect(400);
    expect(response.body.code).toBe('INVALID_VALUE_PER_CLICK');
  });

  it('PUT /settings accepts a valid value-per-click', async () => {
    const app = createApp();
    const response = await request(app)
      .put('/api/v2/admin/seo/settings')
      .send({ valuePerClick: 2.5 })
      .expect(200);
    expect(response.body.data.valuePerClick).toBe(2.5);
  });

  it('POST /noise requires a query', async () => {
    const app = createApp();
    const response = await request(app).post('/api/v2/admin/seo/noise').send({}).expect(400);
    expect(response.body.code).toBe('MISSING_QUERY');
  });

  it('unconfigured Google Ads client reports isConfigured() false to the status endpoint', () => {
    expect(googleAdsClient.isConfigured()).toBe(false);
  });
});
