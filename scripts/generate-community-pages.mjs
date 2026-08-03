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

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const ASSET_VERSION = '18.3.0';

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
  { href: '/faq', label: 'FAQ' },
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
    .map(src => `    <script src="${src}?v=${ASSET_VERSION}" defer></script>`)
    .join('\n');

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
    <meta name="theme-color" content="#0B8073" />
    <script src="/assets/js/config/canonical-base.js"></script>
    <!--COMMUNITY_HEAD-->
    <link rel="preload" href="/assets/css/tokens.css?v=${ASSET_VERSION}" as="style" />
    <link rel="preload" href="/assets/css/styles.css?v=${ASSET_VERSION}" as="style" />
    <link rel="stylesheet" href="/assets/css/tokens.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/styles.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/eventflow-17.0.0.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/utilities.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/components.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/mobile-optimizations.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/navbar.css?v=${ASSET_VERSION}" />
    <link rel="stylesheet" href="/assets/css/community.css?v=${ASSET_VERSION}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
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

${page.hero || ''}
    <main id="main-content">
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

    <script src="/assets/js/utils/auth-state.js" defer></script>
    <script src="/assets/js/navbar.js" defer></script>
    <script src="/assets/js/cookie-consent.js?v=2.0.0" defer></script>
    <script src="/assets/js/community/core.js?v=${ASSET_VERSION}" defer></script>
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

const homeHero = hero(
  'EventFlow Community',
  'Ask questions, share experiences and get practical advice from people planning events and verified EventFlow suppliers.',
  `<form class="efc-search" role="search" action="/community/search" method="GET">
          <label class="efc-sr-only" for="efc-hero-search">Search the community</label>
          <input id="efc-hero-search" type="search" name="q" placeholder="Search discussions, e.g. marquee hire in Kent" />
          <button type="submit" class="btn btn-primary">Search</button>
        </form>
        <div class="efc-hero__actions">
          <a class="btn btn-primary" href="/community/new">Start a discussion</a>
          <a class="efc-action" href="/community/discussions">Browse all discussions</a>
          <a class="efc-action" href="/community/guidelines">Community guidelines</a>
        </div>`
);

const listBody = `        <div class="efc-section">
          <button type="button" class="efc-action efc-filters-toggle" data-filters-toggle aria-expanded="true" aria-controls="efc-filters">Filters</button>
          <div id="efc-filters-slot"></div>
        </div>
        <div id="efc-results" class="efc-section"></div>`;

const pages = [
  {
    file: 'community.html',
    hero: homeHero,
    body: `        <div id="efc-home" class="efc-section"></div>`,
    scripts: ['/assets/js/community/home.js'],
  },
  {
    file: 'community-discussions.html',
    hero: hero(
      'All discussions',
      'Every discussion in the EventFlow Community. Filter by category, event type, UK region, freshness and whether a question has been answered.',
      '<div class="efc-hero__actions"><a class="btn btn-primary" href="/community/new">Start a discussion</a></div>'
    ),
    body: `        <div id="efc-discussions" data-mode="index">${listBody}</div>`,
    scripts: ['/assets/js/community/discussions.js'],
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
    body: `        <div id="efc-admin" class="efc-section"></div>`,
    scripts: ['/assets/js/community/admin.js'],
  },
];

const guidelines = `        <article class="efc-card efc-section">
          <h1>Community guidelines</h1>
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
            <li>Sexual content, gambling, illegal goods and anything unlawful.</li>
            <li>Other people's personal information, including photographs of guests who have not agreed.</li>
            <li>Impersonating EventFlow staff, a supplier or another member.</li>
          </ul>

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
          <p>We hide, remove, lock or archive content that breaks these guidelines, and we tell the
            author what happened. We do not use silent shadow bans. Every decision can be
            <a href="/community/help#appeals">appealed</a>.</p>
          <p>See also our <a href="/terms">Terms</a>, <a href="/privacy">Privacy notice</a> and
            <a href="/legal">Legal hub</a>.</p>
        </article>`;

const help = `        <article class="efc-card efc-section">
          <h1>Community help</h1>

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
 * Write every generated page to the public directory.
 * @returns {Promise<void>} Resolves when all files are written.
 */
async function main() {
  await Promise.all(
    pages.map(page => writeFile(path.join(publicDir, page.file), shell(page), 'utf8'))
  );
  process.stdout.write(`Generated ${pages.length} community pages\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
