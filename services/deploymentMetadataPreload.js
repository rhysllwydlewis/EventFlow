'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function launchDeploymentMetadata({
  spawnProcess = spawn,
  executable = process.execPath,
  root = process.cwd(),
  env = process.env,
  warn = console.warn,
} = {}) {
  try {
    const script = path.join(root, 'scripts', 'write-deployment-metadata.mjs');
    const child = spawnProcess(executable, [script], {
      cwd: root,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    child.on('error', error => {
      warn(
        `[deployment-metadata] non-fatal launch warning: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
    child.unref();
    return child;
  } catch (error) {
    warn(
      `[deployment-metadata] non-fatal launch warning: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

if (process.env.DEPLOYMENT_METADATA_PRELOAD_AUTOINSTALL !== 'false') {
  launchDeploymentMetadata();
  require('./backgroundJobTelemetryBridge');
}

module.exports = { launchDeploymentMetadata };
