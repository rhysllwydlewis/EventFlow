/**
 * Unit tests for the Google Ads keyword-ideas ingestion: full category
 * coverage in the seed list (a prior version truncated to 20 seeds,
 * which only ever covered the first 2-3 of 20 supplier categories), and
 * batching those seeds across multiple API calls rather than dropping
 * the rest.
 */

'use strict';

jest.mock('../../services/googleAdsClient', () => ({
  isConfigured: jest.fn(),
  missingConfigMessage: jest.fn(() => 'Google Ads API is not configured.'),
  generateKeywordIdeas: jest.fn(),
}));

jest.mock('../../services/seoDataStore', () => ({
  upsertById: jest.fn(),
  recordIngestionStatus: jest.fn(),
}));

const googleAdsClient = require('../../services/googleAdsClient');
const seoDataStore = require('../../services/seoDataStore');
const keywordPlannerIngestion = require('../../services/keywordPlannerIngestion.service');
const { VALID_CATEGORIES } = require('../../models/Supplier');
const {
  COLLECTIONS,
  KEYWORD_SOURCES,
  INGESTION_SOURCES,
  INGESTION_STATUS,
} = require('../../models/SeoInsights');

describe('keywordPlannerIngestion.service.buildSeedKeywords', () => {
  it('includes a seed for every supplier category, not just the first few', () => {
    const seeds = keywordPlannerIngestion.buildSeedKeywords();
    VALID_CATEGORIES.forEach(category => {
      expect(seeds).toContain(category.toLowerCase());
    });
  });
});

describe('keywordPlannerIngestion.service.runIngestion', () => {
  afterEach(() => jest.clearAllMocks());

  it('records an error and throws without calling the API when Google Ads is not configured', async () => {
    googleAdsClient.isConfigured.mockReturnValue(false);

    await expect(keywordPlannerIngestion.runIngestion({ triggeredBy: 'a@b.com' })).rejects.toThrow(
      /not configured/i
    );
    expect(googleAdsClient.generateKeywordIdeas).not.toHaveBeenCalled();
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.keywordPlannerApi,
      INGESTION_STATUS.error,
      expect.objectContaining({ triggeredBy: 'a@b.com' })
    );
  });

  it('sends the full seed list as multiple batched calls rather than truncating it', async () => {
    googleAdsClient.isConfigured.mockReturnValue(true);
    googleAdsClient.generateKeywordIdeas.mockResolvedValue([]);

    await keywordPlannerIngestion.runIngestion({});

    const totalSeeds = keywordPlannerIngestion.buildSeedKeywords().length;
    const expectedBatches = Math.ceil(totalSeeds / 20);
    expect(googleAdsClient.generateKeywordIdeas).toHaveBeenCalledTimes(expectedBatches);

    const seedsSent = googleAdsClient.generateKeywordIdeas.mock.calls.flatMap(call => call[0]);
    VALID_CATEGORIES.forEach(category => {
      expect(seedsSent).toContain(category.toLowerCase());
    });
  });

  it('merges ideas from every batch and upserts each as a keyword row', async () => {
    googleAdsClient.isConfigured.mockReturnValue(true);
    googleAdsClient.generateKeywordIdeas
      .mockResolvedValueOnce([
        { keyword: 'wedding venue', avgMonthlySearches: 500, competition: 'HIGH' },
      ])
      .mockResolvedValue([]);

    const result = await keywordPlannerIngestion.runIngestion({ triggeredBy: 'a@b.com' });

    expect(seoDataStore.upsertById).toHaveBeenCalledWith(
      COLLECTIONS.seoKeywordIdeas,
      `${KEYWORD_SOURCES.googleAdsApi}:wedding venue`,
      expect.objectContaining({
        keyword: 'wedding venue',
        avgMonthlySearches: 500,
        source: KEYWORD_SOURCES.googleAdsApi,
      })
    );
    expect(result.rowsWritten).toBe(1);
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.keywordPlannerApi,
      INGESTION_STATUS.success,
      expect.objectContaining({ rowsWritten: 1 })
    );
  });

  it('records an error and rethrows when a batch call fails', async () => {
    googleAdsClient.isConfigured.mockReturnValue(true);
    googleAdsClient.generateKeywordIdeas.mockRejectedValueOnce(new Error('rate limited'));

    await expect(keywordPlannerIngestion.runIngestion({})).rejects.toThrow('rate limited');
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.keywordPlannerApi,
      INGESTION_STATUS.error,
      expect.objectContaining({ lastError: 'rate limited' })
    );
  });
});
