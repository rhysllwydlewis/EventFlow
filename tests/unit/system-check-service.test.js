/**
 * Unit tests for services/systemCheckService
 */
'use strict';

// Mock db-unified before requiring the service so no real DB connection happens
jest.mock('../../db-unified', () => ({
  insertOne: jest.fn().mockResolvedValue(undefined),
  findWithOptions: jest.fn().mockResolvedValue([]),
}));

// Mock node-schedule
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn().mockReturnValue({
    nextInvocation: () => new Date('2099-01-01T03:00:00Z'),
  }),
}));

const schedule = require('node-schedule');
const dbUnified = require('../../db-unified');
const {
  resolveBaseUrl,
  buildChecks,
  runCheck,
  runSystemChecks,
  scheduleChecks,
  getRecentRuns,
} = require('../../services/systemCheckService');

// ── helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal fetch mock that returns the given status */
function mockFetch(status = 200, body = {}) {
  return jest.fn().mockResolvedValue({
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ── resolveBaseUrl ────────────────────────────────────────────────────────────

describe('resolveBaseUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SYSTEM_CHECKS_BASE_URL;
    delete process.env.BASE_URL;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns SYSTEM_CHECKS_BASE_URL when set (trailing slash stripped)', () => {
    process.env.SYSTEM_CHECKS_BASE_URL = 'https://example.com/';
    expect(resolveBaseUrl()).toBe('https://example.com');
  });

  it('falls back to BASE_URL', () => {
    process.env.BASE_URL = 'https://event-flow.co.uk';
    expect(resolveBaseUrl()).toBe('https://event-flow.co.uk');
  });

  it('falls back to http://localhost:PORT', () => {
    process.env.PORT = '4000';
    expect(resolveBaseUrl()).toBe('http://localhost:4000');
  });

  it('uses port 3000 when PORT not set', () => {
    delete process.env.PORT;
    expect(resolveBaseUrl()).toBe('http://localhost:3000');
  });
});

// ── buildChecks ───────────────────────────────────────────────────────────────

describe('buildChecks', () => {
  it('returns an array of check descriptors', () => {
    const checks = buildChecks('http://localhost:3000');
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(4);
  });

  it('each check has name, type, and target', () => {
    const checks = buildChecks('http://localhost:3000');
    checks.forEach(c => {
      expect(typeof c.name).toBe('string');
      expect(typeof c.type).toBe('string');
      expect(typeof c.target).toBe('string');
      expect(c.target).toMatch(/^http/);
    });
  });

  it('includes the /api/health check', () => {
    const checks = buildChecks('http://localhost:3000');
    expect(checks.some(c => c.name === 'health-api')).toBe(true);
  });

  it('includes the homepage check', () => {
    const checks = buildChecks('http://localhost:3000');
    expect(checks.some(c => c.name === 'homepage')).toBe(true);
  });
});

// ── runCheck ─────────────────────────────────────────────────────────────────

describe('runCheck', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns ok=true for HTTP 200', async () => {
    global.fetch = mockFetch(200, { status: 'ok' });

    const result = await runCheck({
      name: 'health-api',
      type: 'api',
      target: 'http://localhost:3000/api/health',
    });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(typeof result.durationMs).toBe('number');
  });

  it('returns ok=false for HTTP 500', async () => {
    global.fetch = mockFetch(500);

    const result = await runCheck({ name: 'test', type: 'page', target: 'http://localhost:3000/' });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it('returns ok=true for HTTP 301 redirect', async () => {
    global.fetch = mockFetch(301);

    const result = await runCheck({
      name: 'page',
      type: 'page',
      target: 'http://localhost:3000/auth',
    });

    expect(result.ok).toBe(true);
  });

  it('handles network error gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runCheck({
      name: 'health-api',
      type: 'api',
      target: 'http://localhost:3000/api/health',
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('handles AbortError (timeout) gracefully', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr);

    const result = await runCheck({
      name: 'health-api',
      type: 'api',
      target: 'http://localhost:3000/api/health',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/[Tt]imeout/);
  });

  it('captures health-api JSON status in details', async () => {
    global.fetch = mockFetch(200, { status: 'ok', services: {} });

    const result = await runCheck({
      name: 'health-api',
      type: 'api',
      target: 'http://localhost:3000/api/health',
    });

    expect(result.details.status).toBe('ok');
  });
});

// ── runSystemChecks ───────────────────────────────────────────────────────────

describe('runSystemChecks', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    dbUnified.insertOne.mockClear();
    // Reset the running lock by doing nothing (the lock resets after each run)
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns a run document with checks, status, startedAt', async () => {
    global.fetch = mockFetch(200, { status: 'ok' });

    const run = await runSystemChecks();

    expect(run).not.toBeNull();
    expect(Array.isArray(run.checks)).toBe(true);
    expect(typeof run.status).toBe('string');
    expect(run.startedAt instanceof Date).toBe(true);
    expect(run.finishedAt instanceof Date).toBe(true);
    expect(typeof run.durationMs).toBe('number');
  });

  it('status is "pass" when all checks succeed', async () => {
    global.fetch = mockFetch(200);

    const run = await runSystemChecks();

    expect(run.status).toBe('pass');
  });

  it('status is "fail" when any check fails', async () => {
    // First call succeeds, rest fail
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      const status = callCount === 1 ? 500 : 200;
      return Promise.resolve({ status, json: jest.fn().mockResolvedValue({}) });
    });

    const run = await runSystemChecks();

    expect(run.status).toBe('fail');
  });

  it('persists the run to MongoDB via dbUnified.insertOne', async () => {
    global.fetch = mockFetch(200);

    await runSystemChecks();

    expect(dbUnified.insertOne).toHaveBeenCalledWith(
      'system_checks',
      expect.objectContaining({ status: expect.any(String), checks: expect.any(Array) })
    );
  });

  it('still returns run doc even when MongoDB insert fails', async () => {
    global.fetch = mockFetch(200);
    dbUnified.insertOne.mockRejectedValueOnce(new Error('MongoDB unavailable'));

    const run = await runSystemChecks();

    expect(run).not.toBeNull();
    expect(run.status).toBeDefined();
  });
});

// ── scheduleChecks ────────────────────────────────────────────────────────────

describe('scheduleChecks', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    schedule.scheduleJob.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns scheduled=false in non-production without explicit SYSTEM_CHECKS_ENABLED', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SYSTEM_CHECKS_ENABLED;

    const result = scheduleChecks();

    expect(result.scheduled).toBe(false);
    expect(schedule.scheduleJob).not.toHaveBeenCalled();
  });

  it('returns scheduled=true when SYSTEM_CHECKS_ENABLED=true', () => {
    process.env.SYSTEM_CHECKS_ENABLED = 'true';

    const result = scheduleChecks();

    expect(result.scheduled).toBe(true);
    expect(schedule.scheduleJob).toHaveBeenCalled();
  });

  it('uses custom cron from SYSTEM_CHECKS_CRON', () => {
    process.env.SYSTEM_CHECKS_ENABLED = 'true';
    process.env.SYSTEM_CHECKS_CRON = '0 6 * * *';

    scheduleChecks();

    expect(schedule.scheduleJob).toHaveBeenCalledWith('0 6 * * *', expect.any(Function));
  });

  it('defaults to 0 3 * * * cron when not set', () => {
    process.env.SYSTEM_CHECKS_ENABLED = 'true';
    delete process.env.SYSTEM_CHECKS_CRON;

    scheduleChecks();

    expect(schedule.scheduleJob).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
  });

  it('returns scheduled=false when SYSTEM_CHECKS_ENABLED=false', () => {
    process.env.SYSTEM_CHECKS_ENABLED = 'false';

    const result = scheduleChecks();

    expect(result.scheduled).toBe(false);
  });
});

// ── getRecentRuns ─────────────────────────────────────────────────────────────

describe('getRecentRuns', () => {
  beforeEach(() => {
    dbUnified.findWithOptions.mockClear();
  });

  it('returns empty array on DB error', async () => {
    dbUnified.findWithOptions.mockRejectedValueOnce(new Error('DB error'));

    const runs = await getRecentRuns(30);

    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(0);
  });

  it('passes correct sort and limit to findWithOptions', async () => {
    dbUnified.findWithOptions.mockResolvedValueOnce([]);

    await getRecentRuns(10);

    expect(dbUnified.findWithOptions).toHaveBeenCalledWith(
      'system_checks',
      {},
      expect.objectContaining({ sort: { startedAt: -1 }, limit: 10 })
    );
  });
});
