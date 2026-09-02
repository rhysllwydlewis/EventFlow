/**
 * Unit tests for the SEO data-access helpers — the find-then-write upsert
 * pattern every ingestion path relies on (dbUnified.updateOne has no
 * upsert option of its own), plus settings and noise-flag storage.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
  insertOne: jest.fn(),
  deleteOne: jest.fn(),
  find: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const seoDataStore = require('../../services/seoDataStore');
const {
  COLLECTIONS,
  SEO_SETTINGS_DOC_ID,
  DEFAULT_SEO_SETTINGS,
} = require('../../models/SeoInsights');

describe('seoDataStore.upsertById', () => {
  afterEach(() => jest.clearAllMocks());

  it('updates an existing document rather than inserting a duplicate', async () => {
    dbUnified.findOne.mockResolvedValueOnce({ id: 'doc1', keyword: 'old' });
    await seoDataStore.upsertById('some_collection', 'doc1', { keyword: 'new' });
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'some_collection',
      { id: 'doc1' },
      { $set: { keyword: 'new' } }
    );
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  it('inserts a new document when none exists yet', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null);
    await seoDataStore.upsertById('some_collection', 'doc2', { keyword: 'fresh' });
    expect(dbUnified.insertOne).toHaveBeenCalledWith('some_collection', {
      id: 'doc2',
      keyword: 'fresh',
    });
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});

describe('seoDataStore ingestion status', () => {
  afterEach(() => jest.clearAllMocks());

  it('records a run status keyed by source', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null);
    await seoDataStore.recordIngestionStatus('gsc', 'success', { rowsWritten: 5 });
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      COLLECTIONS.seoIngestionStatus,
      expect.objectContaining({ id: 'gsc', status: 'success', rowsWritten: 5 })
    );
  });

  it('reads back a single source status', async () => {
    dbUnified.findOne.mockResolvedValueOnce({ id: 'gsc', status: 'success' });
    const result = await seoDataStore.getIngestionStatus('gsc');
    expect(dbUnified.findOne).toHaveBeenCalledWith(COLLECTIONS.seoIngestionStatus, { id: 'gsc' });
    expect(result).toEqual({ id: 'gsc', status: 'success' });
  });

  it('lists every ingestion source status', async () => {
    dbUnified.find.mockResolvedValueOnce([{ id: 'gsc' }, { id: 'keyword_csv' }]);
    const result = await seoDataStore.getAllIngestionStatus();
    expect(dbUnified.find).toHaveBeenCalledWith(COLLECTIONS.seoIngestionStatus, {});
    expect(result).toHaveLength(2);
  });
});

describe('seoDataStore settings', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the default settings when none are stored yet', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null);
    const result = await seoDataStore.getSettings();
    expect(result).toEqual(DEFAULT_SEO_SETTINGS);
  });

  it('returns stored settings when present', async () => {
    dbUnified.findOne.mockResolvedValueOnce({ id: SEO_SETTINGS_DOC_ID, valuePerClick: 3 });
    const result = await seoDataStore.getSettings();
    expect(result.valuePerClick).toBe(3);
  });

  it('writes settings then returns the updated value', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null); // upsertById's existence check
    dbUnified.findOne.mockResolvedValueOnce({ id: SEO_SETTINGS_DOC_ID, valuePerClick: 5 }); // getSettings readback
    const result = await seoDataStore.setSettings({ valuePerClick: 5 });
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      COLLECTIONS.seoSettings,
      expect.objectContaining({ valuePerClick: 5 })
    );
    expect(result.valuePerClick).toBe(5);
  });
});

describe('seoDataStore noise keywords', () => {
  afterEach(() => jest.clearAllMocks());

  it('reports a keyword as noise once flagged', async () => {
    dbUnified.findOne.mockResolvedValueOnce({ id: 'bad query' });
    const result = await seoDataStore.isNoiseKeyword('Bad Query');
    expect(dbUnified.findOne).toHaveBeenCalledWith(COLLECTIONS.seoNoiseKeywords, {
      id: 'bad query',
    });
    expect(result).toBe(true);
  });

  it('reports false for an unflagged keyword', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null);
    expect(await seoDataStore.isNoiseKeyword('fine query')).toBe(false);
  });

  it('marks a keyword as noise, normalising it first', async () => {
    dbUnified.findOne.mockResolvedValueOnce(null);
    const result = await seoDataStore.markNoiseKeyword('  Weird Query  ', {
      markedBy: 'a@b.com',
      reason: 'junk',
    });
    expect(result).toBe('weird query');
    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      COLLECTIONS.seoNoiseKeywords,
      expect.objectContaining({ id: 'weird query', markedBy: 'a@b.com', reason: 'junk' })
    );
  });

  it('does nothing for an empty keyword', async () => {
    const result = await seoDataStore.markNoiseKeyword('   ');
    expect(result).toBeNull();
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  it('unmarks a noise keyword by its normalised id', async () => {
    await seoDataStore.unmarkNoiseKeyword('Some Query');
    expect(dbUnified.deleteOne).toHaveBeenCalledWith(COLLECTIONS.seoNoiseKeywords, 'some query');
  });

  it('lists all noise keywords', async () => {
    dbUnified.find.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const result = await seoDataStore.listNoiseKeywords();
    expect(result).toHaveLength(2);
  });
});
