'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-asset-versions.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function page(refs) {
  return `<!doctype html><html><head>${refs.join('')}</head><body></body></html>`;
}

const script = url => `<script src="${url}" defer></script>`;
const style = url => `<link rel="stylesheet" href="${url}" />`;

/**
 * Builds a throwaway repo with a "main" commit and a working tree on top of it,
 * so the guard runs against real git history.
 */
function makeRepo({ base, change }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-versions-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  for (const [file, content] of Object.entries(base)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feature');
  for (const [file, content] of Object.entries(change)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  return dir;
}

function run(dir, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--base=main', `--root=${dir}`, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: '', ...env },
  });
}

describe('check-asset-versions', () => {
  it('fails when a modified script keeps the same ?v= on a page that loads it', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/app.js': 'a',
        'public/auth.html': page([script('/assets/js/app.js?v=1.0.0')]),
      },
      change: { 'public/assets/js/app.js': 'b' },
    });

    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/assets/js/app.js');
    expect(result.stderr).toContain('public/auth.html');
    expect(result.stderr).toContain('still ?v=1.0.0');
  });

  it('passes when every referencing page changes the ?v= value', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/app.js': 'a',
        'public/auth.html': page([script('/assets/js/app.js?v=1.0.0')]),
        'public/about.html': page([script('/assets/js/app.js?v=1.0.0')]),
      },
      change: {
        'public/assets/js/app.js': 'b',
        'public/auth.html': page([script('/assets/js/app.js?v=1.0.1')]),
        'public/about.html': page([script('/assets/js/app.js?v=1.0.1')]),
      },
    });

    expect(run(dir).status).toBe(0);
  });

  it('flags only the pages that were not updated', () => {
    const dir = makeRepo({
      base: {
        'public/assets/css/auth.css': 'a',
        'public/auth.html': page([style('/assets/css/auth.css?v=2')]),
        'public/login.html': page([style('/assets/css/auth.css?v=2')]),
      },
      change: {
        'public/assets/css/auth.css': 'b',
        'public/auth.html': page([style('/assets/css/auth.css?v=3')]),
      },
    });

    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('public/login.html');
    expect(result.stderr).not.toContain('public/auth.html (');
  });

  it('flags a modified asset that has no version query at all', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/pages/auth-init.js': 'a',
        'public/auth.html': page([script('/assets/js/pages/auth-init.js')]),
      },
      change: { 'public/assets/js/pages/auth-init.js': 'b' },
    });

    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no ?v= query');
  });

  it('ignores unmodified assets, new references and new pages', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/untouched.js': 'x',
        'public/assets/js/app.js': 'a',
        'public/index.html': page([script('/assets/js/untouched.js?v=1')]),
        'public/old.html': page([]),
      },
      change: {
        'public/assets/js/app.js': 'b',
        // a reference added in this change has never been cached
        'public/old.html': page([script('/assets/js/app.js?v=1')]),
        // a brand new page has no cached URLs either
        'public/new.html': page([script('/assets/js/app.js?v=1')]),
      },
    });

    expect(run(dir).status).toBe(0);
  });

  it('does nothing when no asset was modified', () => {
    const dir = makeRepo({
      base: { 'public/auth.html': page([]) },
      change: { 'public/auth.html': page(['<!-- edit -->']) },
    });

    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no modified assets');
  });

  it('lets a named asset through with ASSET_VERSION_ALLOW', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/app.js': 'a',
        'public/auth.html': page([script('/assets/js/app.js?v=1')]),
      },
      change: { 'public/assets/js/app.js': 'b' },
    });

    expect(run(dir, [], { ASSET_VERSION_ALLOW: '/assets/js/app.js' }).status).toBe(0);
  });

  it('reports but does not fail with --warn-only, and annotates in CI', () => {
    const dir = makeRepo({
      base: {
        'public/assets/js/app.js': 'a',
        'public/auth.html': page([script('/assets/js/app.js?v=1')]),
      },
      change: { 'public/assets/js/app.js': 'b' },
    });

    const result = run(dir, ['--warn-only'], { GITHUB_ACTIONS: 'true' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('public/auth.html');
    expect(result.stdout).toContain('::warning file=public/assets/js/app.js::');
  });

  it('exits 2 with a clear message when the base branch is missing', () => {
    const dir = makeRepo({ base: { 'public/auth.html': page([]) }, change: {} });

    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--base=origin/does-not-exist', `--root=${dir}`],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('fetch-depth: 0');
  });
});
