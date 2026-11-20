import { spawn } from 'child_process';
import { mkdir, rm, writeFile, readFile, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { classify } from './lib/test-audit-classify.mjs';
import { CHECK_TIMEOUTS_MS, shouldFailRun } from './lib/test-audit-policy.mjs';

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
    timeoutMs: CHECK_TIMEOUTS_MS.smoke,
  },
  {
    id: 'jest-ci',
    area: 'Jest CI',
    command: 'npm run test:ci -- --json --outputFile=test-audit/jest-ci.json',
    log: 'jest-ci.log',
    modes: ['quick', 'default', 'full', 'ci'],
    parser: 'jest',
    json: 'jest-ci.json',
    timeoutMs: CHECK_TIMEOUTS_MS['jest-ci'],
  },
  {
    id: 'full-regression',
    area: 'Full Jest regression',
    command: 'npm run test:full -- --json --outputFile=test-audit/jest-full.json',
    log: 'full-regression.log',
    modes: ['default', 'full', 'ci'],
    parser: 'jest',
    json: 'jest-full.json',
    timeoutMs: CHECK_TIMEOUTS_MS['full-regression'],
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
    timeoutMs: CHECK_TIMEOUTS_MS['playwright-static'],
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
    timeoutMs: CHECK_TIMEOUTS_MS['playwright-full'],
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
    timeoutMs: CHECK_TIMEOUTS_MS.visual,
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
    timeoutMs: CHECK_TIMEOUTS_MS.a11y,
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

function gitInfo(cmd) {
  return new Promise(resolve => {
    const child = spawn('git', cmd, { cwd: ROOT });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.on('close', () => resolve(out.trim() || 'unknown'));
  });
}

// Env vars that only the isolated full-backend Playwright suite (playwright-full,
// launched via `npm run test:e2e:full` / `test:e2e:backend`, both of which already
// set E2E_MODE=full themselves) is meant to see. The scheduled test-audit workflow
// sets these at job/step scope for that suite's benefit, but every check here inherits
// the same process env. Plain Jest checks (jest-ci/smoke/full-regression) are written
// and verified against per-file isolated local storage; leaking a real, persistent
// MONGODB_URI and the E2E_MODE=full cache/rate-limit bypass into them causes state to
// accumulate across test files in one Jest run and produces spurious failures that
// don't reproduce when a test file is run on its own. Strip both for any check that
// isn't the backend-E2E suite itself.
const BACKEND_E2E_ONLY_ENV_VARS = ['E2E_MODE', 'MONGODB_URI'];
const BACKEND_E2E_CHECK_IDS = new Set(['playwright-full']);

function envForCheck(checkId) {
  const env = { ...process.env, TEST_AUDIT: 'true' };
  if (!BACKEND_E2E_CHECK_IDS.has(checkId)) {
    for (const key of BACKEND_E2E_ONLY_ENV_VARS) {
      delete env[key];
    }
  }
  return env;
}

function runShell(command, timeoutMs = 300000, checkId = null) {
  return new Promise(resolve => {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const wrappedCommand = `timeout -k 10s ${seconds}s bash -lc ${JSON.stringify(command)}`;
    const child = spawn(wrappedCommand, {
      cwd: ROOT,
      shell: true,
      env: envForCheck(checkId),
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
  return `"${String(value).replaceAll('"', '""')}"`;
}

function excerpt(text) {
  const lines = String(text || '')
    .split('\n')
    .filter(Boolean);
  return lines.slice(-12).join('\n').slice(0, 1800) || 'No error excerpt captured; see log file.';
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
  const expiryMatch = visual.match(/CONTINUE_ON_ERROR_UNTIL:\s*['"]?(\d{4}-\d{2}-\d{2})/);
  if (expiryMatch) {
    const expired = new Date(`${expiryMatch[1]}T23:59:59Z`) < new Date();
    findings.push(
      `- Visual regression soft-fail expiry: ${expiryMatch[1]} (${expired ? 'expired — Workflow policy issue' : 'active'}).`
    );
  }
  return findings;
}

// ── Running the checks ──────────────────────────────────────────────────────

/** Runs the check's cleanup command, if it has one, and returns what to prepend to its log. */
async function runPreCommand(check) {
  if (!check.preCommand) {
    return '';
  }
  const cleanup = await runShell(check.preCommand, 10000, check.id);
  return `$ ${check.preCommand}  # audit cleanup only\n${cleanup.stdout}${cleanup.stderr}\n`;
}

/** Runs one check's command and writes its log. */
async function executeCheck(check) {
  const cleanupNote = await runPreCommand(check);
  const start = new Date();
  const { code, stdout, stderr } = await runShell(check.command, check.timeoutMs, check.id);
  const end = new Date();
  await writeFile(
    path.join(LOGS, check.log),
    `${cleanupNote}$ ${check.command}\n\n[stdout]\n${stdout}\n\n[stderr]\n${stderr}`
  );
  return { code, stdout, stderr, start, end };
}

/** Reads the machine-readable results a check left behind, if it has a parser. */
async function parseCheckOutput(check) {
  try {
    if (check.parser === 'jest') {
      return await parseJest(check);
    }
    if (check.parser === 'playwright') {
      return await parsePlaywright(check);
    }
  } catch (e) {
    return {
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
  return { failing: [], passing: {} };
}

function didTimeOut(code, output) {
  return code === 124 || code === 137 || output.includes('[Test audit] Command timed out');
}

function statusFor(check, code) {
  if (code === 0) {
    return 'PASS';
  }
  return check.warningOnFail ? 'WARNING' : 'FAIL';
}

function notesFor(check, copiedArtifacts, timedOut) {
  return [
    check.safe || '',
    copiedArtifacts.length ? `Artifacts copied: ${copiedArtifacts.join(', ')}` : '',
    timedOut
      ? 'Audit runner timed out before this check could complete; review partial artifacts/logs.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function buildResult(check, { run, output, status, timedOut, copiedArtifacts }) {
  return {
    ...check,
    startTime: run.start.toISOString(),
    endTime: run.end.toISOString(),
    durationMs: run.end - run.start,
    exitCode: run.code,
    status,
    stdout: run.stdout,
    stderr: run.stderr,
    timedOut,
    incomplete: timedOut,
    copiedArtifacts,
    failureReason: status === 'PASS' ? '' : excerpt(output),
    likelyCategory: status === 'PASS' ? '' : classify(check, output),
    logFile: `logs/${check.log}`,
    notes: notesFor(check, copiedArtifacts, timedOut),
  };
}

/** Runs one check end to end and returns its result plus what its parser found. */
async function auditCheck(check) {
  const run = await executeCheck(check);
  const output = `${run.stdout}\n${run.stderr}`;
  const timedOut = didTimeOut(run.code, output);
  const copiedArtifacts = await copyArtifacts(check);
  const status = statusFor(check, run.code);
  const parsed = await parseCheckOutput(check);
  for (const failure of parsed.failing) {
    failure.category = classify(check, failure.message);
  }
  return {
    parsed,
    result: buildResult(check, { run, output, status, timedOut, copiedArtifacts }),
  };
}

async function runChecks(checks) {
  const results = [];
  const failingTests = [];
  const passingSummaries = [];
  for (const check of checks) {
    const { parsed, result } = await auditCheck(check);
    failingTests.push(...parsed.failing);
    passingSummaries.push({ id: check.id, ...parsed.passing });
    results.push(result);
  }
  return { results, failingTests, passingSummaries };
}

// ── Summarising ─────────────────────────────────────────────────────────────

function buildSkipped(selected) {
  const skipped = allChecks
    .filter(c => !selected.some(s => s.id === c.id))
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
  return skipped;
}

function summarise(results, skipped) {
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
  return { counts, mostSerious, nextPr };
}

function overallStatus(counts) {
  if (counts.fail) {
    return 'RED — one or more checks failed';
  }
  return counts.warning ? 'AMBER — warnings need review' : 'GREEN — selected checks passed';
}

// ── Report tables ───────────────────────────────────────────────────────────

function greenRowsOf(results) {
  return (
    results
      .filter(r => r.status === 'PASS')
      .map(
        r =>
          `| ${esc(r.area)} | \`${esc(r.command)}\` | ${r.status} | ${ms(r.durationMs)} | ${esc(r.notes || 'Completed successfully.')} |`
      )
      .join('\n') || '| _None_ | | | | |'
  );
}

function redRowsOf(results) {
  return (
    results
      .filter(r => r.status !== 'PASS')
      .map(
        r =>
          `| ${esc(r.area)} | \`${esc(r.command)}\` | ${r.status} | ${esc(r.failureReason)} | ${r.likelyCategory} | Preserve failure and open a focused follow-up PR. | ${r.logFile} |`
      )
      .join('\n') || '| _None_ | | | | | | |'
  );
}

function failingCsvOf(failingTests) {
  return [
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
}

function failRowsOf(failingTests) {
  return (
    failingTests
      .map(
        t =>
          `| ${esc(t.runner)} | ${esc(t.file)} | ${esc(t.name)} | ${esc(t.message)} | ${t.category} | ${esc(t.action)} |`
      )
      .join('\n') || '| _No individual failing tests were extracted._ | | | | | |'
  );
}

function skipRowsOf(skipped) {
  return skipped.map(s => `- ${s.suite}: \`${s.command}\` — ${s.reason}`).join('\n') || '- None.';
}

function detailRowsOf(results) {
  return (
    results
      .filter(r => r.status !== 'PASS')
      .map(
        r =>
          `### ${r.area}\n\n- Command: \`${r.command}\`\n- Exit code: ${r.exitCode}\n- Duration: ${ms(r.durationMs)}\n- Key error excerpt:\n\n\`\`\`\n${r.failureReason}\n\`\`\`\n- Related log file: ${r.logFile}\n- Is this likely a real product regression? ${r.likelyCategory === 'Real product regression' ? 'Possibly; review required.' : 'Unknown.'}\n- Is this likely a stale test? ${r.likelyCategory === 'Stale test expectation' ? 'Possibly.' : 'Unknown.'}\n- Is this likely an environment issue? ${r.likelyCategory === 'Environment/config issue' ? 'Possibly.' : 'Unknown.'}\n- Suggested follow-up PR: Focused fix for ${r.area}.`
      )
      .join('\n\n') || 'No failing suites.'
  );
}

function buildTables({ results, failingTests, skipped }) {
  return {
    greenRows: greenRowsOf(results),
    redRows: redRowsOf(results),
    failingCsv: failingCsvOf(failingTests),
    failRows: failRowsOf(failingTests),
    skipRows: skipRowsOf(skipped),
    detailRows: detailRowsOf(results),
  };
}

function renderReport({
  branch,
  commit,
  results,
  skipped,
  summary,
  tables,
  workflows,
  passingSummaries,
}) {
  const { counts, mostSerious, nextPr } = summary;
  const { greenRows, redRows, failRows, skipRows, detailRows } = tables;
  const modeLabel = `${mode}${live ? ' + live' : ''}`;
  const environment = process.env.CI ? 'GitHub Actions/CI' : 'Local development';
  return `# EventFlow Test Audit Report\n\nGenerated: ${new Date().toISOString()}\nBranch: ${branch}\nCommit: ${commit}\nNode version: ${process.version}\nMode: ${modeLabel}\nEnvironment: ${environment}\n\n## Executive Summary\n\n- Total checks run: ${results.length}\n- Passing checks: ${counts.pass}\n- Failing checks: ${counts.fail}\n- Warnings: ${counts.warning}\n- Skipped: ${skipped.length}\n- Overall status: ${overallStatus(counts)}\n- Most serious issue: ${mostSerious}\n- Recommended next PR: ${nextPr}\n\n## Green List — Passing Checks\n\n| Area | Command | Status | Duration | Notes |\n| --- | --- | --- | --- | --- |\n${greenRows}\n\n## Red List — Failing Checks\n\n| Area | Command | Status | Failure reason | Likely category | Suggested next action | Log file |\n| --- | --- | --- | --- | --- | --- | --- |\n${redRows}\n\nFailure categories used by this audit: ${categories.join('; ')}.\n\n## Individual Failing Tests\n\n| Test runner | Test file | Test name | Failure message | Likely category | Suggested next action |\n| --- | --- | --- | --- | --- | --- |\n${failRows}\n\n## Passing Test Summary\n\n- Detailed pass counts are stored in \`results.json\`.\n- Jest/Playwright passing totals are summarised from machine-readable output where available.\n- Passing summary data: \`${esc(JSON.stringify(passingSummaries))}\`\n\n## Skipped / Not Run\n\n${skipRows}\n\n## Workflow / CI Findings\n\n${workflows.join('\n')}\n\n## Detailed Failure Notes\n\n${detailRows}\n\n## Recommended Fix Order\n\n1. CI/workflow blockers that prevent us seeing real test results\n2. Smoke test failures\n3. Real product regressions\n4. Authentication/security failures\n5. Messaging/notification/data integrity failures\n6. Environment/config issues\n7. Stale test expectations\n8. Flaky/timing issues\n9. Visual snapshot drift\n10. Non-critical warnings\n\n## Suggested Next PRs\n\n- PR 1: Fix blocking CI/workflow issue\n- PR 2: Fix smoke test failures\n- PR 3: Fix genuine product regressions\n- PR 4: Update stale test expectations\n- PR 5: Review visual snapshots\n`;
}

// ── Writing the output files ────────────────────────────────────────────────

async function writeOutputs({
  report,
  branch,
  commit,
  results,
  skipped,
  workflows,
  passingSummaries,
  failingTests,
  tables,
}) {
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
    `# Failing Tests\n\n| Test runner | Test file | Test name | Failure message | Likely category | Suggested next action |\n| --- | --- | --- | --- | --- | --- |\n${tables.failRows}\n`
  );
  await writeFile(path.join(OUT, 'failing-tests.csv'), `${tables.failingCsv}\n`);
  await writeFile(
    path.join(OUT, 'passing-summary.md'),
    `# Passing Summary\n\n\`\`\`json\n${JSON.stringify(passingSummaries, null, 2)}\n\`\`\`\n`
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(LOGS, { recursive: true });
  const selected = selectedChecks();
  const { results, failingTests, passingSummaries } = await runChecks(selected);

  const branch = await gitInfo(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = await gitInfo(['rev-parse', '--short', 'HEAD']);
  const workflows = await workflowFindings();
  const skipped = buildSkipped(selected);
  const summary = summarise(results, skipped);
  const tables = buildTables({ results, failingTests, skipped });
  const report = renderReport({
    branch,
    commit,
    results,
    skipped,
    summary,
    tables,
    workflows,
    passingSummaries,
  });

  await writeOutputs({
    report,
    branch,
    commit,
    results,
    skipped,
    workflows,
    passingSummaries,
    failingTests,
    tables,
  });
  console.log(report);
  if (shouldFailRun(mode, summary.counts.fail)) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
