'use strict';

/**
 * Stylesheet bug guard.
 *
 * DeepSource has no CSS analyzer, so first-party CSS is enforced inside the
 * blocking Jest suite. The ruleset is deliberately bug-class only: invalid
 * values, declarations that can never apply, blocks that do nothing. It is not
 * a style guide, so it stays quiet unless something is genuinely broken.
 *
 * Discovery is recursive under public/. The original implementation only
 * scanned the immediate children of public/assets/css and public/messenger/css,
 * which meant first-party styles such as public/supplier/css were invisible to
 * the gate while the test claimed every stylesheet was covered.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '../..');
const PUBLIC_ROOT = path.join(repoRoot, 'public');
const EXCLUDED_DIRECTORY_NAMES = new Set(['vendor', 'node_modules', 'dist', 'build', 'coverage']);

function discoverStylesheets(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      found.push(...discoverStylesheets(absolute));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      found.push(absolute);
    }
  }
  return found;
}

const stylesheets = discoverStylesheets(PUBLIC_ROOT).sort();

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

  test('stylelint is wired up and the local command covers public recursively', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.devDependencies.stylelint).toEqual(expect.any(String));
    expect(pkg.scripts['lint:css']).toContain('public/**/*.css');
    expect(pkg['lint-staged']['*.css']).toBeDefined();
  });

  test('recursive discovery includes CSS outside the two legacy folders', () => {
    const relative = stylesheets.map(file => path.relative(repoRoot, file).replaceAll('\\', '/'));
    expect(stylesheets.length).toBeGreaterThan(100);
    expect(relative).toContain('public/supplier/css/supplier-workspace.css');
    expect(relative).toContain('public/assets/css/guide-premium-hardening.css');
    expect(relative.some(file => file.includes('/vendor/'))).toBe(false);
  });

  test('no first-party stylesheet contains a bug-class violation', () => {
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
    // Cosmetic rules belong in Prettier or nowhere; enforcing them would turn
    // this safety gate into a legacy reformatting project.
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
    expect(config.rules['property-no-unknown']).toBe(true);
    expect(config.rules['color-no-invalid-hex']).toBe(true);
    expect(config.rules['block-no-empty']).toBe(true);
  });
});
