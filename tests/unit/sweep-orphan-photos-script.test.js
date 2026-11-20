/**
 * scripts/sweep-orphan-photos.js: the options it accepts, that it will not run against anything but
 * a healthy MongoDB, and what it prints.
 *
 * @jest-environment node
 */
'use strict';

const mockState = { status: { type: 'mongodb', connected: true }, report: null, sweepArgs: null };

jest.mock('../../db-unified', () => ({
  initializeDatabase: jest.fn(async () => undefined),
  getDatabaseStatus: jest.fn(() => mockState.status),
}));
jest.mock('../../db', () => ({ getDb: jest.fn(async () => ({ fake: 'db' })) }));
jest.mock('../../utils/orphanPhotoSweep', () => ({
  sweepOrphanPhotos: jest.fn(async (_db, options) => {
    mockState.sweepArgs = options;
    return mockState.report;
  }),
}));

const {
  EXIT_CODES,
  describe: describeReport,
  main,
  parseArgs,
} = require('../../scripts/sweep-orphan-photos');

const report = (extra = {}) => ({
  mode: 'dry run',
  graceDays: 14,
  limit: 5000,
  imagesTotal: 100,
  referencedIds: 90,
  kept: { used: 80, tooRecent: 5, undated: 1 },
  candidates: 14,
  candidateBytes: 14 * 1024 * 1024,
  byType: { optimized: 7, thumbnail: 7 },
  sample: ['a', 'b'],
  deleted: 0,
  scanned: { suppliers: 10 },
  refused: null,
  ...extra,
});

beforeEach(() => {
  mockState.status = { type: 'mongodb', connected: true };
  mockState.report = report();
  mockState.sweepArgs = null;
});

describe('parseArgs', () => {
  test('defaults to a dry run with a 14 day grace period and a limit of 5000', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      json: false,
      allowLarge: false,
      graceDays: 14,
      limit: 5000,
      errors: [],
    });
  });

  test('reads every option', () => {
    expect(
      parseArgs(['--apply', '--json', '--allow-large', '--grace-days=30', '--limit=250'])
    ).toEqual({
      apply: true,
      json: true,
      allowLarge: true,
      graceDays: 30,
      limit: 250,
      errors: [],
    });
  });

  test.each([
    ['--grace-days=soon', /--grace-days=soon: expected a number of days/],
    ['--grace-days=-3', /expected a number of days/],
    ['--limit=0', /--limit=0: expected a whole number/],
    ['--limit=lots', /expected a whole number/],
    ['--delete', /--delete: not an option this script knows/],
    ['--aply', /--aply: not an option this script knows/],
  ])('%s is reported, not guessed at', (arg, message) => {
    const { errors } = parseArgs([arg]);

    expect(errors.join('\n')).toMatch(message);
  });
});

describe('main', () => {
  test('a dry run reads the database and prints what it found', async () => {
    const log = jest.fn();

    const code = await main([], log);

    expect(code).toBe(EXIT_CODES.ok);
    expect(mockState.sweepArgs).toMatchObject({ apply: false, graceDays: 14, limit: 5000 });
    expect(log.mock.calls[0][0]).toMatch(/Nothing was deleted. Re-run with --apply to delete./);
  });

  test('passes --apply and the other options through', async () => {
    await main(['--apply', '--grace-days=30', '--limit=100', '--allow-large'], jest.fn());

    expect(mockState.sweepArgs).toMatchObject({
      apply: true,
      graceDays: 30,
      limit: 100,
      allowLarge: true,
    });
  });

  test('refuses to run, dry run or not, against anything but a connected MongoDB', async () => {
    for (const status of [
      { type: 'local', connected: true },
      { type: 'mongodb', connected: false },
      {},
    ]) {
      mockState.status = status;
      const log = jest.fn();

      const code = await main(['--apply'], log);

      expect(code).toBe(EXIT_CODES.refused);
      expect(log.mock.calls[0][0]).toMatch(/Refusing to run/);
      expect(mockState.sweepArgs).toBeNull();
    }
  });

  test('an option it does not understand stops it before it touches the database', async () => {
    const log = jest.fn();

    const code = await main(['--aply'], log);

    expect(code).toBe(EXIT_CODES.failed);
    expect(mockState.sweepArgs).toBeNull();
  });

  test('a refusal by the sweep itself is a refused exit', async () => {
    mockState.report = report({ refused: 'no references were found anywhere' });
    const log = jest.fn();

    const code = await main([], log);

    expect(code).toBe(EXIT_CODES.refused);
    expect(log.mock.calls[0][0]).toMatch(
      /REFUSED, nothing was deleted: no references were found anywhere/
    );
    // What it found is printed too, so the person deciding can see it
    expect(log.mock.calls[0][0]).toMatch(/Orphaned \(older than 14 days, used by nothing\): 14/);
    expect(log.mock.calls[0][0]).toMatch(/Sample ids: a, b/);
  });

  test('--json prints the report as JSON', async () => {
    const log = jest.fn();

    await main(['--json'], log);

    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ candidates: 14, mode: 'dry run' });
  });
});

describe('describe', () => {
  test('says how many, how big, and that nothing was deleted', () => {
    const text = describeReport(report());

    expect(text).toMatch(/Images stored: 100; addresses found in other records: 90/);
    expect(text).toMatch(/Kept: 80 in use, 5 younger than 14 days, 1 with no readable date/);
    expect(text).toMatch(/older than 14 days, used by nothing\): 14/);
    expect(text).toMatch(/14.0 MB/);
    expect(text).toMatch(/Sample ids: a, b/);
  });

  test('says how many were deleted after --apply, and that only up to the limit are taken per run', () => {
    const text = describeReport(report({ mode: 'apply', candidates: 9000, deleted: 5000 }));

    expect(text).toMatch(/Deleted: 5000/);
    expect(text).toMatch(/of which up to 5000 per run/);
    expect(text).not.toMatch(/Nothing was deleted/);
  });
});
