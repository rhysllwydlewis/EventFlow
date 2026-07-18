#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const [, , inputDir = '.lighthouseci', outputFile = 'lighthouse-summary.txt'] = process.argv;
const root = process.cwd();
const directory = path.resolve(root, inputDir);
const manifestPath = path.join(directory, 'manifest.json');
const lines = ['Lighthouse collected results', ''];

function score(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}` : 'n/a';
}

function resolveReportPath(value) {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;

  const fromRoot = path.resolve(root, value);
  if (fs.existsSync(fromRoot)) return fromRoot;

  return path.resolve(directory, value);
}

function readCategories(entry) {
  const summary = entry.summary || {};
  if (Object.keys(summary).length > 0) return summary;

  const reportPath = resolveReportPath(entry.jsonPath);
  if (!reportPath || !fs.existsSync(reportPath)) return {};

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return Object.fromEntries(
    Object.entries(report.categories || {}).map(([name, category]) => [name, category?.score])
  );
}

try {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Lighthouse manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error('Lighthouse manifest contains no collected runs.');
  }

  lines.push('| URL | Representative | Performance | Accessibility | Best practices | SEO |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');

  for (const entry of manifest) {
    const categories = readCategories(entry);
    lines.push(
      `| ${entry.url || 'unknown'} | ${entry.isRepresentativeRun ? 'yes' : 'no'} | ` +
        `${score(categories.performance)} | ${score(categories.accessibility)} | ` +
        `${score(categories['best-practices'])} | ${score(categories.seo)} |`
    );
  }
} catch (error) {
  lines.push(`ERROR: ${error?.stack || error}`);
  process.exitCode = 1;
}

const output = `${lines.join('\n')}\n`;
fs.writeFileSync(path.resolve(root, outputFile), output);
console.log(output);
