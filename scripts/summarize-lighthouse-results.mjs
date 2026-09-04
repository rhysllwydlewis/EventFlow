import fs from 'node:fs';
import path from 'node:path';

const [, , inputDir = '.lighthouseci', outputFile = 'lighthouse-summary.txt'] = process.argv;
const root = process.cwd();
const directory = path.resolve(root, inputDir);
const lines = ['Lighthouse collected results', ''];

function score(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}` : 'n/a';
}

function readReports() {
  if (!fs.existsSync(directory)) {
    throw new Error(`Lighthouse results directory not found at ${directory}`);
  }

  return fs
    .readdirSync(directory)
    .filter(file => /^lhr-.*\.json$/.test(file))
    .map(file => {
      const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      return {
        url: report.finalDisplayedUrl || report.finalUrl || report.requestedUrl || 'unknown',
        fetchTime: report.fetchTime || '',
        categories: Object.fromEntries(
          Object.entries(report.categories || {}).map(([name, category]) => [name, category?.score])
        ),
      };
    })
    .filter(report => Object.keys(report.categories).length > 0)
    .sort(
      (left, right) =>
        left.url.localeCompare(right.url) || left.fetchTime.localeCompare(right.fetchTime)
    );
}

try {
  const reports = readReports();
  if (reports.length === 0) {
    throw new Error(`No Lighthouse JSON reports found in ${directory}`);
  }

  const runByUrl = new Map();
  lines.push('| URL | Run | Performance | Accessibility | Best practices | SEO |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');

  for (const report of reports) {
    const run = (runByUrl.get(report.url) || 0) + 1;
    runByUrl.set(report.url, run);
    lines.push(
      `| ${report.url} | ${run} | ${score(report.categories.performance)} | ` +
        `${score(report.categories.accessibility)} | ` +
        `${score(report.categories['best-practices'])} | ${score(report.categories.seo)} |`
    );
  }
} catch (error) {
  lines.push(`ERROR: ${error?.stack || error}`);
  process.exitCode = 1;
}

const output = `${lines.join('\n')}\n`;
fs.writeFileSync(path.resolve(root, outputFile), output);
console.log(output);
