'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('production startup contract', () => {
  test('Railway and Docker use the same single-process bootstrap', () => {
    const railway = JSON.parse(read('railway.json'));
    const dockerfile = read('Dockerfile');

    expect(railway.deploy.startCommand).toBe('node scripts/start-production.mjs');
    expect(railway.deploy.healthcheckPath).toBe('/api/health');
    expect(railway.deploy.healthcheckTimeout).toBeGreaterThanOrEqual(120);
    expect(dockerfile).toContain('CMD ["node", "scripts/start-production.mjs"]');
    expect(railway.deploy.startCommand).not.toContain('&&');
  });

  test('metadata failure cannot prevent the application server from starting', () => {
    const program = `
      import { startProduction } from './scripts/start-production.mjs';
      let started = false;
      let warned = false;
      await startProduction({
        writeMetadata: async () => { throw new Error('simulated read-only filesystem'); },
        startServer: async () => { started = true; },
        warn: () => { warned = true; },
      });
      if (!started || !warned) process.exit(1);
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('Dependabot does not automatically open major-upgrade PRs', () => {
    const dependabot = read('.github/dependabot.yml');

    expect(dependabot).toMatch(/dependency-name: ['"]\*['"]/);
    expect(dependabot).toMatch(/version-update:semver-major/);
    expect(dependabot).toMatch(/dependency-name: pdfkit/);
    expect(dependabot).toMatch(/dependency-name: sharp/);
  });
});
