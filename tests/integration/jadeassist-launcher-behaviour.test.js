'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const RUNNER_PATH = path.join(ROOT, 'tests/helpers/jadeassist-launcher-node-runner.cjs');

describe('JadeAssist native launcher behaviour', () => {
  it('passes its launcher asset and dismissal suite in the supported Node/jsdom runtime', () => {
    const result = spawnSync(process.execPath, [RUNNER_PATH], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    expect({
      status: result.status,
      signal: result.signal,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }).toEqual({
      status: 0,
      signal: null,
      stdout: 'JadeAssist launcher behaviour passed in the Node 22 jsdom runtime.',
      stderr: '',
    });
  });
});
