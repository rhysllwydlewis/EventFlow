import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function writeDeploymentMetadata({
  root = process.cwd(),
  env = process.env,
  log = console.log,
} = {}) {
  const publicDirectory = path.join(root, 'public');
  const destination = path.join(publicDirectory, 'deployment.json');
  const temporary = `${destination}.tmp`;
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  const metadata = {
    commit:
      env.RAILWAY_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.SOURCE_COMMIT || 'unknown',
    branch: env.RAILWAY_GIT_BRANCH || env.GIT_BRANCH || 'unknown',
    version: packageJson.version,
    environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'development',
    generatedAt: new Date().toISOString(),
  };

  await mkdir(publicDirectory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);

  log(
    `[deployment-metadata] version=${metadata.version} commit=${metadata.commit} environment=${metadata.environment}`
  );

  return metadata;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await writeDeploymentMetadata();
}
