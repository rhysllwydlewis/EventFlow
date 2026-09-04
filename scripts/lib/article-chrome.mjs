/**
 * The canonical EventFlow site chrome, shared by every script that writes an
 * article file.
 *
 * Two scripts need the same header, bottom navigation and footer:
 * `generate-article-shells.mjs`, which keeps the 34 committed articles in step,
 * and `new-article.mjs`, which scaffolds a new one. Giving them one source
 * means a scaffolded article is already drift-free the moment it is written —
 * the `--check` run that guards the other 34 passes over it without changes.
 *
 * Canonical sources, and why each one:
 *
 *   Site header  Read from public/guides.html at generation time rather than
 *                copied into this file. index.html, suppliers.html, guides.html
 *                and pricing.html all carry the same seven-link navigation, and
 *                guides.html and index.html are byte-identical here once
 *                whitespace and `aria-current` are normalised. Reading the live
 *                page means articles cannot drift from it again.
 *
 *   Bottom nav   Embedded below. guides.html has no bottom navigation, so there
 *                is no live page to read it from. The markup is content-identical
 *                to what all 34 articles ship and to the bottom navigation in
 *                generate-community-pages.mjs.
 *
 *   Footer       Embedded below, in the class-based form generate-community-pages.mjs
 *                uses. The inline styles the articles used to carry are exactly
 *                what `.ef-footer-content` (components.css) and `.footer-credit`
 *                (styles.css) were added to replace, and both stylesheets are
 *                already loaded by every article. guides.html's own footer is
 *                deliberately NOT the source: eventflow-footer.js replaces its
 *                innerHTML on load, so that markup never renders and has never
 *                been validated.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(here, '..', '..', 'public');
export const articlesDir = path.join(publicDir, 'articles');
const headerSourceFile = path.join(publicDir, 'guides.html');

export const HEADER_PATTERN = /<header class="ef-header"[\s\S]*?<\/header>/;
export const BOTTOM_NAV_PATTERN = /<nav aria-label="Mobile bottom navigation"[\s\S]*?<\/nav>/;
export const FOOTER_PATTERN = /<footer class="footer"[\s\S]*?<\/footer>/;

export const BOTTOM_NAV_MARKUP = `<nav aria-label="Mobile bottom navigation" class="ef-bottom-nav" role="navigation">
<a aria-label="Plan your event" class="ef-bottom-link" href="/start">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<path d="M12 20h9"></path>
<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
</svg>
<span class="ef-bottom-label">Plan</span>
</a>
<a aria-label="Browse suppliers" class="ef-bottom-link" href="/suppliers">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<circle cx="11" cy="11" r="8"></circle>
<path d="m21 21-4.35-4.35"></path>
</svg>
<span class="ef-bottom-label">Suppliers</span>
</a>
<a aria-label="View guides" class="ef-bottom-link" href="/guides">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
</svg>
<span class="ef-bottom-label">Guides</span>
</a>
<!-- Dashboard with notification badge (shown when logged in, replaces Alerts) -->
<a aria-label="Go to dashboard" class="ef-bottom-link" href="#" id="ef-bottom-dashboard" style="display: none;">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<rect height="7" rx="1" width="7" x="3" y="3"></rect>
<rect height="7" rx="1" width="7" x="14" y="3"></rect>
<rect height="7" rx="1" width="7" x="14" y="14"></rect>
<rect height="7" rx="1" width="7" x="3" y="14"></rect>
</svg>
<span class="ef-bottom-label">Dashboard</span>
<span class="ef-badge" id="ef-bottom-dashboard-badge" style="display: none;"></span>
</a>
<!-- Alerts button (shown when logged out) -->
<a aria-label="View guides and alerts" class="ef-bottom-link" href="/guides" id="ef-bottom-alerts">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
</svg>
<span class="ef-bottom-label">Alerts</span>
</a>
<button aria-controls="ef-mobile-menu" aria-expanded="false" aria-label="Open menu" class="ef-cta ef-bottom-link" id="ef-bottom-menu" type="button">
<svg aria-hidden="true" class="ef-bottom-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">
<line x1="3" x2="21" y1="12" y2="12"></line>
<line x1="3" x2="21" y1="6" y2="6"></line>
<line x1="3" x2="21" y1="18" y2="18"></line>
</svg>
</button>
</nav>`;

export const FOOTER_MARKUP = `<footer class="footer" role="contentinfo">
<div class="container ef-footer-content">
<div><strong>EventFlow</strong><br/><span class="small">Event planning made simple.</span></div>
<div class="small">
<a href="/guides">Guides</a> ·
<a href="/marketplace">Marketplace</a> ·
<a href="/credits">Credits</a> ·
<a href="/contact">Contact</a> ·
<a href="/legal">Legal Hub</a> ·
<button data-cookie-prefs="" type="button">Cookie preferences</button>
</div>
<div class="footer-credit small">Operated by <a href="https://vexi.co.uk" rel="noopener noreferrer" target="_blank">VEXI</a></div>
</div>
</footer>`;

/**
 * Refuse to touch a block whose match is not a single, balanced element.
 *
 * Every pattern here is anchored on a tag that does not nest inside itself, so a
 * non-greedy match cannot stop early and truncate the block. This re-proves that
 * for every file on every run rather than trusting it: a truncated match would
 * silently delete the rest of the page.
 * @param {string} matched The matched block.
 * @param {{name: string, tag: string}} block The block definition.
 * @param {string} file The file being processed.
 * @returns {void} Nothing.
 */
export function assertSafe(matched, block, file) {
  const opens = matched.match(new RegExp(`<${block.tag}[\\s>]`, 'g'))?.length ?? 0;
  const closes = matched.split(`</${block.tag}>`).length - 1;
  const divOpens = matched.split('<div').length - 1;
  const divCloses = matched.split('</div>').length - 1;

  if (opens !== 1 || closes !== 1 || divOpens !== divCloses) {
    throw new Error(
      `${file}: refusing to replace the ${block.name} — matched markup is not a single balanced ` +
        `<${block.tag}> (${opens} open, ${closes} close, ${divOpens} <div> vs ${divCloses} </div>).`
    );
  }
}

/**
 * Read the canonical site header out of guides.html.
 * @returns {Promise<string>} The header markup.
 */
export async function readCanonicalHeader() {
  const source = await readFile(headerSourceFile, 'utf8');
  const match = source.match(HEADER_PATTERN);

  if (!match) {
    throw new Error(
      'guides.html: no <header class="ef-header"> found to use as the canonical header.'
    );
  }

  assertSafe(match[0], { name: 'site header', tag: 'header' }, 'guides.html');

  // Articles are guides, so guides.html's own `aria-current="page"` on the
  // Guides link is already correct for them and is carried over as-is.
  return match[0];
}

/**
 * Build the block list for this run.
 * @returns {Promise<Array<{name: string, tag: string, pattern: RegExp, markup: string}>>} The blocks.
 */
export async function buildBlocks() {
  return [
    {
      name: 'site header',
      tag: 'header',
      pattern: HEADER_PATTERN,
      markup: await readCanonicalHeader(),
    },
    {
      name: 'mobile bottom navigation',
      tag: 'nav',
      pattern: BOTTOM_NAV_PATTERN,
      markup: BOTTOM_NAV_MARKUP,
    },
    {
      name: 'footer',
      tag: 'footer',
      pattern: FOOTER_PATTERN,
      markup: FOOTER_MARKUP,
    },
  ];
}

/**
 * Apply every canonical block to one article's source.
 * @param {string} source The article HTML.
 * @param {string} file The file name, for error messages.
 * @param {Array<{name: string, tag: string, pattern: RegExp, markup: string}>} blocks The blocks.
 * @returns {string} The article with canonical chrome.
 */
export function applyChrome(source, file, blocks) {
  let result = source;

  for (const block of blocks) {
    const match = result.match(block.pattern);
    if (!match) {
      throw new Error(`${file}: no ${block.name} found.`);
    }
    assertSafe(match[0], block, file);
    // Replace via a function so `$&` and friends in the markup stay literal.
    result = result.replace(block.pattern, () => block.markup);
  }

  return result;
}
