/**
 * Scaffolds a new article on the premium guide template.
 *
 * The template is only a template if starting a second article is cheap and
 * hard to get wrong. Copying the travel-costs guide and deleting its content
 * is neither: it carries a fuel calculator, seven hand-picked sections and a
 * page of metadata that all has to be found and changed, and anything missed
 * ships. This writes a complete, valid, drift-free article instead.
 *
 * What you get is a working page, not a stub: head metadata and Article JSON-LD
 * filled from the arguments, canonical site chrome from the same source that
 * keeps the other articles in step, a hero, the reading rail and mobile
 * contents, and three example sections showing the block vocabulary. Delete
 * what you do not need — every block is optional.
 *
 * Usage:
 *   node scripts/new-article.mjs \
 *     --slug wedding-transport-guide \
 *     --title "Wedding Transport: A Complete Guide" \
 *     --description "How to plan wedding transport for the couple and guests." \
 *     --kicker "Weddings" \
 *     [--no-numbers]
 *
 * Then add the article to public/assets/data/guides.json so it appears on the
 * hub, in the filters and in the sitemap — the scaffold prints the entry to
 * paste. Nothing here touches that manifest, because a half-registered article
 * is worse than an unregistered one.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyChrome,
  articlesDir,
  buildBlocks,
  HEADER_SCRIPTS_MARKUP,
} from './lib/article-chrome.mjs';

const SITE = 'https://event-flow.co.uk';

/**
 * Parse `--flag value` and `--flag` pairs from argv.
 * @returns {Record<string, string|boolean>} The parsed options.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

/**
 * Escape text for use inside an HTML attribute or text node.
 * @param {string} value The raw text.
 * @returns {string} The escaped text.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialise a value for a `<script type="application/ld+json">` block.
 *
 * Script content is raw text to the HTML parser — it is never HTML-entity
 * decoded — so `escapeHtml` is the wrong tool here even though the values also
 * appear HTML-escaped elsewhere on the page. Interpolating title/description
 * into a hand-written JSON string, as this used to, breaks in two ways a
 * title can easily hit: a `"` survives HTML-escaping as the literal text
 * `&quot;` rather than becoming a real character, and a `\` (e.g. in "10\"
 * chairs") is not a valid JSON escape on its own, so the whole block fails to
 * parse and the rich snippet silently disappears.
 *
 * `JSON.stringify` fixes the syntax; the character-by-character pass after it
 * stops a title containing the literal text `</script>` from ending the tag
 * early and letting whatever follows run as markup. Matches
 * `serializeJsonLd` in services/publicListingSeo.service.js, the same
 * technique already used for the JSON-LD this site renders server-side.
 * @param {unknown} value The JSON-LD payload.
 * @returns {string} Safe to place directly inside the script tag.
 */
function serializeJsonLd(value) {
  const json = JSON.stringify(value);
  let output = '';
  for (const character of json) {
    if (character === '<') {
      output += '\\u003c';
    } else if (character === '>') {
      output += '\\u003e';
    } else if (character === '&') {
      output += '\\u0026';
    } else if (character === '\u2028') {
      output += '\\u2028';
    } else if (character === '\u2029') {
      output += '\\u2029';
    } else {
      output += character;
    }
  }
  return output;
}

/**
 * Build the article document.
 * @param {{slug: string, title: string, description: string, kicker: string, numbered: boolean, today: string}} opts Article details.
 * @returns {string} The complete HTML document.
 */
function document_(opts) {
  const { slug, title, description, kicker, numbered, today } = opts;
  const url = `${SITE}/articles/${slug}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const sections = [
    { id: 'first-section', nav: 'First section', heading: 'The first thing to say' },
    { id: 'second-section', nav: 'Second section', heading: 'The second thing to say' },
    { id: 'questions', nav: 'Common questions', heading: 'Common questions' },
  ];

  const tocLinks = sections
    .map(s => `<a class="gp-toc__link" href="#${s.id}">${s.nav}</a>`)
    .join('\n');
  const mobileToc = sections.map(s => `<li><a href="#${s.id}">${s.nav}</a></li>`).join('\n');

  return `<!DOCTYPE html>

<html lang="en-GB">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" name="viewport"/>
<meta content="#0B8073" name="theme-color"/>
<title>${safeTitle} | EventFlow</title>
<meta content="${safeDescription}" name="description"/>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="${url}" rel="canonical"/>
<meta content="article" property="og:type"/>
<meta content="${safeTitle} | EventFlow" property="og:title"/>
<meta content="${safeDescription}" property="og:description"/>
<meta content="${url}" property="og:url"/>
<meta content="EventFlow" property="og:site_name"/>
<meta content="summary_large_image" name="twitter:card"/>
<meta content="@EventFlowUK" name="twitter:site"/>
<meta content="${safeTitle}" name="twitter:title"/>
<meta content="${safeDescription}" name="twitter:description"/>
<meta content="${today}" property="article:published_time"/>
<meta content="${today}" property="article:modified_time"/>
<meta content="${SITE}/about" property="article:author"/>
<link href="/assets/css/styles.css?v=18.3.0" rel="stylesheet"/>
<link href="/assets/css/eventflow-17.0.0.css?v=18.3.0" rel="stylesheet"/>
<link href="/assets/css/utilities.css?v=18.3.0" rel="stylesheet"/>
<link href="/assets/css/components.css?v=18.4.1" rel="stylesheet"/>
<link href="/assets/css/animations.css?v=18.3.2" rel="stylesheet"/>
<link href="/assets/css/mobile-optimizations.css?v=18.4.4" rel="stylesheet"/>
<link href="/assets/css/navbar.css?v=18.4.1" rel="stylesheet"/>
<link data-eventflow-brand="true" href="/assets/css/eventflow-brand.css?v=1.0.1" rel="stylesheet"/>
<link href="/favicon.svg" rel="icon"/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&amp;display=swap" rel="stylesheet"/>
<link href="/assets/css/guide-premium.css?v=1.0.0" rel="stylesheet"/>
<link href="/assets/css/guide-premium-hardening.css?v=1.1.0" rel="stylesheet"/>
<link href="/assets/css/p3-features.css?v=18.3.0" rel="stylesheet"/>
<link href="/assets/css/public-mobile-compact.css" rel="stylesheet"/>
<script type="application/ld+json">
${serializeJsonLd({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: title,
  description,
  datePublished: today,
  dateModified: today,
  author: { '@type': 'Organization', name: 'EventFlow Team', url: `${SITE}/about` },
  publisher: {
    '@type': 'Organization',
    name: 'EventFlow',
    url: SITE,
    description:
      'UK event planning platform connecting customers with approved event suppliers for weddings, parties and corporate events',
    logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png`, width: 512, height: 512 },
    sameAs: [
      'https://twitter.com/EventFlowUK',
      'https://www.facebook.com/eventflowuk',
      'https://www.instagram.com/eventflowuk',
      'https://www.linkedin.com/company/eventflowuk',
    ],
  },
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
})}
</script>
</head>
<body class="gp-page">
<!--CHROME_HEADER-->
<main>
<article class="gp${numbered ? ' gp--numbered' : ''}" data-gp-article>

<header class="gp-hero">
<div class="gp-hero__media">
<!-- Optional. Drop in an <img class="gp-hero__img"> with srcset for a photo
     hero; without one the hero renders on the brand gradient alone. -->
</div>
<div class="gp-hero__scrim"></div>
<div class="gp-hero__aurora" aria-hidden="true"></div>
<div class="gp-hero__grain" aria-hidden="true"></div>
<div class="gp-hero__inner">
<nav aria-label="Breadcrumb" class="gp-breadcrumb">
<a href="/">Home</a>
<span aria-hidden="true" class="gp-breadcrumb__sep">/</span>
<a href="/guides">Guides</a>
<span aria-hidden="true" class="gp-breadcrumb__sep">/</span>
<span aria-current="page">${safeTitle}</span>
</nav>
<p class="gp-eyebrow">${escapeHtml(kicker)}</p>
<h1 class="gp-title">${safeTitle}</h1>
<p class="gp-lead">${safeDescription}</p>
<div class="gp-meta article-header__meta">
<span class="gp-meta__item"><strong>EventFlow Team</strong></span>
<span class="gp-meta__item">Published: ${today}</span>
</div>
</div>
</header>

<div class="gp-shell">

<aside class="gp-rail">
<div class="gp-rail__progress">
<svg aria-hidden="true" class="gp-ring" height="46" viewBox="0 0 46 46" width="46">
<circle class="gp-ring__track" cx="23" cy="23" fill="none" r="20" stroke-width="3"></circle>
<circle class="gp-ring__bar" cx="23" cy="23" data-gp-ring fill="none" r="20" stroke-width="3"></circle>
</svg>
<span class="gp-rail__progress-text"><span class="gp-rail__progress-pct" data-gp-ring-pct>0%</span><span class="gp-rail__progress-label">read</span></span>
</div>
<p class="gp-toc__heading">In this guide</p>
<nav aria-label="On this page" class="gp-toc__list" data-gp-toc>
${tocLinks}
</nav>
<div class="gp-rail__share">
<button aria-label="Copy link to this guide" class="gp-icon-btn" data-gp-copy-page="${url}" title="Copy link" type="button">
<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16"><rect height="13" rx="2" ry="2" width="13" x="9" y="9"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
</button>
<button aria-label="Print this guide" class="gp-icon-btn" data-gp-print id="print-article-btn" title="Print this guide" type="button">
<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect height="8" width="12" x="6" y="14"></rect></svg>
</button>
</div>
</aside>

<div class="gp-body">

<details class="gp-toc-mobile">
<summary>In this guide</summary>
<ol>
${mobileToc}
</ol>
</details>

<!-- Optional: the summary block. Delete if the article does not need one. -->
<div class="gp-takeaways gp-reveal">
<p class="gp-takeaways__title">The short version</p>
<ul>
<li>First thing a reader should take away.</li>
<li>Second thing a reader should take away.</li>
</ul>
</div>

${sections
  .map(
    s => `<section class="gp-section" data-gp-section id="${s.id}">
<div class="gp-section__head"><h2>${s.heading}</h2></div>
<p>Replace this paragraph. Numbering is generated from the <code>gp--numbered</code>
modifier on the article root, so sections can be added, moved or removed freely.</p>
</section>`
  )
  .join('\n\n')}

<!-- Optional: end-of-article call to action. -->
<div class="gp-cta gp-reveal">
<h2>A heading for the next step</h2>
<p>One sentence on why the reader should take it.</p>
<a class="gp-cta__btn" href="/start">Plan an event <span aria-hidden="true">&rarr;</span></a>
</div>

<div class="gp-backlinks">
<a href="/guides">
<svg aria-hidden="true" fill="none" height="15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="15"><line x1="19" x2="5" y1="12" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
All guides
</a>
<button class="gp-backlinks__print" data-gp-print type="button">
<svg aria-hidden="true" fill="none" height="15" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="15"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect height="8" width="12" x="6" y="14"></rect></svg>
Print
</button>
<a href="/start">Plan an event &rarr;</a>
</div>

</div>
</div>
</article>
</main>
<!--CHROME_FOOTER-->
<!--CHROME_BOTTOM_NAV-->
<!--CHROME_HEADER_SCRIPTS-->
<script src="/assets/js/cookie-consent.js?v=2.0.1"></script>
<script src="/assets/js/app.js?v=18.5.0"></script>
<script defer="" src="/assets/js/article-progress.js"></script>
<script defer="" src="/assets/js/pages/guide-premium.js?v=1.1.0"></script>
</body>
</html>
`;
}

/**
 * Entry point.
 * @returns {Promise<void>} Nothing.
 */
async function main() {
  const options = parseArgs();
  const slug = typeof options.slug === 'string' ? options.slug.trim() : '';
  const title = typeof options.title === 'string' ? options.title.trim() : '';
  const description = typeof options.description === 'string' ? options.description.trim() : '';

  if (!slug || !title || !description) {
    throw new Error(
      'Usage: node scripts/new-article.mjs --slug <slug> --title "<title>" --description "<description>" [--kicker "<kicker>"] [--no-numbers]'
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid --slug "${slug}": use lowercase words separated by single hyphens.`);
  }

  const target = path.join(articlesDir, `${slug}.html`);
  // Computed once: the document's own dates and the guides.json entry printed
  // below must agree, not just be close, and calling new Date() a second time
  // is one avoidable way for them not to.
  const today = new Date().toISOString().slice(0, 10);

  const draft = document_({
    slug,
    title,
    description,
    kicker: typeof options.kicker === 'string' ? options.kicker : 'Guides',
    numbered: options['no-numbers'] !== true,
    today,
  });

  // Same chrome, same source, same run: the article is drift-free on write, so
  // `generate-article-shells.mjs --check` passes over it without a rewrite.
  const blocks = await buildBlocks();
  const filled = draft
    .replace('<!--CHROME_HEADER-->', () => blocks[0].markup)
    .replace('<!--CHROME_BOTTOM_NAV-->', () => blocks[1].markup)
    .replace('<!--CHROME_FOOTER-->', () => blocks[2].markup)
    .replace('<!--CHROME_HEADER_SCRIPTS-->', () => HEADER_SCRIPTS_MARKUP);

  // Run the placeholders through applyChrome rather than trusting them: it is
  // the same function the shell generator runs, so whatever it adds here — the
  // notification dropdown, which has no placeholder because it has no fixed
  // position — the new article has from its first byte.
  const withChrome = applyChrome(filled, `${slug}.html`, blocks);

  // 'wx' fails if the path exists, so the refusal to overwrite is the write
  // itself rather than a check before it. Testing with access() first and
  // writing afterwards leaves a window where the file can appear in between —
  // and "refuses to overwrite an existing article" has to be a guarantee, not
  // a likelihood.
  try {
    await writeFile(target, withChrome, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`${slug}.html already exists — refusing to overwrite it.`);
    }
    throw error;
  }

  console.log(`Created public/articles/${slug}.html

Next:
  1. Write the article. Every block in the file is optional — delete what you
     do not need. Section numbering comes from the gp--numbered modifier on
     <article>, so never hand-write numbers.
  2. Register it in public/assets/data/guides.json so it reaches the hub, the
     filters and the sitemap:

  {
    "title": ${JSON.stringify(title)},
    "href": "/articles/${slug}",
    "description": ${JSON.stringify(description)},
    "publishedDate": "${today}",
    "lastUpdated": "${today}"
  }

  3. Run: node scripts/generate-article-shells.mjs --check
`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
