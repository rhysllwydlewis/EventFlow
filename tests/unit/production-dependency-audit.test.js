/**
 * `npm audit` exits non-zero for two unrelated reasons: a vulnerability at or
 * above the threshold, and a registry it could not reach. The production audit
 * script used to return that exit code verbatim, so an unreachable registry
 * printed "Production audit: 0 vulnerabilities" — counts parsed out of a report
 * that had none — and then failed the build. The report said clean, the build
 * said blocked, and neither was the truth.
 *
 * These tests drive the script with a stub `npm` on PATH so each case can be
 * pinned exactly: the verdict must come from the parsed counts, and an audit
 * that did not run must be reported as one.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '../../scripts/audit-production-dependencies.mjs');

// The stub is a /bin/sh script, so these run where CI runs and are skipped on
// Windows rather than failing there for a reason that has nothing to do with
// the audit.
const describePosix = process.platform === 'win32' ? describe.skip : describe;

let stubDir;

/**
 * Put a stub `npm` on PATH that prints `stdout` and exits with `code`.
 * @param {string} stdout What the stub writes to stdout.
 * @param {number} code The stub's exit code.
 * @returns {void} Nothing.
 */
function stubNpm(stdout, code) {
  const stub = path.join(stubDir, 'npm');
  fs.writeFileSync(stub, `#!/bin/sh\ncat <<'REPORT'\n${stdout}\nREPORT\nexit ${code}\n`, {
    mode: 0o755,
  });
}

/**
 * Run the audit script against the stub.
 * @returns {{status: number, stdout: string, stderr: string}} The result.
 */
function runAudit() {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

/**
 * A report body with the given counts.
 * @param {Object} counts Per-severity counts.
 * @returns {string} The JSON.
 */
function report(counts) {
  return JSON.stringify({
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
        ...counts,
      },
    },
  });
}

beforeEach(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-stub-'));
});

afterEach(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
});

describePosix('production dependency audit', () => {
  test('passes on a clean report even when npm itself exits non-zero', () => {
    stubNpm(report({}), 1);
    const result = runAudit();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Production audit: 0 vulnerabilities');
    expect(result.stdout).toContain('Production dependencies pass');
  });

  test('passes when everything found is below the threshold', () => {
    stubNpm(report({ moderate: 22, total: 22 }), 0);
    const result = runAudit();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('22 moderate');
    expect(result.stdout).toContain('Nothing at high or above');
  });

  test('fails on a finding at the threshold even when npm exits zero', () => {
    stubNpm(report({ high: 2, total: 2 }), 0);
    const result = runAudit();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('at high or above block this build');
  });

  test('counts everything above the threshold, not just the threshold itself', () => {
    stubNpm(report({ critical: 1, total: 1 }), 0);
    expect(runAudit().status).toBe(1);
  });

  test('honours NPM_AUDIT_LEVEL', () => {
    stubNpm(report({ moderate: 3, total: 3 }), 0);
    let result;
    const previous = process.env.NPM_AUDIT_LEVEL;
    process.env.NPM_AUDIT_LEVEL = 'moderate';
    try {
      result = runAudit();
    } finally {
      if (previous === undefined) {
        delete process.env.NPM_AUDIT_LEVEL;
      } else {
        process.env.NPM_AUDIT_LEVEL = previous;
      }
    }
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Blocking threshold: moderate and above');
  });

  test('reports an unreachable registry as itself, not as a clean audit', () => {
    stubNpm(
      JSON.stringify({ error: { code: 'ENETUNREACH', summary: 'request to registry failed' } }),
      1
    );
    const result = runAudit();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not complete');
    expect(result.stderr).toContain('request to registry failed');
    expect(result.stdout).not.toContain('0 vulnerabilities');
  });

  test('refuses to pass a report with no counts in it', () => {
    stubNpm(JSON.stringify({ vulnerabilities: {} }), 0);
    const result = runAudit();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no vulnerability counts');
  });

  test('reports unparseable output rather than treating it as empty', () => {
    stubNpm('npm ERR! code E401', 1);
    const result = runAudit();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('did not return valid JSON');
  });

  test('reports npm itself being unavailable, rather than "no vulnerability counts"', () => {
    // No stub written: stubDir is empty, and it is the only entry on PATH, so
    // spawnSync cannot find an `npm` binary at all. It sets result.error rather
    // than throwing — result.stdout is undefined, and `JSON.parse(undefined ||
    // '{}')` happily succeeds, so a naive reading of the report would call this
    // "no vulnerability counts" and hide the real reason nothing ran.
    let result;
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: 'utf8',
        env: { PATH: stubDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      result = { status: 0, stdout, stderr: '' };
    } catch (error) {
      result = { status: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
    }
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not run');
    expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).not.toContain('no vulnerability counts');
  });
});
