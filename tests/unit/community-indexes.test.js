/**
 * Index manifest tests for EventFlow Community.
 *
 * Indexes must be named, idempotent and cover every query the routes actually
 * run, so a fresh environment never falls back to a collection scan.
 */

'use strict';

const { COLLECTIONS } = require('../../models/CommunityContent');
const { _test } = require('../../services/communityIndexes.service');

/**
 * Build a MongoDB double that records every createIndex call.
 * @returns {{db: Object, calls: Object[]}} Recorder.
 */
function createRecorder() {
  const calls = [];
  const db = {
    collection(name) {
      return {
        createIndex: async (keys, options) => {
          calls.push({ collection: name, keys, options: options || {} });
          return options && options.name;
        },
      };
    },
  };
  return { db, calls };
}

describe('community index manifest', () => {
  let calls;

  beforeAll(async () => {
    const recorder = createRecorder();
    await _test.createIndexes(recorder.db);
    calls = recorder.calls;
  });

  it('names every index so repeated deploys reconcile rather than duplicate', () => {
    const unnamed = calls.filter(call => !call.options.name);
    expect(unnamed).toEqual([]);
  });

  it('uses a unique name for every index', () => {
    const names = calls.map(call => call.options.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every community collection that is queried', () => {
    const covered = new Set(calls.map(call => call.collection));
    [
      COLLECTIONS.categories,
      COLLECTIONS.discussions,
      COLLECTIONS.replies,
      COLLECTIONS.reactions,
      COLLECTIONS.bookmarks,
      COLLECTIONS.follows,
      COLLECTIONS.reports,
      COLLECTIONS.moderationActions,
      COLLECTIONS.appeals,
      COLLECTIONS.userStats,
      COLLECTIONS.views,
      COLLECTIONS.drafts,
      COLLECTIONS.settings,
      COLLECTIONS.pollVotes,
      COLLECTIONS.canonicalLinks,
      COLLECTIONS.restrictions,
    ].forEach(collection => {
      expect(covered).toContain(collection);
    });
  });

  it('enforces a unique stable id for discussions', () => {
    const index = calls.find(call => call.options.name === 'uniq_community_discussion_stable_id');
    expect(index).toBeDefined();
    expect(index.options.unique).toBe(true);
  });

  it('enforces one reaction per member per post', () => {
    const index = calls.find(call => call.options.name === 'uniq_community_reaction');
    expect(index.options.unique).toBe(true);
    expect(index.keys).toEqual({ targetId: 1, userId: 1, reaction: 1 });
  });

  it('enforces one bookmark and one follow per member per target', () => {
    expect(calls.find(call => call.options.name === 'uniq_community_bookmark').options.unique).toBe(
      true
    );
    expect(calls.find(call => call.options.name === 'uniq_community_follow').options.unique).toBe(
      true
    );
  });

  it('expires view de-duplication records rather than retaining a viewer identifier', () => {
    const index = calls.find(call => call.options.name === 'community_view_ttl');
    expect(index.options.expireAfterSeconds).toBe(0);
  });

  it('indexes the discussion list queries the routes actually run', () => {
    const names = calls.map(call => call.options.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'community_discussion_category_activity',
        'community_discussion_activity',
        'community_discussion_created',
        'community_discussion_author',
        'community_discussion_event_type',
        'community_discussion_region',
        'community_discussion_unanswered',
      ])
    );
  });

  it('provides a weighted full-text index for search', () => {
    const index = calls.find(call => call.options.name === 'community_discussion_fulltext');
    expect(index.keys.title).toBe('text');
    expect(index.options.weights.title).toBeGreaterThan(index.options.weights.searchText);
  });

  it('indexes the moderation queue by priority and age', () => {
    const index = calls.find(call => call.options.name === 'community_report_queue');
    expect(index.keys).toEqual({ status: 1, priority: 1, createdAt: 1 });
  });

  it('is safe to run twice', async () => {
    const recorder = createRecorder();
    await _test.createIndexes(recorder.db);
    await _test.createIndexes(recorder.db);
    const first = recorder.calls.slice(0, calls.length);
    const second = recorder.calls.slice(calls.length);
    expect(second.map(call => call.options.name)).toEqual(first.map(call => call.options.name));
  });
});
