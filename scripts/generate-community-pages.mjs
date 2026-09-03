#!/usr/bin/env node
/**
 * Generates the EventFlow Community HTML shells.
 *
 * Every community page shares the same head, navigation, footer and
 * accessibility scaffolding, so they are generated from one template rather
 * than copied by hand and left to drift. The generated files are committed;
 * re-run this script after changing the template and commit the result.
 *
 * Usage: node scripts/generate-community-pages.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const ASSET_VERSION = '18.3.0';

// Assets that have moved on independently of the shared version. Cache-busting
// is per file, so pinning them here keeps a regeneration from silently reverting
// a bumped query string back to the shared version and serving a stale asset.
const ASSET_VERSIONS = {
  '/assets/css/styles.css': '18.5.0',
  '/assets/css/mobile-optimizations.css': '18.4.4',
  // 18.4.1: PR #1551 restored the `.pack`/`.featured-fallback-card` homepage
  // carousel rules removed by #1543 — bumped alongside that PR's other
  // cache-busting fixes so a cached copy of components.css doesn't linger.
  '/assets/css/components.css': '18.4.1',
  // 18.6.0: the glass surface tokens, the sidebar and rail layout fixes, the
  // hero tint that repairs its contrast, the category strip's scroll buttons,
  // the four-way reactions and the metadata separator rules all ship together.
  // Static CSS/JS is served `public, max-age=604800`, so a returning visitor
  // holds the previous copy for up to a week: without a new query string they
  // would keep the old stylesheet against this markup and see, for example,
  // the strip's scroll buttons with none of the styling that positions them.
  // 18.6.1: the category strip's native scrollbar is hidden now that the
  // scroll buttons and edge scrim already carry that affordance; without a
  // bump a returning visitor keeps last week's cached copy, which still
  // shows both.
  '/assets/css/community.css': '18.6.1',
  // 18.4.1: the mobile burger menu's padding, link height, gap and divider
  // were tightened and the CTA/login row was fixed to actually be compact
  // (PR #1605). Without a bump a returning visitor keeps the previous
  // week-cached copy against the new markup, producing mismatched button
  // heights in the burger menu.
  '/assets/css/navbar.css': '18.4.1',
  '/assets/js/community/core.js': '18.6.0',
  '/assets/js/community/home.js': '18.6.0',
  '/assets/js/community/thread.js': '18.6.0',
  '/assets/js/community/member.js': '18.6.0',
  '/assets/js/community/composer.js': '18.5.2',
};

/**
 * Version query for an asset path.
 * @param {string} assetPath Absolute asset path.
 * @returns {string} The version to use in the cache-busting query.
 */
function version(assetPath) {
  return ASSET_VERSIONS[assetPath] || ASSET_VERSION;
}

const NAV_LINKS = [
  { href: '/start', label: 'Plan' },
  { href: '/suppliers', label: 'Suppliers' },
  { href: '/public-calendar', label: 'Events' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/community', label: 'Community' },
  { href: '/guides', label: 'Guides' },
];

const MOBILE_LINKS = [
  { href: '/start', label: 'Plan an Event' },
  { href: '/suppliers', label: 'Browse Suppliers' },
  { href: '/public-calendar', label: 'Events Calendar' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/community', label: 'Community' },
  { href: '/guides', label: 'Guides' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/for-suppliers', label: 'For Suppliers' },
  { href: '/faq', label: 'Help &amp; FAQ' },
];

/**
 * Build the shared page shell.
 * @param {Object} page Page definition.
 * @returns {string} Complete HTML document.
 */
function shell(page) {
  const desktopNav = NAV_LINKS.map(
    link =>
      `            <a href="${link.href}" class="ef-nav-link${
        link.href === '/community' ? ' ef-nav-link--active' : ''
      }">${link.label}</a>`
  ).join('\n');

  const mobileNav = MOBILE_LINKS.map(
    link => `          <a href="${link.href}" class="ef-mobile-link">${link.label}</a>`
  ).join('\n');

  const scripts = (page.scripts || [])
    .map(src => `    <script src="${src}?v=${version(src)}" defer></script>`)
    .join('\n');

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
    <meta name="theme-color" content="#0B8073" />
    <script src="/assets/js/config/canonical-base.js"></script>
${page.adminGuard ? '    <script src="/assets/js/dashboard-guard.js?v=17.0.2"></script>\n' : ''}    <!--COMMUNITY_HEAD-->
    <link rel="preload" href="/assets/css/tokens.css?v=${version('/assets/css/tokens.css')}" as="style" />
    <link rel="preload" href="/assets/css/styles.css?v=${version('/assets/css/styles.css')}" as="style" />
    <link rel="stylesheet" href="/assets/css/tokens.css?v=${version('/assets/css/tokens.css')}" />
    <link rel="stylesheet" href="/assets/css/styles.css?v=${version('/assets/css/styles.css')}" />
    <link rel="stylesheet" href="/assets/css/eventflow-17.0.0.css?v=${version('/assets/css/eventflow-17.0.0.css')}" />
    <link rel="stylesheet" href="/assets/css/utilities.css?v=${version('/assets/css/utilities.css')}" />
    <link rel="stylesheet" href="/assets/css/components.css?v=${version('/assets/css/components.css')}" />
    <link rel="stylesheet" href="/assets/css/mobile-optimizations.css?v=${version('/assets/css/mobile-optimizations.css')}" />
    <link rel="stylesheet" href="/assets/css/navbar.css?v=${version('/assets/css/navbar.css')}" />
    <link rel="stylesheet" href="/assets/css/eventflow-brand.css?v=1.0.1" data-eventflow-brand="true" />
    <link rel="stylesheet" href="/assets/css/community.css?v=${version('/assets/css/community.css')}" />
${page.adminGuard ? '' : '    <link rel="stylesheet" href="/assets/css/eventflow-footer.css" />\n'}    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="144x144" href="/favicon-144x144.png" />
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#0B8073" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="msapplication-config" content="/browserconfig.xml" />
  </head>
  <body class="efc">
    <a class="efc-skip" href="#main-content">Skip to main content</a>

    <header class="ef-header" role="banner">
      <div class="ef-container">
        <div class="ef-header-content">
          <a href="/" class="ef-brand" aria-label="EventFlow - Return to homepage">
            <div class="ef-logo" aria-hidden="true"><div class="ef-logo-inner"></div></div>
            <span class="ef-brand-text">EventFlow</span>
          </a>
          <nav class="ef-nav-desktop" aria-label="Main navigation">
${desktopNav}
          </nav>
          <div class="ef-header-actions">
            <button id="ef-notification-btn" class="ef-icon-btn" type="button" aria-label="View notifications" style="display:none;">
              <svg class="ef-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span id="ef-notification-badge" class="ef-badge" style="display:none;"></span>
            </button>
            <a href="/auth" id="ef-auth-link" class="ef-btn ef-btn-primary">Log in</a>
            <a href="#" id="ef-dashboard-link" class="ef-nav-link" style="display:none;">Dashboard</a>
            <button id="ef-mobile-toggle" class="ef-mobile-toggle" type="button" aria-label="Toggle menu" aria-expanded="false" aria-controls="ef-mobile-menu">
              <span class="ef-toggle-line"></span>
              <span class="ef-toggle-line"></span>
              <span class="ef-toggle-line"></span>
            </button>
          </div>
        </div>
      </div>
      <div id="ef-mobile-menu" class="ef-mobile-menu" role="dialog" aria-modal="true" aria-label="Mobile navigation">
        <nav class="ef-mobile-nav" aria-label="Primary navigation">
${mobileNav}
          <div class="ef-mobile-divider"></div>
          <a href="/auth" id="ef-mobile-auth" class="ef-mobile-link ef-mobile-primary">Log in</a>
          <a href="#" id="ef-mobile-dashboard" class="ef-mobile-link" style="display:none;">Dashboard</a>
          <a href="#" id="ef-mobile-logout" class="ef-mobile-link" style="display:none;">Log out</a>
        </nav>
      </div>
    </header>

    <main id="main-content">
${page.hero || ''}
      <div class="efc-shell">
        <!-- Server-rendered content. Real, indexable HTML that works without
             JavaScript; the client scripts hide it once they have data. -->
        <div id="efc-noscript"><!--COMMUNITY_CONTENT--></div>
${page.body}
      </div>
    </main>

    <footer class="footer" role="contentinfo">
      <div class="container ef-footer-content">
        <div><strong>EventFlow</strong><br /><span class="small">Event planning made simple.</span></div>
        <div class="small">
          <a href="/community">Community</a> · <a href="/community/guidelines">Community guidelines</a> ·
          <a href="/guides">Guides</a> · <a href="/marketplace">Marketplace</a> ·
          <a href="/public-calendar">Events Calendar</a> · <a href="/suppliers">Suppliers</a> ·
          <a href="/legal">Legal Hub</a> ·
          <button type="button" data-cookie-prefs>Cookie preferences</button>
        </div>
      </div>
    </footer>

${
  page.adminGuard
    ? ''
    : `    <nav class="ef-bottom-nav" role="navigation" aria-label="Mobile bottom navigation">
      <a href="/start" class="ef-bottom-link" aria-label="Plan your event">
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span class="ef-bottom-label">Plan</span>
      </a>

      <a href="/suppliers" class="ef-bottom-link" aria-label="Browse suppliers">
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <span class="ef-bottom-label">Suppliers</span>
      </a>

      <a href="/guides" class="ef-bottom-link" aria-label="View guides">
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <span class="ef-bottom-label">Guides</span>
      </a>

      <!-- Dashboard with notification badge (shown when logged in, replaces Alerts) -->
      <a href="#" id="ef-bottom-dashboard" class="ef-bottom-link" style="display: none;" aria-label="Go to dashboard">
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span class="ef-bottom-label">Dashboard</span>
        <span id="ef-bottom-dashboard-badge" class="ef-badge" style="display: none;"></span>
      </a>

      <!-- Alerts button (shown when logged out) -->
      <a href="/guides" id="ef-bottom-alerts" class="ef-bottom-link" aria-label="View guides and alerts">
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="ef-bottom-label">Alerts</span>
      </a>

      <button
        id="ef-bottom-menu"
        class="ef-cta ef-bottom-link"
        type="button"
        aria-label="Open menu"
        aria-expanded="false"
        aria-controls="ef-mobile-menu"
      >
        <svg class="ef-bottom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </nav>

    <script src="/assets/js/components/eventflow-footer.js?v=4" defer></script>
`
}    <script src="/assets/js/utils/auth-state.js" defer></script>
    <script src="/assets/js/burger-menu.js" defer></script>
    <script src="/assets/js/navbar.js" defer></script>
    <script src="/assets/js/cookie-consent.js?v=2.0.1" defer></script>
    <script src="/assets/js/community/core.js?v=${version('/assets/js/community/core.js')}" defer></script>
${scripts}
  </body>
</html>
`;
}

const hero = (title, lead, actions = '') => `    <section class="efc-hero">
      <div class="efc-hero__inner">
        <h1>${title}</h1>
        <p>${lead}</p>
        ${actions}
      </div>
    </section>

`;

// The community home page does not use the shared `hero()` band. Its hero is a
// composed stage — a floating card between two preview rails, over a decorative
// background — and it is reproduced here verbatim so that regenerating the
// shells cannot quietly revert it to the old band.
const homeHero = `    <section class="efc-stage">
      <!-- Decoration only: soft brand blobs and the dashed lines that run from
           the hero out to the preview rails. Hidden from assistive technology
           and suppressed entirely under prefers-reduced-motion. -->
      <div class="efc-stage__decor" aria-hidden="true">
        <span class="efc-blob efc-blob--a"></span>
        <span class="efc-blob efc-blob--b"></span>
        <span class="efc-blob efc-blob--c"></span>
        <svg class="efc-threads" viewBox="0 0 1440 620" preserveAspectRatio="none" focusable="false">
          <path d="M416 235C386 275 386 330 416 372" />
          <path d="M416 350C390 400 396 452 424 492" />
          <path d="M1024 235C1054 275 1054 330 1024 372" />
          <path d="M1024 350C1050 400 1044 452 1016 492" />
        </svg>
      </div>

      <!-- The hero card comes first in the document even though it sits between
           the two rails on a wide screen. The rails are secondary navigation;
           making a keyboard or screen-reader user pass three preview cards
           before reaching the h1 and the search field would be worse than the
           mild visual/focus-order deviation this creates on desktop. -->
      <div class="efc-stage__inner">
        <div class="efc-stage__card">
          <span class="efc-stage__badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">
              <path d="M17 12a5 5 0 0 1-5 5H8l-4 3v-4.6A5 5 0 0 1 3 12V9a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5Z" />
              <path d="M20 8a4 4 0 0 1 1 2.6V14a4 4 0 0 1-2 3.4" />
            </svg>
          </span>
          <h1>EventFlow Community</h1>
          <p>Ask questions, share experiences and get practical advice from people planning events and trusted EventFlow suppliers.</p>
          <form class="efc-stage__search" role="search" action="/community/search" method="GET">
            <label class="efc-sr-only" for="efc-hero-search">Search the community</label>
            <input id="efc-hero-search" type="search" name="q" placeholder="Search discussions, ideas or suppliers" />
            <button type="submit" class="efc-searchbtn" aria-label="Search discussions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          </form>
          <div class="efc-stage__actions">
            <a class="efc-cta efc-cta--solid" href="/community/new">Start a discussion</a>
            <a class="efc-cta efc-cta--ghost" href="/community/discussions">Browse discussions</a>
          </div>
        </div>

        <nav class="efc-rail efc-rail--left" aria-label="Recent discussions">
          <ul class="efc-rail__list" id="efc-rail-left"></ul>
        </nav>

        <nav class="efc-rail efc-rail--right" aria-label="Popular discussions">
          <ul class="efc-rail__list" id="efc-rail-right"></ul>
        </nav>
      </div>

      <div class="efc-catstrip" id="efc-catstrip" hidden></div>

      <p class="efc-joinbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
          <circle cx="10" cy="8" r="3.2" />
          <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.6 5.2a3.2 3.2 0 0 1 0 5.6" />
        </svg>
        <span>Join thousands of event planners and suppliers sharing ideas every day.</span>
        <a class="efc-joinbar__link" href="/community/guidelines">How it works</a>
      </p>
    </section>

`;

// The filter panel and its mobile toggle are rendered together by
// community/discussions.js, so aria-controls never points at an element that
// has not been created yet.
// Each result is an h3, so the list needs an h2 above it or a screen-reader
// user jumping by heading falls from the page title straight to a card.
const listBody = `        <div id="efc-filters-slot" class="efc-section"></div>
        <section class="efc-section" aria-labelledby="efc-results-heading">
          <h2 id="efc-results-heading" class="efc-sr-only">Discussions</h2>
          <div id="efc-results"></div>
        </section>`;

const pages = [
  {
    file: 'community.html',
    hero: homeHero,
    body: `        <div id="efc-home" class="efc-section"></div>`,
    // The composer is loaded here as well so "Start a discussion" can open as a
    // modal over the page. It is an enhancement: without it the link still goes
    // to /community/new.
    scripts: ['/assets/js/community/home.js', '/assets/js/community/composer.js'],
  },
  {
    file: 'community-discussions.html',
    hero: hero(
      'All discussions',
      'Every discussion in the EventFlow Community. Filter by category, event type, UK region, freshness and whether a question has been answered.',
      '<div class="efc-hero__actions"><a class="btn btn-primary" href="/community/new">Start a discussion</a></div>'
    ),
    body: `        <div id="efc-discussions" data-mode="index">${listBody}</div>`,
    scripts: ['/assets/js/community/discussions.js', '/assets/js/community/composer.js'],
  },
  {
    file: 'community-category.html',
    body: `        <div id="efc-discussions" data-mode="category">
          <div id="efc-category-header" class="efc-section"></div>
${listBody}
        </div>`,
    scripts: ['/assets/js/community/discussions.js'],
  },
  {
    file: 'community-search.html',
    hero: hero(
      'Search the community',
      'Search titles, original posts, replies and tags. Current advice is ranked above equally relevant answers from years ago.',
      `<form class="efc-search" role="search" action="/community/search" method="GET">
          <label class="efc-sr-only" for="efc-search-input">Search the community</label>
          <input id="efc-search-input" type="search" name="q" placeholder="What do you need help with?" />
          <button type="submit" class="btn btn-primary">Search</button>
        </form>`
    ),
    body: `        <div id="efc-discussions" data-mode="search">${listBody}</div>`,
    scripts: ['/assets/js/community/discussions.js'],
  },
  {
    file: 'community-discussion.html',
    body: `        <div id="efc-thread" class="efc-section"></div>`,
    scripts: ['/assets/js/community/thread.js'],
  },
  {
    file: 'community-new.html',
    body: `        <div id="efc-composer" class="efc-section"></div>`,
    scripts: ['/assets/js/community/composer.js'],
  },
  {
    file: 'community-member.html',
    body: `        <div id="efc-member" class="efc-section"></div>`,
    scripts: ['/assets/js/community/member.js'],
  },
  {
    file: 'community-saved.html',
    body: `        <div id="efc-saved" class="efc-section"></div>`,
    scripts: ['/assets/js/community/member.js'],
  },
  {
    file: 'community-following.html',
    body: `        <div id="efc-following" class="efc-section"></div>`,
    scripts: ['/assets/js/community/member.js'],
  },
  {
    file: 'admin-community.html',
    // The admin page carries the shared admin guard, like every other
    // admin-*.html file, so an unauthenticated request never sees the shell.
    adminGuard: true,
    body: `        <div id="efc-admin" class="efc-section"></div>`,
    scripts: ['/assets/js/community/admin.js'],
  },
];

const guidelines = `        <article class="efc-card efc-section">
          <h1>Community guidelines</h1>
          <p class="small"><strong>Last materially updated:</strong>
            {{POLICY_COMMUNITY_GUIDELINES_LAST_UPDATED}} · <strong>Last reviewed:</strong>
            {{POLICY_COMMUNITY_GUIDELINES_LAST_REVIEWED}} · <strong>Version:</strong>
            {{POLICY_COMMUNITY_GUIDELINES_VERSION}}</p>
          <p>The EventFlow Community is for people planning events and the suppliers who work on
            them. These guidelines apply to every discussion, reply and profile.</p>

          <h2>What we expect</h2>
          <ul>
            <li>Be useful. Answer the question that was actually asked.</li>
            <li>Be kind. Disagree with the advice, not the person.</li>
            <li>Be honest about who you are, especially if you have a commercial interest.</li>
            <li>Keep it relevant to planning, running or recovering from an event.</li>
          </ul>

          <h2>What is not allowed</h2>
          <ul>
            <li>Spam, drive-by promotion, SEO link-dropping and affiliate spam.</li>
            <li>Harassment, hate, threats and content that targets a person.</li>
            <li>Sexual or exploitative content, illegal goods, instructions for serious wrongdoing
              and anything else unlawful.</li>
            <li>Other people's personal information, including photographs of guests who have not agreed.</li>
            <li>Impersonating EventFlow staff, a supplier or another member.</li>
            <li>Copyright-infringing content, malware, scams, manipulated engagement or malicious
              false reports.</li>
          </ul>

          <h2>Public posts and your rights</h2>
          <p>Published profiles, discussions and replies are public and may appear in EventFlow
            search and external search engines. Do not post confidential information, private
            messages, exact addresses, guest details or somebody else's personal data without their
            permission.</p>
          <p>You keep ownership of content you create. By posting it, you give EventFlow the limited
            licence described in our <a href="/terms">Terms</a> so we can host, display, search,
            format and moderate it. You can edit or withdraw your own content. A withdrawn post may
            leave a labelled placeholder so the surrounding conversation remains understandable,
            and limited copies may be retained for safety, appeals, legal compliance or backups as
            explained in our <a href="/privacy">Privacy notice</a>.</p>

          <h2>Supplier code of conduct</h2>
          <p>Approved EventFlow suppliers are welcome and their badge is based only on facts we can
            verify: that the account is an approved supplier, and whether its email and phone are
            verified. A supplier badge is <strong>not</strong> a statement about insurance,
            qualifications, vetting or identity checks.</p>
          <ul>
            <li>If you recommend your own business, say so. We label it automatically where we can.</li>
            <li>Do not post in unrelated threads to advertise.</li>
            <li>Do not collect leads privately from people who posted publicly.</li>
            <li>Answer as an expert first and a business second.</li>
          </ul>

          <h2>Older discussions</h2>
          <p>Discussions are labelled with their age. Once a discussion has been quiet for a long
            time we hold new links from newer accounts for review, and eventually archive the thread
            so people start a fresh one instead. This keeps out-of-date prices and availability from
            being read as current.</p>

          <h2>Age</h2>
          <p>EventFlow is an 18+ service and you must confirm you are 18 or over before posting.</p>

          <h2>Moderation</h2>
          <p>Automated safety and anti-spam checks may reject a blocked link or hold a post for a
            person to review. A hold is not a final decision and the author can see that the post is
            awaiting review. We do not use silent shadow bans.</p>
          <p>Depending on the circumstances, we may warn a member, restrict links or posting, hide,
            redact, remove, lock or archive content, or suspend an account. We normally tell the
            affected member what happened and why. Eligible decisions can be
            <a href="/community/help#appeals">appealed</a>.</p>

          <h2>Reporting content</h2>
          <p>Use the report control on a discussion or reply if it may break these guidelines. You
            can report suspected illegal content through the
            <a href="/legal#illegal-content">Legal Hub</a>, including without a Community account.
            Reports should be made in good faith. The reporter is told the outcome where the product
            supports it, but not confidential details about action taken against another member.</p>
          <p>See also our <a href="/terms">Terms</a>, <a href="/privacy">Privacy notice</a> and
            <a href="/legal">Legal hub</a>.</p>
        </article>`;

const help = `        <article class="efc-card efc-section">
          <h1>Community help</h1>
          <p class="small"><strong>Last materially updated:</strong>
            {{POLICY_COMMUNITY_HELP_LAST_UPDATED}} · <strong>Last reviewed:</strong>
            {{POLICY_COMMUNITY_HELP_LAST_REVIEWED}} · <strong>Version:</strong>
            {{POLICY_COMMUNITY_HELP_VERSION}}</p>

          <h2 id="reporting">Reporting content</h2>
          <p>Every discussion and reply has a <strong>Report</strong> button. Choose the closest
            reason and add anything we should know. Reports are confidential and we tell you the
            outcome.</p>
          <p>Reports about child safety, terrorism, threats of violence, encouraging serious
            self-harm, illegal goods and underage users are escalated immediately and the content is
            hidden while a senior moderator reviews it.</p>
          <p>If you believe content is illegal, you can also use the
            <a href="/legal">report illegal content</a> route, which reaches us whether or not you
            have an EventFlow account.</p>

          <h2 id="spam">Reporting a spam account</h2>
          <p>If an account has posted the same promotion across several threads, report one post and
            tick the option to report the whole series. You do not need to report each post
            individually.</p>

          <h2 id="official">Official answers</h2>
          <p>An <strong>Official EventFlow answer</strong> comes from our team and carries the date
            it was last verified. A <strong>Helpful answer</strong> is chosen by the person who asked
            the question. They are deliberately different things: one is authoritative about the
            platform, the other is what actually solved someone's problem.</p>

          <h2 id="appeals">Appealing a decision</h2>
          <p>If we hide, remove or restrict something of yours, you will receive a notification
            explaining what happened. You can appeal from that notification or by emailing our
            support team. A senior moderator who was not involved in the original decision reviews
            every appeal, and we tell you the outcome and the reason.</p>

          <h2 id="privacy">Your privacy</h2>
          <p>Your community profile shows only what you choose to publish: a public handle, an
            optional biography, an optional broad UK region and an optional event type. Your email
            address, phone number, exact address, date of birth, private plans, calendar and
            messages are never shown in the community.</p>
          <p>You can download everything you have posted from your account, and you can mute members,
            categories and discussions at any time.</p>
        </article>`;

pages.push(
  { file: 'community-guidelines.html', body: guidelines, scripts: [] },
  { file: 'community-help.html', body: help, scripts: [] }
);

/**
 * Compare the generated output against what is committed, without writing.
 *
 * The committed shells are edited by hand more often than this script is run,
 * and a template that has fallen behind them does not fail loudly — it quietly
 * reverts the newer markup the next time someone regenerates. `--check` makes
 * that drift a test failure instead of a surprise.
 *
 * @returns {Promise<string[]>} Files whose committed contents differ.
 */
async function drift() {
  const stale = [];
  await Promise.all(
    pages.map(async page => {
      const committed = await readFile(path.join(publicDir, page.file), 'utf8').catch(() => null);
      if (committed !== shell(page)) {
        stale.push(page.file);
      }
    })
  );
  return stale.sort();
}

/**
 * Write every generated page to the public directory, or report drift when
 * called with `--check`.
 * @returns {Promise<void>} Resolves when finished.
 */
async function main() {
  if (process.argv.includes('--check')) {
    const stale = await drift();
    if (stale.length) {
      process.stderr.write(
        `The committed shells differ from this template:\n  ${stale.join('\n  ')}\n` +
          'Either re-run this script and commit the result, or update the template to match.\n'
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`All ${pages.length} community pages match the template\n`);
    return;
  }

  await Promise.all(
    pages.map(page => writeFile(path.join(publicDir, page.file), shell(page), 'utf8'))
  );
  process.stdout.write(`Generated ${pages.length} community pages\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
