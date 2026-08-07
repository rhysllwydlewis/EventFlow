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

  test('the production image replaces the base image npm with the security-patched release', () => {
    const dockerfile = read('Dockerfile');

    expect(dockerfile).toContain('RUN npm install --global npm@12.0.2');
    expect(dockerfile).toContain('npm cache clean --force');
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

  test('Dependabot suppresses majors but proposes disruptive minors independently', () => {
    const dependabot = read('.github/dependabot.yml');

    expect(dependabot).toMatch(/dependency-name: ['"]\*['"]/);
    expect(dependabot).toMatch(/version-update:semver-major/);
    expect(dependabot).toMatch(/production-patches:[\s\S]*exclude-patterns: \[pdfkit, sharp\]/);
    expect(dependabot).toMatch(/development-tooling:[\s\S]*exclude-patterns:[\s\S]*prettier/);

    const ignoreSection = dependabot.split(/\n\s*ignore:\s*\n/)[1].split(/\n\s*commit-message:/)[0];
    expect(ignoreSection).not.toMatch(/pdfkit|sharp|prettier|playwright|mongodb-memory-server/);
  });
});
