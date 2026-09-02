/**
 * Unit tests for the Keyword Planner CSV fallback parser — the path that
 * works with zero Google Ads API setup. Covers the shape of Google's real
 * export (metadata lines before the header, quoted fields, bucketed
 * volume ranges) rather than a hand-simplified fixture.
 */

'use strict';

const { parseKeywordPlannerCsv, parseVolume } = require('../../services/keywordCsvImport.service');

describe('keywordCsvImport.service — parseVolume', () => {
  it('parses a plain integer', () => {
    expect(parseVolume('1200')).toEqual({ value: 1200, isBucketed: false });
  });

  it('parses a comma-thousands number', () => {
    expect(parseVolume('12,000')).toEqual({ value: 12000, isBucketed: false });
  });

  it('parses a "K" suffix', () => {
    expect(parseVolume('1.5K')).toEqual({ value: 1500, isBucketed: false });
  });

  it('parses a bucketed range and flags it as bucketed', () => {
    expect(parseVolume('1K – 10K')).toEqual({ value: 5500, isBucketed: true });
  });

  it('treats a dash or missing value as null, not zero', () => {
    expect(parseVolume('-')).toEqual({ value: null, isBucketed: false });
    expect(parseVolume('')).toEqual({ value: null, isBucketed: false });
    expect(parseVolume(undefined)).toEqual({ value: null, isBucketed: false });
  });

  it('resolves quickly on a large non-matching input with no dash (regression guard for the range-regex ReDoS fix)', () => {
    const adversarial = `${','.repeat(50000) + ' '.repeat(50000)}x`;
    const start = Date.now();
    expect(parseVolume(adversarial)).toEqual({ value: null, isBucketed: false });
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('keywordCsvImport.service — parseKeywordPlannerCsv', () => {
  it("skips Google's metadata lines and finds the real header row", () => {
    const csv = [
      'Keyword Planner',
      'Wedding suppliers UK,,,,',
      '',
      'Keyword,Currency,Avg. monthly searches,Competition,Top of page bid (low range)',
      'wedding photographer london,GBP,"1,000",Medium,1.20',
      'wedding venue hire,GBP,2K – 10K,High,2.50',
    ].join('\n');

    const rows = parseKeywordPlannerCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      keyword: 'wedding photographer london',
      avgMonthlySearches: 1000,
      volumeIsBucketed: false,
      competition: 'Medium',
    });
    expect(rows[1]).toMatchObject({
      keyword: 'wedding venue hire',
      volumeIsBucketed: true,
      competition: 'High',
    });
  });

  it('throws a clear, actionable error when no header row is found', () => {
    expect(() => parseKeywordPlannerCsv('not,a,keyword,export\n1,2,3,4')).toThrow(
      /Keyword.*header row/i
    );
  });

  it('skips blank keyword rows without crashing', () => {
    const csv = ['Keyword,Avg. monthly searches', 'good keyword,100', ',200'].join('\n');
    const rows = parseKeywordPlannerCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].keyword).toBe('good keyword');
  });
});
