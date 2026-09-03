'use strict';

/**
 * Stylesheet bug guard.
 *
 * A `.stylelintrc.json` sat in this repo for months with no stylelint
 * dependency, no npm script and no CI step — nothing ever ran it. The only
 * reference to it was a shell script checking the file existed.
 *
 * DeepSource cannot cover this gap: it has analyzers for JavaScript,
 * TypeScript, Python, Docker, Shell and others, but none for CSS.
 *
 * So CSS is enforced the same way the type scale is — a unit test inside the
 * blocking Jest suite. The ruleset is deliberately bug-class only: invalid
 * values, declarations that can never apply, blocks that do nothing. It is not
 * a style guide, so it stays quiet unless something is genuinely broken.
 *
 * The first run found ten, including `inset-x: 0` in hero-modern.css — a
 * Tailwind class name used as a CSS property, silently discarded by every
 * browser.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '../..');
const CSS_DIRS = ['public/assets/css', 'public/messenger/css'];

function stylesheetsIn(dir) {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  return fs
    .readdirSync(absolute)
    .filter(file => file.endsWith('.css'))
    .map(file => path.join(absolute, file));
}

const stylesheets = CSS_DIRS.flatMap(stylesheetsIn);

/**
 * stylelint is ESM-only from v16, so it cannot be `require`d from this
 * CommonJS suite. Driving the CLI keeps the test on exactly the same code
 * path a developer runs via `npm run lint:css`.
 *
 * The report goes to a file rather than stdout: stylelint exits before a
 * piped stdout flushes, so the JSON arrives empty when it is piped.
 */
function runStylelint() {
  const bin = path.join(repoRoot, 'node_modules/.bin/stylelint');
  const reportPath = path.join(os.tmpdir(), `stylelint-report-${process.pid}.json`);
  const args = [
    ...stylesheets,
    '--formatter',
    'json',
    '--config',
    path.join(repoRoot, '.stylelintrc.json'),
    '--output-file',
    reportPath,
  ];

  try {
    // Exit code 2 simply means violations were found, which is not a crash.
    execFileSync(bin, args, { cwd: repoRoot, stdio: 'ignore' });
  } catch (error) {
    if (error.status !== 2) {
      throw error;
    }
  }

  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } finally {
    fs.rmSync(reportPath, { force: true });
  }
}

describe('stylesheets are free of broken and dead CSS', () => {
  let results;

  beforeAll(() => {
    results = runStylelint();
  }, 180000);

  test('stylelint is wired up and actually reachable', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    // The config existing is not enough — that was the previous state.
    expect(pkg.devDependencies.stylelint).toEqual(expect.any(String));
    expect(pkg.scripts['lint:css']).toContain('stylelint');
    expect(pkg['lint-staged']['*.css']).toBeDefined();
  });

  test('every stylesheet is discovered', () => {
    expect(stylesheets.length).toBeGreaterThan(100);
  });

  test('no stylesheet contains a bug-class violation', () => {
    const offences = results
      .filter(result => result.warnings.length)
      .map(result => ({
        file: path.relative(repoRoot, result.source),
        problems: result.warnings.map(w => `${w.line}:${w.column} ${w.text}`),
      }));
    expect(offences).toEqual([]);
  });

  test('the ruleset stays bug-class, not a style guide', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, '.stylelintrc.json'), 'utf8'));
    // Cosmetic rules belong in Prettier or nowhere; 18,824 violations of them
    // exist today and enforcing them would mean rewriting 132 stylesheets.
    for (const cosmetic of [
      'color-function-notation',
      'alpha-value-notation',
      'color-function-alias-notation',
      'rule-empty-line-before',
      'declaration-block-single-line-max-declarations',
      'value-keyword-case',
    ]) {
      expect(config.rules[cosmetic]).toBeUndefined();
    }
    // And the guard must keep catching genuinely broken CSS.
    expect(config.rules['property-no-unknown']).toBe(true);
    expect(config.rules['color-no-invalid-hex']).toBe(true);
    expect(config.rules['block-no-empty']).toBe(true);
  });
});
