'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-lockfile-consistency.mjs');

describe('Dependency lockfile consistency', () => {
  test('package.json dependency metadata matches package-lock.json', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect({
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }).toEqual({
      status: 0,
      stdout: 'package.json and package-lock.json dependency metadata are consistent.',
      stderr: '',
    });
  });
});
