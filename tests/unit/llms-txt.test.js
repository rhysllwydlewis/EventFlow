/**
 * Unit tests for sitemap.js's generateLlmsTxt
 */

'use strict';

// Mock database/logger so requiring sitemap.js doesn't pull in real DB/log
// dependencies, matching tests/unit/sitemap.test.js.
jest.mock('../../db-unified', () => ({
  read: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { generateLlmsTxt } = require('../../sitemap');

const BASE_URL = 'https://event-flow.co.uk';

describe('generateLlmsTxt', () => {
  let text;

  beforeAll(() => {
    text = generateLlmsTxt(BASE_URL);
  });

  test('starts with an H1 site name', () => {
    expect(text).toMatch(/^# EventFlow\n/);
  });

  test('includes a summary blockquote', () => {
    expect(text).toMatch(/\n> .+\n/);
  });

  test('links to key pages using the provided base URL', () => {
    expect(text).toContain(`(${BASE_URL}/suppliers)`);
    expect(text).toContain(`(${BASE_URL}/marketplace)`);
    expect(text).toContain(`(${BASE_URL}/guides)`);
    expect(text).toContain(`(${BASE_URL}/sitemap.xml)`);
  });

  test('respects a different base URL', () => {
    const other = generateLlmsTxt('https://staging.example.com');
    expect(other).toContain('(https://staging.example.com/suppliers)');
    expect(other).not.toContain(BASE_URL);
  });
});
