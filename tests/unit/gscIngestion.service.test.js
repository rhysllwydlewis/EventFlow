/**
 * Unit tests for the GSC ingestion orchestration: not-configured and
 * fetch-error handling, and the stale-row fix — a re-pull of the same
 * period must not leave last run's now-dropped queries behind.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  deleteMany: jest.fn(),
}));

jest.mock('../../services/googleSearchConsole.service', () => ({
  isConfigured: jest.fn(),
  fetchQueryPerformance: jest.fn(),
}));

jest.mock('../../services/seoDataStore', () => ({
  upsertById: jest.fn(),
  recordIngestionStatus: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const googleSearchConsole = require('../../services/googleSearchConsole.service');
const seoDataStore = require('../../services/seoDataStore');
const gscIngestion = require('../../services/gscIngestion.service');
const { COLLECTIONS, INGESTION_SOURCES, INGESTION_STATUS } = require('../../models/SeoInsights');

describe('gscIngestion.service.runIngestion', () => {
  beforeEach(() => {
    process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY = 'sc-domain:event-flow.co.uk';
  });

  afterEach(() => jest.clearAllMocks());

  it('records an error and throws without fetching when GSC is not configured', async () => {
    googleSearchConsole.isConfigured.mockReturnValue(false);

    await expect(gscIngestion.runIngestion({ triggeredBy: 'a@b.com' })).rejects.toThrow(
      /not configured/i
    );

    expect(googleSearchConsole.fetchQueryPerformance).not.toHaveBeenCalled();
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.gsc,
      INGESTION_STATUS.error,
      expect.objectContaining({ triggeredBy: 'a@b.com' })
    );
  });

  it('records the fetch error and rethrows when the GSC API call fails', async () => {
    googleSearchConsole.isConfigured.mockReturnValue(true);
    googleSearchConsole.fetchQueryPerformance.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      gscIngestion.runIngestion({ startDate: '2026-01-01', endDate: '2026-01-31' })
    ).rejects.toThrow('quota exceeded');
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.gsc,
      INGESTION_STATUS.error,
      expect.objectContaining({ lastError: 'quota exceeded' })
    );
  });

  it("clears the period's prior batch before writing the new one, so dropped queries do not linger", async () => {
    googleSearchConsole.isConfigured.mockReturnValue(true);
    googleSearchConsole.fetchQueryPerformance.mockResolvedValueOnce([
      { query: 'wedding venue', clicks: 3, impressions: 50, ctr: 0.06, position: 6 },
    ]);

    const result = await gscIngestion.runIngestion({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(dbUnified.deleteMany).toHaveBeenCalledWith(COLLECTIONS.seoQuerySnapshots, {
      property: 'sc-domain:event-flow.co.uk',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
    });
    // The delete must happen before any row for the new batch is written.
    const deleteOrder = dbUnified.deleteMany.mock.invocationCallOrder[0];
    const upsertOrder = seoDataStore.upsertById.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(upsertOrder);

    expect(seoDataStore.upsertById).toHaveBeenCalledWith(
      COLLECTIONS.seoQuerySnapshots,
      expect.stringContaining('wedding venue'),
      expect.objectContaining({ query: 'wedding venue', clicks: 3, isBranded: false })
    );
    expect(result.rowsWritten).toBe(1);
    expect(seoDataStore.recordIngestionStatus).toHaveBeenCalledWith(
      INGESTION_SOURCES.gsc,
      INGESTION_STATUS.success,
      expect.objectContaining({ rowsWritten: 1 })
    );
  });

  it('still clears the prior batch on a zero-row run, rather than leaving stale data silently in place', async () => {
    googleSearchConsole.isConfigured.mockReturnValue(true);
    googleSearchConsole.fetchQueryPerformance.mockResolvedValueOnce([]);

    const result = await gscIngestion.runIngestion({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(dbUnified.deleteMany).toHaveBeenCalledTimes(1);
    expect(seoDataStore.upsertById).not.toHaveBeenCalled();
    expect(result.rowsWritten).toBe(0);
  });
});
