#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDirectory = path.join(root, 'public');
const destination = path.join(publicDirectory, 'deployment.json');
const temporary = `${destination}.tmp`;
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const metadata = {
  commit:
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    'unknown',
  branch: process.env.RAILWAY_GIT_BRANCH || process.env.GIT_BRANCH || 'unknown',
  version: packageJson.version,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
  generatedAt: new Date().toISOString(),
};

await mkdir(publicDirectory, { recursive: true });
await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
await rename(temporary, destination);

console.log(
  `[deployment-metadata] version=${metadata.version} commit=${metadata.commit} environment=${metadata.environment}`
);
