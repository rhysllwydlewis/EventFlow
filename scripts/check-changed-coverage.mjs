import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const lcovPath = path.join(root, process.env.LCOV_FILE || 'coverage/lcov.info');
const minimum = Number(process.env.PATCH_COVERAGE_MIN || 80);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function resolveBase() {
  const explicit = process.env.COVERAGE_BASE_REF;
  const baseBranch = process.env.GITHUB_BASE_REF;
  const candidates = [explicit, baseBranch ? `origin/${baseBranch}` : null, 'HEAD^'].filter(Boolean);

  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch (_error) {
      // Try the next available base.
    }
  }

  throw new Error('Unable to resolve a base revision for changed-code coverage.');
}

function normaliseFile(value) {
  const cleaned = value.replaceAll('\\', '/');
  if (!path.isAbsolute(value)) return cleaned.replace(/^\.\//, '');
  return path.relative(root, value).replaceAll('\\', '/');
}

function eligible(file) {
  if (!file.endsWith('.js')) return false;
  if (
    file.endsWith('.config.js') ||
    file === 'routes/e2e-test-support.js' ||
    file.startsWith('tests/') ||
    file.startsWith('e2e/') ||
    file.startsWith('public/') ||
    file.startsWith('scripts/') ||
    file.startsWith('node_modules/')
  ) {
    return false;
  }
  return true;
}

function changedLines(base) {
  const diff = git([
    'diff',
    '--unified=0',
    '--diff-filter=ACMR',
    `${base}...HEAD`,
    '--',
    '*.js',
  ]);
  const result = new Map();
  let currentFile = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = normaliseFile(line.slice(6));
      if (!eligible(currentFile)) currentFile = null;
      continue;
    }

    if (!currentFile || !line.startsWith('@@')) continue;
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!match) continue;

    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) continue;

    const lines = result.get(currentFile) || new Set();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    result.set(currentFile, lines);
  }

  return result;
}

function parseLcov() {
  if (!existsSync(lcovPath)) throw new Error(`Coverage file not found: ${lcovPath}`);

  const coverage = new Map();
  let currentFile = null;

  for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = normaliseFile(line.slice(3));
      coverage.set(currentFile, new Map());
    } else if (currentFile && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      coverage.get(currentFile).set(lineNumber, hits);
    } else if (line === 'end_of_record') {
      currentFile = null;
    }
  }

  return coverage;
}

function writeSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown}\n`);
}

const base = resolveBase();
const changes = changedLines(base);
const coverage = parseLcov();
const rows = [];
let measured = 0;
let covered = 0;

for (const [file, lines] of changes) {
  const fileCoverage = coverage.get(file);
  let fileMeasured = 0;
  let fileCovered = 0;

  if (fileCoverage) {
    for (const line of lines) {
      if (!fileCoverage.has(line)) continue;
      fileMeasured += 1;
      measured += 1;
      if (fileCoverage.get(line) > 0) {
        fileCovered += 1;
        covered += 1;
      }
    }
  }

  if (fileMeasured > 0) {
    rows.push(`| \`${file}\` | ${fileCovered}/${fileMeasured} | ${(
      (fileCovered / fileMeasured) *
      100
    ).toFixed(1)}% |`);
  }
}

if (measured === 0) {
  const message = 'No instrumented application JavaScript lines changed; patch coverage gate passed.';
  console.log(message);
  writeSummary(`## Changed-code coverage\n\n${message}`);
  process.exit(0);
}

const percentage = (covered / measured) * 100;
const table = [
  '## Changed-code coverage',
  '',
  `Base: \`${base}\``,
  '',
  '| File | Covered lines | Coverage |',
  '| --- | ---: | ---: |',
  ...rows,
  '',
  `**Total: ${covered}/${measured} (${percentage.toFixed(1)}%) — required ${minimum.toFixed(1)}%.**`,
].join('\n');

console.log(table);
writeSummary(table);

if (percentage + Number.EPSILON < minimum) {
  console.error(
    `Changed executable lines are ${percentage.toFixed(1)}% covered; ${minimum.toFixed(1)}% is required.`
  );
  process.exit(1);
}
