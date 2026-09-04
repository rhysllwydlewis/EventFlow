import { readdir, readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const workflowsDirectory = path.join(root, '.github', 'workflows');
const reportDirectory = path.join(root, 'reports');
const reportPath = path.join(reportDirectory, 'github-action-pins.md');
const enforcement = String(process.env.ACTION_PIN_ENFORCEMENT || 'warn').toLowerCase();
const immutableRef = /^[0-9a-f]{40}$/i;

async function collectYamlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectYamlFiles(absolute)));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files.sort();
}

function inspectLine(file, line, lineNumber) {
  const match = line.match(/^\s*-?\s*uses:\s*['"]?([^\s'"#]+)['"]?/);
  if (!match) return null;

  const reference = match[1];
  if (reference.startsWith('./') || reference.startsWith('docker://')) return null;

  const at = reference.lastIndexOf('@');
  if (at <= 0) {
    return { file, lineNumber, reference, reason: 'missing @ref' };
  }

  const ref = reference.slice(at + 1);
  if (immutableRef.test(ref)) return null;

  return { file, lineNumber, reference, reason: `mutable ref: ${ref}` };
}

const findings = [];
for (const absolute of await collectYamlFiles(workflowsDirectory)) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  const lines = (await readFile(absolute, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    const finding = inspectLine(relative, line, index + 1);
    if (finding) findings.push(finding);
  });
}

const report = [
  '# GitHub Action pin audit',
  '',
  `Enforcement mode: **${enforcement}**`,
  '',
  findings.length === 0
    ? 'All external GitHub Actions are pinned to immutable 40-character commit SHAs.'
    : `${findings.length} mutable external Action reference${findings.length === 1 ? '' : 's'} found.`,
  '',
  ...(findings.length
    ? [
        '| Workflow | Line | Reference | Finding |',
        '| --- | ---: | --- | --- |',
        ...findings.map(
          finding =>
            `| \`${finding.file}\` | ${finding.lineNumber} | \`${finding.reference}\` | ${finding.reason} |`
        ),
      ]
    : []),
  '',
  'Dependabot is configured to keep GitHub Actions current. Convert each mutable tag to a reviewed full commit SHA before changing enforcement to `error`.',
  '',
].join('\n');

await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, report, 'utf8');
console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, report, 'utf8');
}

if (findings.length > 0 && enforcement === 'error') {
  process.exitCode = 1;
}
