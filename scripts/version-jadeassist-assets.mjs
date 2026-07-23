import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JADEASSIST_ASSET_VERSION = '20260723-3';
export const JADEASSIST_POLISH_SCRIPT_PATH = '/assets/js/jadeassist-launcher-polish.js';

const JADEASSIST_SCRIPT_PATHS = [
  '/assets/js/vendor/jade-widget.js',
  JADEASSIST_POLISH_SCRIPT_PATH,
  '/assets/js/jadeassist-init.v2.js',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureLauncherPolishScript(content) {
  if (
    content.includes(JADEASSIST_POLISH_SCRIPT_PATH) ||
    !content.includes('/assets/js/jadeassist-init.v2.js')
  ) {
    return content;
  }

  const initializerPattern =
    /^([ \t]*)(<script\b[^>]*\bsrc=["']\/assets\/js\/jadeassist-init\.v2\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>)/m;

  return content.replace(
    initializerPattern,
    `$1<script src="${JADEASSIST_POLISH_SCRIPT_PATH}" defer></script>\n$1$2`
  );
}

export function versionJadeAssistAssetUrls(content) {
  const preparedContent = ensureLauncherPolishScript(content);

  return JADEASSIST_SCRIPT_PATHS.reduce((result, assetPath) => {
    const pattern = new RegExp(`${escapeRegExp(assetPath)}(?:\\?[^"'\\s>]*)?`, 'g');
    return result.replace(pattern, `${assetPath}?v=${JADEASSIST_ASSET_VERSION}`);
  }, preparedContent);
}

function walkHtmlFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(entryPath);
    }
  }

  return files;
}

export function versionJadeAssistAssets(publicDirectory = path.join(process.cwd(), 'public')) {
  let scannedFiles = 0;
  let changedFiles = 0;

  for (const filePath of walkHtmlFiles(publicDirectory)) {
    scannedFiles += 1;
    const original = fs.readFileSync(filePath, 'utf8');
    const versioned = versionJadeAssistAssetUrls(original);

    if (versioned !== original) {
      fs.writeFileSync(filePath, versioned);
      changedFiles += 1;
    }
  }

  return { scannedFiles, changedFiles, version: JADEASSIST_ASSET_VERSION };
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  const result = versionJadeAssistAssets();
  console.log(
    `Versioned JadeAssist assets in ${result.changedFiles}/${result.scannedFiles} HTML files ` +
      `(v=${result.version}).`
  );
}