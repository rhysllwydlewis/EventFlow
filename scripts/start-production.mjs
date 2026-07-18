#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeDeploymentMetadata } from './write-deployment-metadata.mjs';

async function loadServer() {
  await import('../services/backgroundJobTelemetryBridge.js');
  await import('../server.js');
}

export async function startProduction({
  writeMetadata = writeDeploymentMetadata,
  startServer = loadServer,
  warn = console.warn,
} = {}) {
  try {
    await writeMetadata();
  } catch (error) {
    warn(
      `[deployment-metadata] non-fatal startup warning: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  await startServer();
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await startProduction();
}
