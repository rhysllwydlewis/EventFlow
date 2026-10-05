/**
 * Cache-busting guard.
 *
 * Static assets are served with `Cache-Control: max-age=604800` (7 days) and sit
 * behind a CDN, so a changed script or stylesheet only reaches returning
 * visitors when the URL that references it changes. This script fails when a
 * file under public/assets/ was modified relative to the base branch but a page
 * that loads it still references it with the same (or no) `?v=` query.
 *
 * It exists because of a real incident: app.js changed but auth.html kept
 * `app.js?v=18.5.0`, so returning visitors ran the old script against the new
 * markup and every email sign-up failed.
 *
 * Usage:
 *   node scripts/check-asset-versions.mjs [--base=origin/main] [--root=<repo>]
 *                                         [--warn-only] [--verbose]
 *
 *   --warn-only  report problems (as GitHub annotations in CI) but exit 0
 *   --verbose    list every page instead of the first few per asset
 *
 * Environment:
 *   ASSET_VERSION_ALLOW  comma-separated asset paths to skip, e.g.
 *                        "/assets/js/foo.js" (for a change that truly cannot
 *                        affect behaviour, such as a comment-only edit)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSET_PATTERN = /^public\/assets\/.+\.(?:js|mjs|css)$/;
const REF_PATTERN =
  /<(?:script|link)\b[^>]*?\b(?:src|href)=["'](\/assets\/[^"'?#]+\.(?:js|mjs|css))(\?[^"'#]*)?["']/gi;

/**
 * @param {string} html
 * @returns {Map<string, string>} asset URL path -> query string ('' when unversioned)
 */
export function extractRefs(html) {
  const refs = new Map();
  for (const match of html.matchAll(REF_PATTERN)) {
    refs.set(match[1], match[2] || '');
  }
  return refs;
}

/**
 * @param {object} input
 * @param {string[]} input.changedAssets - URL paths of modified assets, e.g. /assets/js/app.js
 * @param {Array<{page: string, base: string|null, head: string}>} input.pages - page HTML at base and head; base is null for new pages
 * @param {string[]} [input.allow] - asset URL paths to skip
 * @returns {Array<{page: string, asset: string, was: string|null, now: string}>}
 */
export function findViolations({ changedAssets, pages, allow = [] }) {
  const violations = [];
  const skip = new Set(allow);

  for (const { page, base, head } of pages) {
    if (base === null) {
      continue; // new page: no cached copy of its URLs can exist
    }
    const baseRefs = extractRefs(base);
    const headRefs = extractRefs(head);

    for (const asset of changedAssets) {
      if (skip.has(asset) || !headRefs.has(asset)) {
        continue;
      }
      const now = headRefs.get(asset);
      const was = baseRefs.has(asset) ? baseRefs.get(asset) : null;
      if (was === null) {
        continue; // reference is new on this page, so its URL has never been cached
      }
      if (!now || now === was) {
        violations.push({ page, asset, was, now });
      }
    }
  }

  return violations;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function tryGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = { base: 'origin/main', root: null, warnOnly: false, verbose: false };
  for (const arg of argv) {
    if (arg === '--warn-only') {
      options.warnOnly = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
    }
  }
  return options;
}

export function run(argv = process.argv.slice(2), env = process.env) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const options = parseArgs(argv);
  const root = path.resolve(options.root || defaultRoot);

  const mergeBase = tryGit(root, ['merge-base', options.base, 'HEAD']);
  if (!mergeBase) {
    console.error(
      [
        `check-asset-versions: cannot find a merge base with "${options.base}".`,
        'In CI, check out with fetch-depth: 0 (or fetch the base branch) first.',
      ].join(' ')
    );
    return 2;
  }
  const base = mergeBase.trim();

  const changed = git(root, [
    'diff',
    '--name-only',
    '--diff-filter=M',
    base,
    'HEAD',
    '--',
    'public/assets',
  ])
    .split('\n')
    .map(line => line.trim())
    .filter(line => ASSET_PATTERN.test(line));

  if (changed.length === 0) {
    console.log('check-asset-versions: no modified assets, nothing to check.');
    return 0;
  }

  const changedAssets = changed.map(file => file.replace(/^public/, ''));
  const allow = (env.ASSET_VERSION_ALLOW || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  const pageFiles = fs
    .readdirSync(path.join(root, 'public'))
    .filter(name => name.endsWith('.html'))
    .sort();

  const pages = pageFiles.map(name => ({
    page: `public/${name}`,
    base: tryGit(root, ['show', `${base}:public/${name}`]),
    head: fs.readFileSync(path.join(root, 'public', name), 'utf8'),
  }));

  const violations = findViolations({ changedAssets, pages, allow });
  const referenced = new Set(
    pages
      .flatMap(({ head }) => [...extractRefs(head).keys()])
      .filter(url => changedAssets.includes(url))
  );
  const unreferenced = changedAssets.filter(url => !referenced.has(url) && !allow.includes(url));

  if (unreferenced.length > 0) {
    const list = unreferenced.map(url => `  ${url}`).join('\n');
    console.log(
      `check-asset-versions: not loaded directly by any page (cannot check, make sure whatever loads them is versioned):\n${list}`
    );
  }

  if (violations.length === 0) {
    console.log(
      `check-asset-versions: ${changedAssets.length} modified asset(s), all references bumped.`
    );
    return 0;
  }

  const byAsset = new Map();
  for (const violation of violations) {
    if (!byAsset.has(violation.asset)) {
      byAsset.set(violation.asset, []);
    }
    byAsset.get(violation.asset).push(violation);
  }

  const inCi = env.GITHUB_ACTIONS === 'true';
  const log = options.warnOnly ? console.warn : console.error;
  log(
    [
      'check-asset-versions: these assets changed but some pages still load them under an unchanged URL.',
      'Browsers and the CDN keep the old copy for up to 7 days, so visitors can run stale code.',
      'Change the ?v= value on each reference (add one if it is missing).',
      '',
    ].join('\n')
  );
  for (const [asset, items] of byAsset) {
    const shown = options.verbose ? items : items.slice(0, 5);
    const lines = shown.map(
      ({ page, now }) => `    ${page} (${now ? `still ${now}` : 'no ?v= query'})`
    );
    if (shown.length < items.length) {
      lines.push(`    ...and ${items.length - shown.length} more (use --verbose)`);
    }
    log(`  ${asset}: ${items.length} page(s)\n${lines.join('\n')}`);
    if (inCi) {
      const level = options.warnOnly ? 'warning' : 'error';
      const file = `public${asset}`;
      const message = `${items.length} page(s) still load this changed asset under an unchanged URL (e.g. ${items[0].page}). Bump its ?v=.`;
      console.log(`::${level} file=${file}::${message}`);
    }
  }
  log(
    [
      '',
      'If a change genuinely cannot affect behaviour (for example a comment), set ASSET_VERSION_ALLOW=/assets/path/to/file.js for that run.',
    ].join('\n')
  );
  return options.warnOnly ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
