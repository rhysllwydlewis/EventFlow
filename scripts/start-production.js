'use strict';

const { spawn } = require('child_process');

const SHUTDOWN_GRACE_MS = 10_000;

function workerHealthPort(env = process.env) {
  const webPort = Number(env.PORT || 3000);
  const configuredPort = Number(env.EVENTFLOW_WORKER_HEALTH_PORT || 0);
  const port = configuredPort || (webPort < 65_535 ? webPort + 1 : webPort - 1);

  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === webPort) {
    throw new Error('EVENTFLOW_WORKER_HEALTH_PORT must be a valid port distinct from PORT');
  }
  return String(port);
}

function startProduction({ env = process.env, spawnProcess = spawn } = {}) {
  const children = new Map();
  let stopping = false;
  let finalExitCode = 0;
  let forceExitTimer = null;

  const finishIfStopped = () => {
    if (!stopping || [...children.values()].some(child => child.exitCode === null)) {
      return;
    }
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
    process.exit(finalExitCode);
  };

  const stop = (reason, exitCode) => {
    if (stopping) {
      return;
    }
    stopping = true;
    finalExitCode = exitCode;
    console.info(`[production] stopping web and worker processes (${reason})`);

    for (const child of children.values()) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }
    forceExitTimer = setTimeout(() => {
      for (const child of children.values()) {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }
      process.exit(finalExitCode);
    }, SHUTDOWN_GRACE_MS);
    forceExitTimer.unref?.();
    finishIfStopped();
  };

  const launch = (name, args, childEnv) => {
    const child = spawnProcess(process.execPath, args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: 'inherit',
    });
    children.set(name, child);
    child.once('error', error => {
      console.error(`[production] ${name} process failed to start`, error);
      stop(`${name} startup failure`, 1);
    });
    child.once('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[production] ${name} process exited`, { code, signal });
        stop(`${name} process exited`, code || 1);
      }
      finishIfStopped();
    });
    return child;
  };

  launch('web', ['-r', './services/deploymentMetadataPreload.js', 'server.js'], {
    ...env,
    EVENTFLOW_PROCESS_TYPE: 'web',
  });
  launch('worker', ['scripts/worker.js'], {
    ...env,
    EVENTFLOW_PROCESS_TYPE: 'worker',
    PORT: workerHealthPort(env),
  });

  process.once('SIGTERM', () => stop('SIGTERM', 0));
  process.once('SIGINT', () => stop('SIGINT', 0));

  return children;
}

if (require.main === module) {
  startProduction();
}

module.exports = { startProduction, workerHealthPort };
