import { spawn } from 'child_process';
import { mkdir, rm, writeFile, readFile, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'test-audit');
const LOGS = path.join(OUT, 'logs');
const args = new Set(process.argv.slice(2));
const mode = args.has('--full')
  ? 'full'
  : args.has('--quick')
    ? 'quick'
    : args.has('--ci')
      ? 'ci'
      : 'default';
const live = args.has('--live');
const started = new Date();
const categories = [
  'Real product regression',
  'Stale test expectation',
  'Environment/config issue',
  'Flaky/timing issue',
  'Snapshot/visual drift',
  'Code quality',
  'Formatting/style issue',
  'Audit runner timeout / incomplete result',
  'Coverage threshold issue',
  'Workflow policy issue',
  'Dependency/security warning',
  'Unknown/manual review required',
];

const allChecks = [
  {
    id: 'lint',
    area: 'Code quality',
    command: 'npm run lint',
    log: 'lint.log',
    modes: ['quick', 'default', 'full', 'ci'],
  },
  {
    id: 'format-check',
    area: 'Formatting',
    command: 'npm run format:check',
    log: 'format-check.log',
    modes: ['quick', 'default', 'full', 'ci'],
  },
  {
    id: 'smoke',
    area: 'Smoke tests',
    command: 'npm run test:smoke -- --json --outputFile=test-audit/jest-smoke.json',
    log: 'smoke.log',
    modes: ['quick', 'default', 'full', 'ci'],
    parser: 'jest',
    json: 'jest-smoke.json',
    timeoutMs: 180000,
  },
  {
    id: 'jest-ci',
    area: 'Jest CI',
    command: 'npm run test:ci -- --json --outputFile=test-audit/jest-ci.json',
    log: 'jest-ci.log',
    modes: ['quick', 'default', 'full', 'ci'],
    parser: 'jest',
    json: 'jest-ci.json',
    timeoutMs: 240000,
  },
  {
    id: 'full-regression',
    area: 'Full Jest regression',
    command: 'npm run test:full -- --json --outputFile=test-audit/jest-full.json',
    log: 'full-regression.log',
    modes: ['default', 'full', 'ci'],
    parser: 'jest',
    json: 'jest-full.json',
    timeoutMs: 300000,
  },
  {
    id: 'playwright-static',
    area: 'Static Playwright e2e',
    command:
      'CI=true PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/playwright-static.json npm run test:e2e:static',
    preCommand: "pgrep -f '[s]cripts/serve-static.js' | xargs -r kill",
    log: 'playwright-static.log',
    modes: ['quick', 'default', 'full', 'ci'],
    parser: 'playwright',
    json: 'test-results/playwright-static.json',
    artifactDirs: ['playwright-report', 'test-results'],
    timeoutMs: 240000,
  },
  {
    id: 'playwright-full',
    area: 'Backend Playwright e2e',
    command: 'PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/playwright-full.json npm run test:e2e:full',
    preCommand: "pgrep -f '[s]cripts/serve-static.js' | xargs -r kill",
    log: 'playwright-full.log',
    modes: ['full'],
    parser: 'playwright',
    json: 'test-results/playwright-full.json',
    artifactDirs: ['playwright-report', 'test-results'],
    safe: 'Requires a safe local/backend test environment; never uses production by this runner.',
    timeoutMs: 420000,
  },
  {
    id: 'visual',
    area: 'Visual regression',
    command:
      'CI=true PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/visual-results.json npm run test:visual',
    preCommand: "pgrep -f '[s]cripts/serve-static.js' | xargs -r kill",
    log: 'visual.log',
    modes: ['full'],
    parser: 'playwright',
    json: 'test-results/visual-results.json',
    artifactDirs: ['visual-report', 'test-results', 'tests/visual/__screenshots__'],
    timeoutMs: 300000,
  },
  {
    id: 'a11y',
    area: 'Accessibility',
    command: 'CI=true PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/a11y-results.json npm run test:a11y',
    preCommand: "pgrep -f '[s]cripts/serve-static.js' | xargs -r kill",
    log: 'a11y.log',
    modes: ['full'],
    parser: 'playwright',
    json: 'test-results/a11y-results.json',
    artifactDirs: ['visual-report', 'test-results', 'tests/visual/__screenshots__'],
    timeoutMs: 300000,
  },
  {
    id: 'security-headers',
    area: 'Security headers',
    command:
      'JWT_SECRET=test-jwt-secret-for-header-verification-only-min-32-chars npm run test:headers',
    log: 'security-headers.log',
    modes: ['default', 'full', 'ci'],
  },
  {
    id: 'go-live-audit',
    area: 'Go-live audit (local)',
    command:
      'JWT_SECRET=audit-script-test-jwt-secret-do-not-use-in-production-padding-abcde MONGODB_URI=mongodb://127.0.0.1:27017/eventflow_audit BASE_URL=http://localhost:3600 ALLOW_DEGRADED_STARTUP=true npm run audit:golive',
    log: 'go-live-audit.log',
    modes: ['full'],
  },
  {
    id: 'npm-audit',
    area: 'Dependency security',
    command: 'npm audit --production',
    log: 'npm-audit.log',
    modes: ['full'],
    warningOnFail: true,
  },
];

function selectedChecks() {
  const checks = allChecks.filter(c => c.modes.includes(mode));
  if (live) {
    checks.push({
      id: 'go-live-audit-live',
      area: 'Live read-only audit',
      command: 'npm run audit:golive:live',
      log: 'go-live-audit-live.log',
      modes: [mode],
    });
  }
  return checks;
}

async function gitInfo(cmd) {
  return new Promise(resolve => {
    const child = spawn('git', cmd, { cwd: ROOT });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.on('close', () => resolve(out.trim() || 'unknown'));
  });
}

function runShell(command, timeoutMs = 300000) {
  return new Promise(resolve => {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const wrappedCommand = `timeout -k 10s ${seconds}s bash -lc ${JSON.stringify(command)}`;
    const child = spawn(wrappedCommand, {
      cwd: ROOT,
      shell: true,
      env: { ...process.env, TEST_AUDIT: 'true' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('close', code => {
      if (code === 124 || code === 137) {
        stderr += `\n[Test audit] Command timed out after ${seconds}s and was terminated.\n`;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function ms(n) {
  return `${(n / 1000).toFixed(1)}s`;
}

function esc(s = '') {
  return String(s).replaceAll('|', '\\|').replaceAll('\n', '<br>').slice(0, 700);
}

function csvEscape(value = '') {
  return `"${String(value).replaceAll('\"', '\"\"')}"`;
}

function excerpt(text) {
  const lines = String(text || '')
    .split('\n')
    .filter(Boolean);
  return lines.slice(-12).join('\n').slice(0, 1800) || 'No error excerpt captured; see log file.';
}

function classify(check, output) {
  const text = output.toLowerCase();
  if (text.includes('[test audit] command timed out') || text.includes('timed out after')) {
    return 'Audit runner timeout / incomplete result';
  }
  if (check.id === 'lint') {
    return 'Code quality';
  }
  if (
    check.id === 'format-check' ||
    text.includes('prettier') ||
    text.includes('code style issues')
  ) {
    return 'Formatting/style issue';
  }
  if (check.id.includes('visual')) {
    return 'Snapshot/visual drift';
  }
  if (check.id === 'npm-audit' || text.includes('vulnerab')) {
    return 'Dependency/security warning';
  }
  if (text.includes('coverage threshold')) {
    return 'Coverage threshold issue';
  }
  if (
    text.includes('unsupported node.js version') ||
    text.includes('node 20') ||
    text.includes('already used') ||
    text.includes('chromium') ||
    text.includes('browser') ||
    text.includes('mongodb') ||
    text.includes('econnrefused') ||
    text.includes('missing required environment') ||
    text.includes('environment variable') ||
    text.includes('not set')
  ) {
    return 'Environment/config issue';
  }
  if (text.includes('expect(received)') || text.includes('expected substring')) {
    return 'Stale test expectation';
  }
  if (text.includes('timeout') || text.includes('timed out')) {
    return 'Audit runner timeout / incomplete result';
  }
  if (check.id.includes('security') || text.includes('csrf') || text.includes('auth')) {
    return 'Real product regression';
  }
  return 'Unknown/manual review required';
}

async function copyArtifacts(check) {
  if (!check.artifactDirs?.length) {
    return [];
  }
  const copied = [];
  const checkOut = path.join(OUT, 'artifacts', check.id);
  await mkdir(checkOut, { recursive: true });
  for (const rel of check.artifactDirs) {
    const src = path.join(ROOT, rel);
    if (!existsSync(src)) {
      continue;
    }
    const dest = path.join(checkOut, rel.replaceAll('/', '__'));
    await rm(dest, { recursive: true, force: true });
    await cp(src, dest, { recursive: true, force: true });
    copied.push(path.relative(OUT, dest));
  }
  return copied;
}

async function parseJest(check) {
  const file = path.join(OUT, check.json);
  if (!existsSync(file)) {
    return { failing: [], passing: {} };
  }
  const data = JSON.parse(await readFile(file, 'utf8'));
  const failing = [];
  for (const suite of data.testResults || []) {
    for (const a of suite.assertionResults || []) {
      if (a.status === 'failed') {
        failing.push({
          runner: 'Jest',
          file: path.relative(ROOT, suite.name),
          name: a.fullName || a.title,
          message: (a.failureMessages || []).join('\n').slice(0, 1000),
          category: 'Unknown/manual review required',
          action: 'Review assertion and decide whether product or expectation changed.',
        });
      }
    }
  }
  return {
    failing,
    passing: {
      passedTestSuites: data.numPassedTestSuites,
      passedTests: data.numPassedTests,
      totalTests: data.numTotalTests,
    },
  };
}

function walkPlaywrightSuites(suites = [], failing = [], passing = { passed: 0 }) {
  for (const suite of suites) {
    walkPlaywrightSuites(suite.suites || [], failing, passing);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const bad = (test.results || []).find(
          r => r.status && r.status !== 'passed' && r.status !== 'skipped'
        );
        if (bad || test.outcome === 'unexpected') {
          failing.push({
            runner: 'Playwright',
            file: suite.file || '',
            name: spec.title,
            message: (bad?.error?.message || test.outcome || 'Failed').slice(0, 1000),
            category: 'Unknown/manual review required',
            action: 'Review Playwright trace/screenshot/log.',
          });
        } else if (test.outcome === 'expected') {
          passing.passed += 1;
        }
      }
    }
  }
}

async function parsePlaywright(check) {
  const file = path.join(ROOT, check.json || '');
  if (!existsSync(file)) {
    return { failing: [], passing: {} };
  }
  const data = JSON.parse(await readFile(file, 'utf8'));
  const failing = [];
  const passing = { passed: 0 };
  walkPlaywrightSuites(data.suites || [], failing, passing);
  return { failing, passing };
}

async function workflowFindings() {
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/e2e.yml',
    '.github/workflows/visual-regression.yml',
  ];
  const findings = [];
  for (const f of files) {
    const text = existsSync(f) ? await readFile(f, 'utf8') : '';
    findings.push(
      `- ${f}: workflow_dispatch=${text.includes('workflow_dispatch') ? 'yes' : 'no'}, continue-on-error=${text.includes('continue-on-error') ? 'yes' : 'no'}, artifact upload=${text.includes('upload-artifact') ? 'yes' : 'no'}.`
    );
  }
  const visual = await readFile('.github/workflows/visual-regression.yml', 'utf8').catch(() => '');
  const m = visual.match(/CONTINUE_ON_ERROR_UNTIL:\s*['"]?(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const expired = new Date(`${m[1]}T23:59:59Z`) < new Date();
    findings.push(
      `- Visual regression soft-fail expiry: ${m[1]} (${expired ? 'expired — Workflow policy issue' : 'active'}).`
    );
  }
  return findings;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(LOGS, { recursive: true });
  const results = [];
  const failingTests = [];
  const passingSummaries = [];
  for (const check of selectedChecks()) {
    let cleanupNote = '';
    if (check.preCommand) {
      const cleanup = await runShell(check.preCommand, 10000);
      cleanupNote = `$ ${check.preCommand}  # audit cleanup only\n${cleanup.stdout}${cleanup.stderr}\n`;
    }
    const start = new Date();
    const { code, stdout, stderr } = await runShell(check.command, check.timeoutMs);
    const end = new Date();
    await writeFile(
      path.join(LOGS, check.log),
      `${cleanupNote}$ ${check.command}\n\n[stdout]\n${stdout}\n\n[stderr]\n${stderr}`
    );
    const output = `${stdout}\n${stderr}`;
    const timedOut =
      code === 124 || code === 137 || output.includes('[Test audit] Command timed out');
    const copiedArtifacts = await copyArtifacts(check);
    const status = code === 0 ? 'PASS' : check.warningOnFail ? 'WARNING' : 'FAIL';
    let parsed = { failing: [], passing: {} };
    try {
      if (check.parser === 'jest') {
        parsed = await parseJest(check);
      }
      if (check.parser === 'playwright') {
        parsed = await parsePlaywright(check);
      }
    } catch (e) {
      parsed = {
        failing: [
          {
            runner: check.parser,
            file: '',
            name: 'Parser limitation',
            message: e.message,
            category: 'Unknown/manual review required',
            action: 'Review raw log.',
          },
        ],
        passing: {},
      };
    }
    for (const failure of parsed.failing) failure.category = classify(check, failure.message);
    failingTests.push(...parsed.failing);
    passingSummaries.push({ id: check.id, ...parsed.passing });
    results.push({
      ...check,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMs: end - start,
      exitCode: code,
      status,
      stdout,
      stderr,
      timedOut,
      incomplete: timedOut,
      copiedArtifacts,
      failureReason: status === 'PASS' ? '' : excerpt(output),
      likelyCategory: status === 'PASS' ? '' : classify(check, output),
      logFile: `logs/${check.log}`,
      notes: [
        check.safe || '',
        copiedArtifacts.length ? `Artifacts copied: ${copiedArtifacts.join(', ')}` : '',
        timedOut
          ? 'Audit runner timed out before this check could complete; review partial artifacts/logs.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  }

  const branch = await gitInfo(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = await gitInfo(['rev-parse', '--short', 'HEAD']);
  const workflows = await workflowFindings();
  const skipped = allChecks
    .filter(c => !selectedChecks().some(s => s.id === c.id))
    .map(c => ({
      id: c.id,
      area: c.area,
      suite: c.area,
      command: c.command,
      status: 'SKIPPED',
      reason: `Not selected in ${mode} mode.`,
    }));
  if (!live) {
    skipped.push({
      id: 'go-live-audit-live',
      area: 'Live checks',
      suite: 'Live checks',
      command: 'npm run audit:golive:live',
      status: 'SKIPPED',
      reason: 'Live checks require explicit --live and must remain read-only.',
    });
  }

  const counts = {
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    warning: results.filter(r => r.status === 'WARNING').length,
    skipped: skipped.length,
  };
  const mostSerious =
    results.find(r => r.status === 'FAIL')?.area ||
    results.find(r => r.status === 'WARNING')?.area ||
    'None';
  const nextPr = counts.fail
    ? 'Triage the highest-priority failing audit suite without changing this audit baseline.'
    : 'Review whether the audit workflow should become a regular scheduled or required check.';
  const greenRows =
    results
      .filter(r => r.status === 'PASS')
      .map(
        r =>
          `| ${esc(r.area)} | \`${esc(r.command)}\` | ${r.status} | ${ms(r.durationMs)} | ${esc(r.notes || 'Completed successfully.')} |`
      )
      .join('\n') || '| _None_ | | | | |';
  const redRows =
    results
      .filter(r => r.status !== 'PASS')
      .map(
        r =>
          `| ${esc(r.area)} | \`${esc(r.command)}\` | ${r.status} | ${esc(r.failureReason)} | ${r.likelyCategory} | Preserve failure and open a focused follow-up PR. | ${r.logFile} |`
      )
      .join('\n') || '| _None_ | | | | | | |';
  const failingCsv = [
    [
      'Test runner',
      'Test file',
      'Test name',
      'Failure message',
      'Likely category',
      'Suggested next action',
    ]
      .map(csvEscape)
      .join(','),
    ...failingTests.map(t =>
      [t.runner, t.file, t.name, t.message, t.category, t.action].map(csvEscape).join(',')
    ),
  ].join('\n');
  const failRows =
    failingTests
      .map(
        t =>
          `| ${esc(t.runner)} | ${esc(t.file)} | ${esc(t.name)} | ${esc(t.message)} | ${t.category} | ${esc(t.action)} |`
      )
      .join('\n') || '| _No individual failing tests were extracted._ | | | | | |';
  const skipRows =
    skipped.map(s => `- ${s.suite}: \`${s.command}\` — ${s.reason}`).join('\n') || '- None.';
  const detailRows =
    results
      .filter(r => r.status !== 'PASS')
      .map(
        r =>
          `### ${r.area}\n\n- Command: \`${r.command}\`\n- Exit code: ${r.exitCode}\n- Duration: ${ms(r.durationMs)}\n- Key error excerpt:\n\n\`\`\`\n${r.failureReason}\n\`\`\`\n- Related log file: ${r.logFile}\n- Is this likely a real product regression? ${r.likelyCategory === 'Real product regression' ? 'Possibly; review required.' : 'Unknown.'}\n- Is this likely a stale test? ${r.likelyCategory === 'Stale test expectation' ? 'Possibly.' : 'Unknown.'}\n- Is this likely an environment issue? ${r.likelyCategory === 'Environment/config issue' ? 'Possibly.' : 'Unknown.'}\n- Suggested follow-up PR: Focused fix for ${r.area}.`
      )
      .join('\n\n') || 'No failing suites.';

  const report = `# EventFlow Test Audit Report\n\nGenerated: ${new Date().toISOString()}\nBranch: ${branch}\nCommit: ${commit}\nNode version: ${process.version}\nMode: ${mode}${live ? ' + live' : ''}\nEnvironment: ${process.env.CI ? 'GitHub Actions/CI' : 'Local development'}\n\n## Executive Summary\n\n- Total checks run: ${results.length}\n- Passing checks: ${counts.pass}\n- Failing checks: ${counts.fail}\n- Warnings: ${counts.warning}\n- Skipped: ${skipped.length}\n- Overall status: ${counts.fail ? 'RED — one or more checks failed' : counts.warning ? 'AMBER — warnings need review' : 'GREEN — selected checks passed'}\n- Most serious issue: ${mostSerious}\n- Recommended next PR: ${nextPr}\n\n## Green List — Passing Checks\n\n| Area | Command | Status | Duration | Notes |\n| --- | --- | --- | --- | --- |\n${greenRows}\n\n## Red List — Failing Checks\n\n| Area | Command | Status | Failure reason | Likely category | Suggested next action | Log file |\n| --- | --- | --- | --- | --- | --- | --- |\n${redRows}\n\nFailure categories used by this audit: ${categories.join('; ')}.\n\n## Individual Failing Tests\n\n| Test runner | Test file | Test name | Failure message | Likely category | Suggested next action |\n| --- | --- | --- | --- | --- | --- |\n${failRows}\n\n## Passing Test Summary\n\n- Detailed pass counts are stored in \`results.json\`.\n- Jest/Playwright passing totals are summarised from machine-readable output where available.\n- Passing summary data: \`${esc(JSON.stringify(passingSummaries))}\`\n\n## Skipped / Not Run\n\n${skipRows}\n\n## Workflow / CI Findings\n\n${workflows.join('\n')}\n\n## Detailed Failure Notes\n\n${detailRows}\n\n## Recommended Fix Order\n\n1. CI/workflow blockers that prevent us seeing real test results\n2. Smoke test failures\n3. Real product regressions\n4. Authentication/security failures\n5. Messaging/notification/data integrity failures\n6. Environment/config issues\n7. Stale test expectations\n8. Flaky/timing issues\n9. Visual snapshot drift\n10. Non-critical warnings\n\n## Suggested Next PRs\n\n- PR 1: Fix blocking CI/workflow issue\n- PR 2: Fix smoke test failures\n- PR 3: Fix genuine product regressions\n- PR 4: Update stale test expectations\n- PR 5: Review visual snapshots\n`;

  await writeFile(path.join(OUT, 'TEST_AUDIT_REPORT.md'), report);
  await writeFile(
    path.join(OUT, 'results.json'),
    JSON.stringify(
      {
        generated: started.toISOString(),
        mode,
        live,
        branch,
        commit,
        results,
        skipped,
        allChecks: [...results, ...skipped],
        workflowFindings: workflows,
        passingSummaries,
      },
      null,
      2
    )
  );
  await writeFile(path.join(OUT, 'failing-tests.json'), JSON.stringify(failingTests, null, 2));
  await writeFile(
    path.join(OUT, 'failing-tests.md'),
    `# Failing Tests\n\n| Test runner | Test file | Test name | Failure message | Likely category | Suggested next action |\n| --- | --- | --- | --- | --- | --- |\n${failRows}\n`
  );
  await writeFile(path.join(OUT, 'failing-tests.csv'), `${failingCsv}\n`);
  await writeFile(
    path.join(OUT, 'passing-summary.md'),
    `# Passing Summary\n\n\`\`\`json\n${JSON.stringify(passingSummaries, null, 2)}\n\`\`\`\n`
  );
  console.log(report);
  if (mode === 'ci' && counts.fail) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
