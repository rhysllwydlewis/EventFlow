import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const [, , input = 'test-results/results.json', output = 'test-results/summary.txt'] = process.argv;
const lines = [];

function stripAnsi(value) {
  return stripVTControlCharacters(String(value || ''));
}

function addFailure(spec, test, ancestors) {
  const failedResults = (test.results || []).filter(result =>
    ['failed', 'timedOut', 'interrupted'].includes(result.status)
  );
  if (!failedResults.length && test.status !== 'unexpected') {
    return;
  }

  lines.push('');
  lines.push(
    `FAIL: ${[...ancestors, spec.title].filter(Boolean).join(' > ')} ` +
      `[${test.projectName || 'unknown project'}]`
  );

  for (const result of failedResults) {
    for (const error of result.errors || []) {
      const message = stripAnsi(error.message || error.value || error.stack || error).slice(
        0,
        6000
      );
      if (message) {
        lines.push(message);
      }
    }
  }
}

function walk(suite, ancestors = []) {
  const nextAncestors = suite.title ? [...ancestors, suite.title] : ancestors;
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      addFailure(spec, test, nextAncestors);
    }
  }
  for (const child of suite.suites || []) {
    walk(child, nextAncestors);
  }
}

try {
  if (!fs.existsSync(input)) {
    lines.push(`Playwright JSON results were not produced at ${input}.`);
  } else {
    const report = JSON.parse(fs.readFileSync(input, 'utf8'));
    const stats = report.stats || {};
    lines.push(
      `expected=${stats.expected ?? 0} unexpected=${stats.unexpected ?? 0} ` +
        `flaky=${stats.flaky ?? 0} skipped=${stats.skipped ?? 0}`
    );
    for (const suite of report.suites || []) {
      walk(suite);
    }
  }
} catch (error) {
  lines.push(`Unable to parse ${input}: ${stripAnsi(error?.stack || error)}`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${lines.join('\n').slice(0, 100000)}\n`);
console.log(fs.readFileSync(output, 'utf8'));
