/**
 * Keeps the shared chrome inside every guide article in step with the site.
 *
 * Roughly half of each article file is not the article: it is the site header,
 * the mobile bottom navigation and the footer, copied into all 34 files. That
 * copy drifted. Before this script the 34 articles between them carried six
 * different site headers, two bottom navigations and seven footers, and every
 * one of them was serving a main navigation two links out of date.
 *
 * The canonical markup lives in `scripts/lib/article-chrome.mjs`, shared with
 * `new-article.mjs` so a scaffolded article is drift-free the moment it is
 * written. That module documents where each block comes from and why.
 *
 * Deliberately NOT owned yet: the `.notification-dropdown` block. It is nested
 * divs with no unique wrapper tag, so it cannot be matched safely the way the
 * three blocks here can, and it is absent from 8 of the 34 files. Unifying it
 * needs a real parser rather than a pattern, so it is left for a follow-up.
 *
 * The generated files are committed. Re-run this after changing the markup in
 * the shared module or the header in guides.html, and commit the result.
 *
 * Usage:
 *   node scripts/generate-article-shells.mjs           # rewrite the articles
 *   node scripts/generate-article-shells.mjs --check   # report drift, write nothing
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyChrome, articlesDir, buildBlocks } from './lib/article-chrome.mjs';

/**
 * List the article files.
 * @returns {Promise<string[]>} Absolute paths, sorted.
 */
async function articleFiles() {
  const entries = await readdir(articlesDir);
  return entries
    .filter(entry => entry.endsWith('.html'))
    .sort()
    .map(entry => path.join(articlesDir, entry));
}

/**
 * Entry point.
 * @returns {Promise<void>} Nothing.
 */
async function main() {
  const check = process.argv.includes('--check');
  const blocks = await buildBlocks();
  const files = await articleFiles();
  const drifted = [];
  let rewritten = 0;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const generated = applyChrome(source, path.basename(file), blocks);

    if (generated === source) {
      continue;
    }

    if (check) {
      drifted.push(path.basename(file));
    } else {
      await writeFile(file, generated);
      rewritten += 1;
    }
  }

  if (check) {
    if (drifted.length > 0) {
      const names = drifted.map(name => `  ${name}`).join('\n');
      console.error(
        `${drifted.length} article(s) have chrome that does not match the template:\n${names}\n\nRun: node scripts/generate-article-shells.mjs`
      );
      // Set the code rather than calling process.exit(): exiting mid-tick can
      // truncate buffered stderr, and the drift report above is the whole point
      // of --check. Matches generate-community-pages.mjs.
      process.exitCode = 1;
      return;
    }
    console.log(`All ${files.length} articles match the template.`);
    return;
  }

  console.log(`Rewrote ${rewritten} of ${files.length} articles.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
