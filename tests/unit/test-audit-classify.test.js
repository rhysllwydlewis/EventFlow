'use strict';

/**
 * The audit labels each failing check with the most likely kind of problem. The rules are an
 * ordered table, first match wins, so these tests pin every rule and the order that matters.
 * (The table replaced a 50-line `if` chain; it was checked against the old chain on 33,000
 * generated inputs with no differences.)
 */

const path = require('path');
const { spawnSync } = require('child_process');

const MODULE = path.join(__dirname, '../../scripts/lib/test-audit-classify.mjs');

/** Calls `classify` for many cases in one subprocess: [[checkId, output], ...] -> [category, ...]. */
function classifyAll(cases) {
  const script = `
    import { classify } from ${JSON.stringify(`file://${MODULE}`)};
    const cases = ${JSON.stringify(cases)};
    console.log(JSON.stringify(cases.map(([id, output]) => classify({ id }, output))));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return JSON.parse(result.stdout);
}

const classify = (id, output) => classifyAll([[id, output]])[0];

describe('audit failure classification', () => {
  describe('each rule', () => {
    test.each([
      ['lint', 'anything at all', 'Code quality'],
      ['format-check', 'something failed', 'Formatting/style issue'],
      ['smoke', 'Code style issues found in the above file', 'Formatting/style issue'],
      ['smoke', 'run prettier --write', 'Formatting/style issue'],
      ['visual', 'screenshots differ', 'Snapshot/visual drift'],
      ['npm-audit', 'whatever', 'Dependency/security warning'],
      ['jest-ci', '3 vulnerabilities found', 'Dependency/security warning'],
      ['jest-ci', 'global coverage threshold for lines not met', 'Coverage threshold issue'],
      ['jest-ci', 'Unsupported Node.js version', 'Environment/config issue'],
      ['jest-ci', 'connect ECONNREFUSED 127.0.0.1:27017', 'Environment/config issue'],
      ['jest-ci', 'port already used', 'Environment/config issue'],
      [
        'jest-ci',
        'Executable doesn’t exist; run playwright install chromium',
        'Environment/config issue',
      ],
      ['jest-ci', 'JWT_SECRET is not set', 'Environment/config issue'],
      ['jest-ci', 'expect(received).toBe(expected)', 'Stale test expectation'],
      ['jest-ci', 'Expected substring: "a"', 'Stale test expectation'],
      ['jest-ci', 'operation timeout', 'Audit runner timeout / incomplete result'],
      ['security-headers', 'missing header', 'Real product regression'],
      ['jest-ci', 'CSRF token mismatch', 'Real product regression'],
      ['jest-ci', 'authentication failed', 'Real product regression'],
      ['jest-ci', 'something nobody anticipated', 'Unknown/manual review required'],
      ['jest-ci', '', 'Unknown/manual review required'],
    ])('%s with %j is %s', (id, output, expected) => {
      expect(classify(id, output)).toBe(expected);
    });

    test('the timeout notice the runner appends is recognised, in any case', () => {
      expect(classify('jest-ci', '[Test audit] Command timed out after 1800s')).toBe(
        'Audit runner timeout / incomplete result'
      );
      expect(classify('jest-ci', 'TIMED OUT AFTER 5s')).toBe(
        'Audit runner timeout / incomplete result'
      );
    });

    test('matching ignores case', () => {
      expect(classify('jest-ci', 'ECONNREFUSED')).toBe(classify('jest-ci', 'econnrefused'));
      expect(classify('jest-ci', 'PRETTIER')).toBe('Formatting/style issue');
    });
  });

  describe('order decides', () => {
    test.each([
      // an explicit runner timeout beats everything else in the same log
      ['lint', 'Command timed out after 60s', 'Audit runner timeout / incomplete result'],
      [
        'jest-ci',
        'chromium missing. Command timed out after 60s',
        'Audit runner timeout / incomplete result',
      ],
      // the lint check is always code quality unless it timed out
      ['lint', 'prettier chromium auth', 'Code quality'],
      // formatting beats the visual id, dependency, coverage and environment rules
      ['visual', 'prettier complains', 'Formatting/style issue'],
      ['jest-ci', 'prettier and vulnerabilities', 'Formatting/style issue'],
      // visual beats dependency, coverage and environment
      ['visual', '2 vulnerabilities and a browser', 'Snapshot/visual drift'],
      // dependency beats coverage
      ['npm-audit', 'coverage threshold', 'Dependency/security warning'],
      // coverage beats environment
      ['jest-ci', 'coverage threshold in the browser', 'Coverage threshold issue'],
      // environment beats a stale expectation, a plain timeout and security
      ['jest-ci', 'mongodb: expect(received).toBe', 'Environment/config issue'],
      ['jest-ci', 'chromium timeout', 'Environment/config issue'],
      ['security-headers', 'mongodb down', 'Environment/config issue'],
      // a stale expectation beats a plain timeout and security
      ['jest-ci', 'expect(received) after a timeout', 'Stale test expectation'],
      ['security-headers', 'expect(received).toBe', 'Stale test expectation'],
      // a plain timeout beats security
      ['security-headers', 'request timeout', 'Audit runner timeout / incomplete result'],
    ])('%s with %j is %s', (id, output, expected) => {
      expect(classify(id, output)).toBe(expected);
    });

    test('the rules are tried in a fixed order with no duplicate categories except the timeout', () => {
      const script = `
        import { CLASSIFICATION_RULES } from ${JSON.stringify(`file://${MODULE}`)};
        console.log(JSON.stringify(CLASSIFICATION_RULES.map(rule => rule.category)));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
      });
      const categories = JSON.parse(result.stdout);
      expect(categories).toEqual([
        'Audit runner timeout / incomplete result',
        'Code quality',
        'Formatting/style issue',
        'Snapshot/visual drift',
        'Dependency/security warning',
        'Coverage threshold issue',
        'Environment/config issue',
        'Stale test expectation',
        'Audit runner timeout / incomplete result',
        'Real product regression',
      ]);
    });
  });
});
