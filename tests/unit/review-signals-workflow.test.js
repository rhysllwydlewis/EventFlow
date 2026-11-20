'use strict';

/**
 * Structure checks for .github/workflows/review-signals.yml. The decisions are tested in
 * automation-signals.test.js; these keep the workflow itself safe, because comment and
 * check events run with write access in the default branch's context.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/review-signals.yml'), 'utf8');

/** The text of one top-level job, up to the next one. */
function job(name) {
  const start = workflow.indexOf(`\n  ${name}:`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('Review signals workflow', () => {
  test('is least-privilege by default', () => {
    const header = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(header).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  test('listens for the events it needs and has a scheduled safety net', () => {
    const header = workflow.slice(0, workflow.indexOf('\njobs:'));
    for (const trigger of [
      'pull_request:',
      'issue_comment:',
      'check_run:',
      'schedule:',
      'workflow_dispatch:',
    ]) {
      expect(header).toContain(trigger);
    }
  });

  describe('the description check', () => {
    const body = job('pr-description');

    test('only runs on pull request events and needs no write access', () => {
      expect(body).toContain("if: github.event_name == 'pull_request'");
      expect(body).toMatch(/pull-requests: read/);
      expect(body).not.toMatch(/: write/);
    });

    test('calls the tested function and fails the check on a problem', () => {
      expect(body).toContain("require('./scripts/lib/automation-signals.js')");
      expect(body).toContain('checkPullRequestDescription');
      expect(body).toContain('core.setFailed');
    });

    test('skips bot-authored pull requests such as Dependabot', () => {
      expect(body).toContain("pull.user.type === 'Bot'");
    });
  });

  describe('the degraded review flagger', () => {
    const body = job('degraded-review');

    test('has the write access it needs and nothing else', () => {
      expect(body).toMatch(/pull-requests: write/);
      expect(body).toMatch(/issues: write/);
      expect(body).toMatch(/actions: read/);
      expect(body).not.toMatch(/contents: write/);
    });

    test('only reacts to the Codex bot and to a failed code scanning check', () => {
      expect(body).toContain("github.event.comment.user.login == 'chatgpt-codex-connector[bot]'");
      expect(body).toContain("github.event.check_run.name == 'github-advanced-security'");
      expect(body).toContain("github.event.check_run.conclusion == 'failure'");
    });

    test('never checks out or runs code from a pull request', () => {
      // A YAML `ref:` key would check out something other than the default branch.
      expect(body).not.toMatch(/^\s*ref:/m);
      expect(body).not.toMatch(/github\.head_ref|pull_request\.head|head\.sha|head\.ref/);
      expect(body).not.toMatch(/\bnpm (ci|install|run)\b/);
    });

    test('never puts comment text or any event payload text into a script or command', () => {
      expect(workflow).not.toMatch(
        /\$\{\{\s*github\.event\.(comment|issue|pull_request|check_run)\.(body|title|output)/
      );
      expect(workflow).not.toMatch(/\brun:/);
    });

    test('calls the tested function', () => {
      expect(body).toContain("require('./scripts/lib/automation-signals.js')");
      expect(body).toContain('flagDegradedReview');
    });
  });
});
