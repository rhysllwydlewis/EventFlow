'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-lockfile-consistency.mjs');

function runGuard(packageJsonPath, packageLockPath) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PACKAGE_JSON_PATH: packageJsonPath,
      PACKAGE_LOCK_PATH: packageLockPath,
    },
  });
}

function writeFixture(packageJson, lockRoot) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventflow-lockfile-'));
  const packageJsonPath = path.join(directory, 'package.json');
  const packageLockPath = path.join(directory, 'package-lock.json');

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson));
  fs.writeFileSync(
    packageLockPath,
    JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: 3,
      packages: { '': lockRoot },
    })
  );

  return { directory, packageJsonPath, packageLockPath };
}

describe('Dependency lockfile consistency', () => {
  test('the repository package metadata matches package-lock.json', () => {
    const result = runGuard(path.join(ROOT, 'package.json'), path.join(ROOT, 'package-lock.json'));

    expect({
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }).toEqual({
      status: 0,
      stdout: 'package.json and package-lock.json root metadata are consistent.',
      stderr: '',
    });
  });

  test('accepts matching dependency and engine metadata', () => {
    const packageJson = {
      name: 'fixture',
      version: '1.0.0',
      engines: { node: '>=22.0.0 <23' },
      dependencies: { express: '^4.0.0' },
      devDependencies: { jest: '^29.0.0' },
    };
    const fixture = writeFixture(packageJson, packageJson);

    try {
      const result = runGuard(fixture.packageJsonPath, fixture.packageLockPath);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        'package.json and package-lock.json root metadata are consistent.'
      );
      expect(result.stderr).toBe('');
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test('rejects a stale Node engine in package-lock.json', () => {
    const packageJson = {
      name: 'fixture',
      version: '1.0.0',
      engines: { node: '>=22.0.0 <23' },
      dependencies: { express: '^4.0.0' },
    };
    const fixture = writeFixture(packageJson, {
      ...packageJson,
      engines: { node: '>=20.0.0' },
    });

    try {
      const result = runGuard(fixture.packageJsonPath, fixture.packageLockPath);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('engines.node differs');
      expect(result.stderr).toContain('package.json=">=22.0.0 <23"');
      expect(result.stderr).toContain('package-lock.json=">=20.0.0"');
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
