'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('production startup contract', () => {
  const originalAutoinstall = process.env.DEPLOYMENT_METADATA_PRELOAD_AUTOINSTALL;

  beforeAll(() => {
    process.env.DEPLOYMENT_METADATA_PRELOAD_AUTOINSTALL = 'false';
  });

  afterAll(() => {
    if (originalAutoinstall === undefined) {
      delete process.env.DEPLOYMENT_METADATA_PRELOAD_AUTOINSTALL;
    } else {
      process.env.DEPLOYMENT_METADATA_PRELOAD_AUTOINSTALL = originalAutoinstall;
    }
  });

  test('Railway and Docker use the same proven Node preload path', () => {
    const railway = JSON.parse(read('railway.json'));
    const dockerfile = read('Dockerfile');
    const preload = read('services/deploymentMetadataPreload.js');

    expect(railway.deploy.startCommand).toBe(
      'node -r ./services/deploymentMetadataPreload.js server.js'
    );
    expect(railway.deploy.healthcheckPath).toBe('/api/health');
    expect(railway.deploy.healthcheckTimeout).toBeGreaterThanOrEqual(120);
    expect(dockerfile).toContain(
      'CMD ["node", "-r", "./services/deploymentMetadataPreload.js", "server.js"]'
    );
    expect(railway.deploy.startCommand).not.toContain('&&');
    expect(preload).toContain("require('./backgroundJobTelemetryBridge')");
  });

  test('metadata launch failure is non-fatal and detached from server startup', () => {
    jest.resetModules();
    const { launchDeploymentMetadata } = require('../../services/deploymentMetadataPreload');
    const warn = jest.fn();

    expect(
      launchDeploymentMetadata({
        spawnProcess: () => {
          throw new Error('simulated process launch failure');
        },
        warn,
      })
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-fatal launch warning'));

    const child = { on: jest.fn(), unref: jest.fn() };
    const spawnProcess = jest.fn(() => child);
    expect(launchDeploymentMetadata({ spawnProcess, warn })).toBe(child);
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [path.join(root, 'scripts', 'write-deployment-metadata.mjs')],
      expect.objectContaining({ cwd: root })
    );
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  test('Dependabot does not automatically open major-upgrade PRs', () => {
    const dependabot = read('.github/dependabot.yml');

    expect(dependabot).toMatch(/dependency-name: ['"]\*['"]/);
    expect(dependabot).toMatch(/version-update:semver-major/);
    expect(dependabot).toMatch(/dependency-name: pdfkit/);
    expect(dependabot).toMatch(/dependency-name: sharp/);
  });
});
