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

export const NOTIFICATION_DROPDOWN_MARKUP = `<!-- Notification dropdown: pre-rendered here, shown and hidden by notifications.js. -->
<div id="notification-dropdown" class="notification-dropdown" hidden aria-hidden="true" style="display: none;">
<div class="notification-header">
<h3>Notifications</h3>
<button class="notification-mark-all" id="notification-mark-all-read" type="button">Mark all as read</button>
</div>
<div class="notification-list"></div>
<div class="notification-footer">
<a href="/notifications" class="notification-view-all">View all</a>
</div>
</div>`;

/**
 * The scripts the shared header needs, in the order it needs them.
 *
 * Every article renders the header's notification bell, and not one of the 34
 * loaded notifications.js, so on an article the bell was a control that did
 * nothing: no dropdown opened, no count ever appeared. Twenty-six of them even
 * shipped the dropdown markup for the script that was not there.
 *
 * websocket-client.js is deliberately absent. Eighteen articles loaded it, but
 * it only defines window.WebSocketClient and nothing on an article ever
 * constructs one — notifications.js loads socket.io itself. It was a download
 * with no reader.
 */
export const HEADER_SCRIPTS = [
  '/assets/js/utils/auth-state.js',
  '/assets/js/burger-menu.js',
  '/assets/js/navbar.js',
  '/assets/js/notifications.js',
];

export const HEADER_SCRIPTS_MARKUP = HEADER_SCRIPTS.map(
  src => `<script defer="" src="${src}"></script>`
).join('\n');

// Matches the contiguous run of those tags, plus websocket-client.js so the run
// is consumed whole rather than leaving an orphan behind the replacement.
const HEADER_SCRIPTS_PATTERN =
  /(?:<script[^>]*src="\/assets\/js\/(?:utils\/auth-state|burger-menu|navbar|websocket-client|notifications)\.js"[^>]*><\/script>\s*)+/;

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
 * The canonical main navigation, parsed out of the same guides.html header.
 *
 * Scripts that build their own header markup (the community generator marks the
 * current section active and indents to its own shape) need the link list
 * rather than the finished block. Deriving it here means there is still only
 * one place the site's navigation is defined: a link added to guides.html
 * reaches the articles and the community pages alike.
 *
 * Anchors carrying an id are the auth/dashboard/logout controls, which are
 * per-page state rather than navigation, so they are excluded.
 * @returns {Promise<{desktop: Array<{href: string, label: string}>, mobile: Array<{href: string, label: string}>}>} The link lists.
 */
export async function readCanonicalNavLinks() {
  const header = await readCanonicalHeader();

  const linksIn = (navPattern, linkClass) => {
    const nav = header.match(navPattern);
    if (!nav) {
      throw new Error(`guides.html: no <nav> matching ${navPattern} in the canonical header.`);
    }
    // A class *token* match, not an exact attribute-value match: the auth,
    // dashboard and logout controls in the same <nav> carry a second class
    // (e.g. class="ef-mobile-link ef-mobile-primary") and must still be found
    // here so the id-based filter below is what excludes them — not an
    // accidental failure to match a compound class value.
    const pattern = new RegExp(
      `<a\\s([^>]*class="[^"]*\\b${linkClass}\\b[^"]*"[^>]*)>([^<]*)</a>`,
      'g'
    );
    return [...nav[0].matchAll(pattern)]
      .filter(match => !/\sid="/.test(match[1]))
      .map(match => ({
        href: (match[1].match(/href="([^"]+)"/) || [])[1],
        label: match[2].trim(),
      }))
      .filter(link => link.href && link.label);
  };

  const desktop = linksIn(/<nav[^>]*class="ef-nav-desktop"[\s\S]*?<\/nav>/, 'ef-nav-link');
  const mobile = linksIn(/<nav[^>]*class="ef-mobile-nav"[\s\S]*?<\/nav>/, 'ef-mobile-link');

  if (desktop.length < 5 || mobile.length < 5) {
    throw new Error(
      `guides.html: parsed only ${desktop.length} desktop and ${mobile.length} mobile ` +
        'navigation links, which is too few to be the real navigation.'
    );
  }

  return { desktop, mobile };
}

/**
 * The canonical mobile navigation block, ready to drop into a generated header.
 *
 * `readCanonicalNavLinks` gives back the public links only. The block also
 * carries the divider and the log-in / dashboard / settings / log-out
 * controls, and those had drifted too: pages disagreed on whether the log-out
 * link existed at all, and #ef-mobile-settings — which navbar.js has always
 * shown and hidden alongside dashboard and logout on every login/logout —
 * only ever existed on two pages (dashboard-customer.html,
 * dashboard-supplier.html) rather than in the shared template. It is part of
 * this block now, which is also what makes it universal instead of a
 * two-page special case that a later chrome sync can delete by accident.
 * Returning the finished block keeps every generated header byte-identical
 * there, so the only way to change it is to change guides.html.
 * @param {string} indent Leading whitespace for the opening <nav> tag.
 * @returns {Promise<string>} The block, re-indented, with no trailing newline.
 */
export async function readCanonicalMobileNav(indent = '') {
  const header = await readCanonicalHeader();
  const match = header.match(/[ \t]*<nav[^>]*class="ef-mobile-nav"[\s\S]*?<\/nav>/);

  if (!match) {
    throw new Error('guides.html: no <nav class="ef-mobile-nav"> in the canonical header.');
  }

  const block = match[0];
  const base = block.match(/^[ \t]*/)[0];
  return block
    .split('\n')
    .map(line => (line.startsWith(base) ? indent + line.slice(base.length) : line))
    .join('\n');
}

/**
 * Locate the notification dropdown by walking div tags rather than matching.
 *
 * The other three blocks are anchored on a tag that cannot nest inside itself,
 * so a non-greedy pattern is provably safe for them. The dropdown is a <div> of
 * nested <div>s: `<div id="notification-dropdown"[\s\S]*?</div>` stops at the
 * first inner close and would have truncated the block in all 34 articles,
 * deleting the rest of the page with it. Counting depth is the only honest way
 * to find where it actually ends.
 * @param {string} source The page HTML.
 * @param {string} file The file name, for error messages.
 * @returns {{start: number, end: number}|null} The span, or null when absent.
 */
export function findNotificationDropdown(source, file) {
  const opener = /<div[^>]*\sid="notification-dropdown"/g;
  const first = opener.exec(source);

  if (!first) {
    return null;
  }
  // test() continues from the lastIndex the exec above left, so this asks
  // whether a second one follows the first.
  if (opener.test(source)) {
    throw new Error(`${file}: more than one #notification-dropdown — refusing to guess which.`);
  }

  // Nine articles label the block with a comment. Take it into the span so the
  // replacement does not leave a second, differently worded one behind it.
  const preamble = source
    .slice(0, first.index)
    .match(/<!--[^>]*[Nn]otification [Dd]ropdown[\s\S]*?-->\s*$/);
  const start = preamble ? first.index - preamble[0].length : first.index;

  // Comments are skipped rather than scanned: a commented-out <div> inside the
  // block would otherwise raise the depth and never come back down, and the
  // scanner would run off the end of the document swallowing the whole page.
  const tag = /<!--[\s\S]*?-->|<div\b|<\/div>/g;
  tag.lastIndex = first.index;
  let depth = 0;

  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    if (match[0].startsWith('<!--')) {
      continue;
    }
    if (match[0] === '<div') {
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return { start, end: match.index + '</div>'.length };
    }
  }

  throw new Error(`${file}: #notification-dropdown is never closed.`);
}

/**
 * Replace the notification dropdown, or add it when the page has none.
 *
 * Eight of the 34 articles had no dropdown at all, so notifications.js fell back
 * to building one at runtime — it works, but only after the script loads, and it
 * logs a warning every time. The 26 that had one carried two shapes between
 * them, neither with `type="button"` on the mark-all control.
 * @param {string} source The article HTML.
 * @param {string} file The file name, for error messages.
 * @returns {string} The article with the canonical dropdown.
 */
export function applyNotificationDropdown(source, file) {
  const span = findNotificationDropdown(source, file);

  if (span) {
    return source.slice(0, span.start) + NOTIFICATION_DROPDOWN_MARKUP + source.slice(span.end);
  }

  // It belongs immediately after the header, next to the bell that opens it.
  const closing = '</header>';
  const at = source.indexOf(closing);

  if (at < 0) {
    throw new Error(`${file}: no </header> to place the notification dropdown after.`);
  }

  const insertAt = at + closing.length;
  return `${source.slice(0, insertAt)}\n${NOTIFICATION_DROPDOWN_MARKUP}${source.slice(insertAt)}`;
}

/**
 * Replace the run of header scripts with the canonical one.
 * @param {string} source The article HTML.
 * @param {string} file The file name, for error messages.
 * @returns {string} The article with the canonical script run.
 */
export function applyHeaderScripts(source, file) {
  const matches = source.match(new RegExp(HEADER_SCRIPTS_PATTERN, 'g')) || [];

  if (matches.length === 0) {
    throw new Error(`${file}: no header script run found.`);
  }
  if (matches.length > 1) {
    // A file that loads these in two places is doing something this does not
    // model, and collapsing them would change load order.
    throw new Error(
      `${file}: header scripts appear in ${matches.length} places — refusing to rewrite them.`
    );
  }

  const run = matches[0];
  // Keep whatever trailing whitespace separated the run from what follows it.
  const trailing = run.match(/\s*$/)[0];
  return source.replace(run, () => HEADER_SCRIPTS_MARKUP + trailing);
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

  return applyHeaderScripts(applyNotificationDropdown(result, file), file);
}
