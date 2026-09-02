/**
 * Template Renderer Middleware
 * Replaces placeholders in HTML files with dynamic content from content-config
 */

'use strict';

const path = require('path');
const logger = require('./logger');
const fs = require('fs').promises;
const { getPlaceholders } = require('../config/content-config');
const { getActiveHomepageVersion, normaliseHomepageVersion } = require('./homepage-manager');
const { renderArticleDates } = require('../services/articleMetadata.service');

const templateCache = new Map();
const ANONYMOUS_SANITIZER_COMMENT = '<!-- eventflow-anonymous-sanitizer: active -->';
const GLOBAL_ANALYTICS_SCRIPTS = [
  '    <script src="/assets/js/cookie-consent.js?v=2.1.1" defer></script>',
  '    <script src="/assets/js/analytics-consent-upgrade.js?v=4" defer></script>',
  '    <script src="/assets/js/behaviour-analytics.js?v=3" defer></script>',
];
const ADMIN_BEHAVIOUR_ANALYTICS_SCRIPT =
  '    <script src="/assets/js/pages/admin-behaviour-analytics.js?v=1" defer></script>';
const GOOGLE_ADS_TAG_SCRIPT = '    <script src="/assets/js/google-ads-tag.js"></script>';
// Token-bearing routes: loading a third-party script here would send the
// current URL (including the verification/reset token) to Google via the
// Referer header, even for a visitor who has already consented to analytics.
const GOOGLE_ADS_TAG_BLOCKED_PATHS = new Set(['/verify.html', '/reset-password.html']);
const HOMEPAGE_INDEX_FILE = '/index.html';
const HOMEPAGE_V2_FILE = '/home-v2.html';
const HOMEPAGE_V2_PREVIEW_PATHS = new Set([
  '/home-v2',
  '/home-v2.html',
  '/home-v2-preview',
  '/home-v2-preview.html',
]);
const HOMEPAGE_V3_PREVIEW_PATHS = new Set([
  '/home-v3',
  '/home-v3.html',
  '/home-v3-preview',
  '/home-v3-preview.html',
]);
const HOMEPAGE_V2_NAVBAR_PARITY_STYLES = [
  '    <link rel="preload" href="/assets/css/home-v2-navbar-parity.css?v=3" as="style" />',
  '    <link rel="stylesheet" href="/assets/css/home-v2-navbar-parity.css?v=3" />',
].join('\n');
const HOMEPAGE_V2_NAVBAR_PARITY_SCRIPT =
  '    <script src="/assets/js/pages/home-v2-navbar-parity.js?v=1" defer></script>';
const HOMEPAGE_V3_HERO_STYLES = [
  '    <link rel="preconnect" href="https://videos.pexels.com" crossorigin />',
  '    <link rel="preload" href="/assets/css/home-v2.css?v=11" as="style" />',
  '    <link rel="preload" href="/assets/css/home-v3.css?v=15" as="style" />',
  '    <link rel="preload" href="/assets/css/home-v3-video.css?v=2" as="style" />',
  '    <link rel="stylesheet" href="/assets/css/home-v2.css?v=11" />',
  '    <link rel="stylesheet" href="/assets/css/home-v3.css?v=15" />',
  '    <link rel="stylesheet" href="/assets/css/home-v3-video.css?v=2" />',
  '    <link rel="preload" href="/assets/css/home-v3-mobile.css?v=10" as="style" media="(max-width: 960px)" />',
  '    <link rel="stylesheet" href="/assets/css/home-v3-mobile.css?v=10" media="(max-width: 960px)" />',
  '    <script src="/assets/js/pages/home-v3.js?v=13"></script>',
].join('\n');
const HOMEPAGE_V3_HERO_SCRIPT =
  '    <script src="/assets/js/pages/home-v3-video.js?v=5" defer></script>';
const HOMEPAGE_V3_HERO = `      <section class="hv2-hero" aria-labelledby="hv3-title">
        <div class="hv2-hero__image hv3-hero-video" aria-hidden="true" data-hv3-pexels-video>
          <video
            class="hv3-hero-video__media"
            muted
            loop
            playsinline
            preload="none"
            poster="/assets/images/hero-video-poster.jpg"
            width="1280"
            height="854"
            data-hv3-video-media
          >
            <source type="video/mp4" data-hv3-video-source />
          </video>
        </div>
        <div class="hv2-hero__shade" aria-hidden="true"></div>

        <div class="hv2-shell hv2-hero__content">
          <div class="hv2-hero__copy">
            <h1 id="hv3-title">
              <span class="hv3-title-line">Plan your event</span>
              <br class="hv3-title-break" />
              <span class="hv3-title-emphasis">in one place<span class="hv3-title-underline" aria-hidden="true"></span></span>
            </h1>
            <p class="hv2-hero__lead">
              Find venues, suppliers and packages, then keep your budget, messages and checklist
              together.
            </p>

            <form class="hv2-search" action="/suppliers" method="GET" aria-label="Search suppliers">
              <input type="hidden" name="category" id="hv2-category" />

              <div class="hv2-search__field hv2-search__field--select" role="group" aria-labelledby="hv3-event-type-label">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="15" rx="2"></rect>
                  <path d="M8 3v4M16 3v4M4 10h16"></path>
                </svg>
                <span>
                  <strong id="hv3-event-type-label">Event type</strong>
                  <input type="hidden" name="eventType" id="hv2-event-type" />
                  <span class="hv3-select" data-hv3-event-select>
                    <button
                      class="hv3-select__button"
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded="false"
                      aria-controls="hv3-event-type-menu"
                      data-hv3-select-button
                    >
                      <span data-hv3-event-label>e.g. Wedding</span>
                    </button>
                    <ul class="hv3-select__menu" id="hv3-event-type-menu" role="listbox" hidden data-hv3-select-menu>
                      <li role="presentation">
                        <button class="hv3-select__option" type="button" role="option" data-value="wedding" data-hv3-event-option>Wedding</button>
                      </li>
                      <li role="presentation">
                        <button class="hv3-select__option" type="button" role="option" data-value="corporate" data-hv3-event-option>Corporate</button>
                      </li>
                      <li role="presentation">
                        <button class="hv3-select__option" type="button" role="option" data-value="party" data-hv3-event-option>Party</button>
                      </li>
                      <li role="presentation">
                        <button class="hv3-select__option" type="button" role="option" data-value="celebration" data-hv3-event-option>Celebration</button>
                      </li>
                    </ul>
                  </span>
                </span>
              </div>

              <label class="hv2-search__field">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"></path>
                  <circle cx="12" cy="9" r="2.5"></circle>
                </svg>
                <span>
                  <strong>Location</strong>
                  <input
                    id="hv2-location"
                    name="location"
                    type="search"
                    placeholder="e.g. London"
                    autocomplete="postal-code"
                  />
                </span>
              </label>

              <label class="hv2-search__field hv2-search__field--wide">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"></circle>
                  <path d="m16.5 16.5 4 4"></path>
                </svg>
                <span>
                  <strong>Supplier or keyword</strong>
                  <input id="hv2-keyword" name="q" type="search" placeholder="e.g. Photographer" />
                </span>
              </label>

              <button class="hv2-search__button" type="submit">Search suppliers</button>

              <div class="hv2-popular" aria-label="Popular searches">
                <span>Popular searches:</span>
                <button type="button" data-category="Venues" data-location="London">London venues</button>
                <button type="button" data-category="Photography">Wedding photographers</button>
                <button type="button" data-category="Catering">Corporate catering</button>
                <button type="button" data-category="Music/DJ">DJs near me</button>
              </div>
            </form>
          </div>
        </div>
      </section>`;
const HOMEPAGE_DIRTY_COPY = {
  supplierClaim: ['All suppliers are verified', ' and vetted'].join(''),
  testimonialsHeading: ['What Our Customers', ' Say'].join(''),
  james: ['James', ' Wilson'].join(''),
  emma: ['Emma', ' Davies'].join(''),
};

function isCachingEnabled() {
  return process.env.NODE_ENV === 'production';
}

function replacePlaceholders(content) {
  const placeholders = getPlaceholders();
  let result = content;

  for (const [key, value] of Object.entries(placeholders)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value);
  }

  return result;
}

function isAnonymousRequest(req) {
  return !(req && req.user);
}

function setHtmlNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function appendVaryHeader(res, value) {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', value);
    return;
  }
  const values = String(existing)
    .split(',')
    .map(item => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    res.setHeader('Vary', `${existing}, ${value}`);
  }
}

function addAnonymousSanitizerMarker(content) {
  if (content.includes(ANONYMOUS_SANITIZER_COMMENT)) {
    return content;
  }
  if (/<body\b[^>]*>/i.test(content)) {
    return content.replace(/(<body\b[^>]*>)/i, `$1\n${ANONYMOUS_SANITIZER_COMMENT}`);
  }
  return `${ANONYMOUS_SANITIZER_COMMENT}\n${content}`;
}

function addBodyClass(content, className) {
  if (new RegExp(`<body\\b[^>]*class=["'][^"']*\\b${className}\\b`, 'i').test(content)) {
    return content;
  }

  if (/<body\b[^>]*class=["'][^"']*["'][^>]*>/i.test(content)) {
    return content.replace(
      /(<body\b[^>]*class=["'])([^"']*)(["'][^>]*>)/i,
      `$1$2 ${className}$3`
    );
  }

  return content.replace(/<body\b/i, `<body class="${className}"`);
}

function injectHeadSnippet(content, snippet, marker) {
  if (!/<\/head>/i.test(content) || (marker && content.includes(marker))) {
    return content;
  }
  return content.replace(/\s*<\/head>/i, `\n${snippet}\n</head>`);
}

function injectBodySnippet(content, snippet, marker) {
  if (!/<\/body>/i.test(content) || (marker && content.includes(marker))) {
    return content;
  }
  return content.replace(/\s*<\/body>/i, `\n${snippet}\n</body>`);
}

function injectGlobalAnalyticsScripts(content, requestPath) {
  const pathName = String(requestPath || '');
  const isAdmin = pathName === '/admin.html' || pathName.startsWith('/admin-');
  let result = content;

  if (!isAdmin) {
    result = injectBodySnippet(
      result,
      GLOBAL_ANALYTICS_SCRIPTS[0],
      '/assets/js/cookie-consent.js'
    );
    result = injectBodySnippet(
      result,
      GLOBAL_ANALYTICS_SCRIPTS[1],
      '/assets/js/analytics-consent-upgrade.js'
    );
    result = injectBodySnippet(
      result,
      GLOBAL_ANALYTICS_SCRIPTS[2],
      '/assets/js/behaviour-analytics.js'
    );
  }

  if (pathName === '/admin-analytics.html') {
    result = injectBodySnippet(
      result,
      ADMIN_BEHAVIOUR_ANALYTICS_SCRIPT,
      '/assets/js/pages/admin-behaviour-analytics.js'
    );
  }

  if (!isAdmin && !GOOGLE_ADS_TAG_BLOCKED_PATHS.has(pathName)) {
    result = injectBodySnippet(result, GOOGLE_ADS_TAG_SCRIPT, '/assets/js/google-ads-tag.js');
  }

  return result;
}

function injectBeforeHeadClose(content, snippet) {
  if (!/<\/head>/i.test(content) || content.includes('/assets/css/home-v3.css')) {
    return content;
  }

  return content.replace(/\s*<\/head>/i, `\n${snippet}\n</head>`);
}

function injectBeforeBodyClose(content, snippet) {
  if (!/<\/body>/i.test(content) || content.includes('/assets/js/pages/home-v3-video.js')) {
    return content;
  }

  return content.replace(/\s*<\/body>/i, `\n${snippet}\n</body>`);
}

function replaceHomepageHeroWithV3(content) {
  const heroPattern =
    /\s*<section\s+class=["']hero hero-modern["'][^>]*>[\s\S]*?<\/section>\s*(?=<!-- Noscript fallback for hero CTAs -->|<noscript>)/i;

  if (!heroPattern.test(content)) {
    return content;
  }

  return content.replace(heroPattern, `\n${HOMEPAGE_V3_HERO}\n\n`);
}

function stripHomepageV3InheritedScripts(content) {
  return content.replace(
    /\s*<script src="\/assets\/js\/utils\/pexels-client\.js" defer><\/script>/i,
    ''
  );
}

function buildHomepageV3Preview(content) {
  let result = addBodyClass(content, 'home-v3-page');
  result = stripHomepageV3InheritedScripts(result);
  result = injectBeforeHeadClose(result, HOMEPAGE_V3_HERO_STYLES);
  result = replaceHomepageHeroWithV3(result);
  result = injectBeforeBodyClose(result, HOMEPAGE_V3_HERO_SCRIPT);
  return result;
}

function buildHomepageV2Preview(content) {
  let result = addBodyClass(content, 'home-v2-white-fade-page');
  result = injectHeadSnippet(
    result,
    HOMEPAGE_V2_NAVBAR_PARITY_STYLES,
    '/assets/css/home-v2-navbar-parity.css'
  );
  result = injectBodySnippet(
    result,
    HOMEPAGE_V2_NAVBAR_PARITY_SCRIPT,
    '/assets/js/pages/home-v2-navbar-parity.js'
  );
  return result;
}

function injectHomepageManagerAdminScript(content) {
  const scriptPath = '/assets/js/pages/admin-homepage-manager.js?v=1';
  const rebuiltScriptPath = '/assets/js/pages/admin-homepage-rebuild.js';
  if (
    content.includes(rebuiltScriptPath) ||
    content.includes(scriptPath) ||
    !/<\/body>/i.test(content)
  ) {
    return content;
  }

  return content.replace(
    /\s*<\/body>/i,
    `\n<script src="${scriptPath}" defer></script>\n</body>`
  );
}

function stripAnonymousAuthText(content) {
  return content
    .replace(
      /<!--(?:(?!-->)[\s\S])*(?:Dashboard|Notification|Alerts|auth)(?:(?!-->)[\s\S])*-->/gi,
      ''
    )
    .replace(/aria-label="View notifications"/gi, 'aria-label=""')
    .replace(/aria-label="Go to dashboard"/gi, 'aria-label=""')
    .replace(/(<a\b[^>]*id="ef-dashboard-link"[\s\S]*?>)[\s\S]*?<\/a>/gi, '$1</a>')
    .replace(/(<a\b[^>]*id="ef-mobile-dashboard"[\s\S]*?>)[\s\S]*?<\/a>/gi, '$1</a>')
    .replace(/(<a\b[^>]*id="ef-mobile-logout"[\s\S]*?>)[\s\S]*?<\/a>/gi, '$1</a>')
    .replace(
      /(<a\b[^>]*id="ef-bottom-dashboard"[\s\S]*?<span class="ef-bottom-label">)[\s\S]*?(<\/span>)/gi,
      '$1$2'
    )
    .replace(
      /<div\b[^>]*id="notification-dropdown"[\s\S]*?<a\b[^>]*class="notification-view-all"[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/i,
      ''
    )
    .replace(/Dashboard\s+Log out/gi, '')
    .replace(/Mark all as read/gi, '')
    .replace(/View all/gi, '')
    .replace(/Version:\s*loading…?/gi, '');
}

function sanitiseHomepage(content) {
  return content
    .replace(/\s*<section id="stats-section"[\s\S]*?<\/section>/i, '')
    .replace(
      new RegExp(
        `<h3 class="ef-card__title">Verified Suppliers<\\/h3>\\s*<p class="ef-card__text">${HOMEPAGE_DIRTY_COPY.supplierClaim}<\\/p>`,
        'i'
      ),
      '<h3 class="ef-card__title">Suppliers opening in stages</h3><p class="ef-card__text">New supplier profiles are being added as EventFlow opens across the UK</p>'
    )
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.testimonialsHeading, 'gi'), '')
    .replace(/Real experiences from real event planners/gi, '')
    .replace(/Sarah\s*&(?:amp;)?\s*Tom/gi, '')
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.james, 'gi'), '')
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.emma, 'gi'), '')
    .replace(/View All Marketplace Items/gi, 'View marketplace');
}

function sanitiseStart(content) {
  return content.replace(
    /(<div class="wizard-card wizard-preload-card" id="wizard-preload")\s+aria-hidden="true"/i,
    '$1'
  );
}

function sanitisePublicCalendar(content) {
  return content
    .replace(/\/\*\s*Add event button \(publisher\)\s*\*\//i, '/* Publisher-only banner styles */')
    .replace(
      /<div id="pc-publisher-banner"[\s\S]*?<\/div>\s*(<div id="pc-permission-notice")/i,
      '<div id="pc-publisher-banner" class="pc-publisher-banner" hidden style="display:none;" role="status"></div>\n\n        $1'
    )
    .replace(
      /<section id="pc-admin-requests-panel"[\s\S]*?<\/section>/i,
      '<section id="pc-admin-requests-panel" class="pc-publisher-banner pc-notice--slate" hidden style="display:none;" aria-labelledby="pc-admin-requests-title"><div id="pc-admin-requests-list" aria-live="polite"></div></section>'
    )
    .replace(
      /<!-- Add \/ Edit Event Modal -->[\s\S]*?<footer class="footer"/i,
      '<!-- Role-gated event modal shell: populated only for authenticated calendar publishers. -->\n    <div id="pc-modal-overlay" class="pc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pc-modal-title">\n      <div class="pc-modal">\n        <div class="pc-modal__header">\n          <h2 class="pc-modal__title" id="pc-modal-title"></h2>\n          <button class="ef-cta pc-modal__close" id="pc-modal-close-btn" aria-label="Close modal" type="button">×</button>\n        </div>\n        <form id="pc-event-form" novalidate>\n          <input type="hidden" id="pc-form-id" />\n          <div id="pc-form-error" class="pc-form__error" role="alert"></div>\n          <button type="button" id="pc-modal-cancel" class="ef-cta pc-btn pc-btn-ghost" hidden></button>\n          <button type="submit" id="pc-modal-submit" class="ef-cta pc-btn pc-btn-primary" hidden></button>\n        </form>\n      </div>\n    </div>\n\n    <footer class="footer"'
    );
}

function sanitiseGuides(content) {
  return content
    .replace(
      // The non-greedy `[\s\S]*?` used to stop at the *first* `</div>` it found,
      // which closed the first nested `.skeleton-card` rather than the
      // `.skeleton-grid` wrapper itself. That left the remaining
      // `.skeleton-card` placeholders as orphaned siblings in `#guides-grid` —
      // never hidden by this sanitizer and never touched by guides-init.js
      // (which only removes `.guide-card` elements), so they sat there as
      // permanently visible grey placeholders once the real cards loaded.
      // Matching the nested cards explicitly keeps the replacement balanced.
      // Whitespace is only optional *after* each card (not before, too) so
      // the repeated group can't re-partition the same run of whitespace
      // across iterations — that double-sided optionality is what makes
      // `(\s*x\s*)*` shapes vulnerable to catastrophic backtracking.
      /<div class="skeleton-grid" id="guides-loading"[^>]*>(?:<div class="skeleton-card"><\/div>\s*)*<\/div>/i,
      '<div class="skeleton-grid" id="guides-loading" hidden aria-hidden="true"></div>'
    )
    .replace(
      /<div class="guides-empty" id="guides-empty"[\s\S]*?<button[\s\S]*?<\/button>\s*<\/div>/i,
      '<div class="guides-empty" id="guides-empty" role="status" aria-live="polite" hidden></div>'
    )
    .replace(
      /Discover vetted photographers, caterers, venues, and more near you\./gi,
      'Discover photographers, caterers, venues and more near you.'
    );
}

function useHomepageV2() {
  return (
    String(process.env.HOMEPAGE_VARIANT || 'v1')
      .trim()
      .toLowerCase() === 'v2'
  );
}

async function getHomepageVersionForRequest(requestPath) {
  if (requestPath !== '/') {
    return null;
  }

  try {
    return normaliseHomepageVersion(await getActiveHomepageVersion()) || 'v1';
  } catch (error) {
    logger.warn('Failed to read active homepage version, using HOMEPAGE_VARIANT fallback:', error);
    if (useHomepageV2()) {
      return 'v2';
    }
    return normaliseHomepageVersion(process.env.HOMEPAGE_VARIANT) || 'v1';
  }
}

function isHomepageV2PreviewPath(requestPath) {
  return HOMEPAGE_V2_PREVIEW_PATHS.has(requestPath);
}

function isHomepageV3PreviewPath(requestPath) {
  return HOMEPAGE_V3_PREVIEW_PATHS.has(requestPath);
}

function resolvePublicTemplatePath(requestPath, activeHomepageVersion) {
  if (requestPath === '/') {
    return activeHomepageVersion === 'v2' ? HOMEPAGE_V2_FILE : HOMEPAGE_INDEX_FILE;
  }

  if (isHomepageV2PreviewPath(requestPath)) {
    return HOMEPAGE_V2_FILE;
  }

  if (isHomepageV3PreviewPath(requestPath)) {
    return HOMEPAGE_INDEX_FILE;
  }

  if (!path.extname(requestPath)) {
    return `${requestPath}.html`;
  }

  return requestPath;
}

function addPreviewRobotsMeta(content) {
  if (/<meta\s+name=["']robots["'][^>]*noindex[^>]*>/i.test(content)) {
    return content;
  }

  const robotsMeta = '    <meta name="robots" content="noindex,nofollow" />\n';

  if (/<head\b[^>]*>/i.test(content)) {
    return content.replace(/(<head\b[^>]*>\s*)/i, `$1\n${robotsMeta}`);
  }

  return `${robotsMeta}${content}`;
}

function sanitizeAnonymousPublicHtml(content, requestPath, req) {
  if (requestPath === '/admin-homepage.html') {
    return injectHomepageManagerAdminScript(content);
  }

  if (!isAnonymousRequest(req)) {
    return content;
  }

  let result = stripAnonymousAuthText(content);

  if (requestPath === '/index.html') {
    result = sanitiseHomepage(result);
  } else if (requestPath === '/start.html') {
    result = sanitiseStart(result);
  } else if (requestPath === '/public-calendar.html') {
    result = sanitisePublicCalendar(result);
  } else if (requestPath === '/guides.html') {
    result = sanitiseGuides(result);
  }

  return addAnonymousSanitizerMarker(result);
}

function shouldProcessFile(filePath) {
  if (!filePath.endsWith('.html')) {
    return false;
  }

  const fileName = path.basename(filePath);
  const processFiles = [
    'legal.html',
    'terms.html',
    'privacy.html',
    'data-rights.html',
    'admin-settings.html',
    'admin-homepage.html',
  ];

  if (processFiles.includes(fileName)) {
    return true;
  }

  if (filePath.includes('/articles/')) {
    return true;
  }

  if (fileName.startsWith('test-')) {
    return false;
  }

  return true;
}

async function getFile(filePath, requestPath, req) {
  const cachingEnabled = isCachingEnabled();
  const stats = await fs.stat(filePath);
  const mtime = stats.mtime.getTime();
  const configPath = path.join(__dirname, '..', 'config', 'content-config.js');
  const policyMetadataPath = path.join(__dirname, '..', 'config', 'policyMetadata.js');
  let configMtime = 0;
  let policyMetadataMtime = 0;

  try {
    const configStats = await fs.stat(configPath);
    configMtime = configStats.mtime.getTime();
  } catch {
    // Config file doesn't exist or can't be read - use 0
  }

  try {
    const policyMetadataStats = await fs.stat(policyMetadataPath);
    policyMetadataMtime = policyMetadataStats.mtime.getTime();
  } catch {
    // Policy metadata file doesn't exist or can't be read - use 0
  }

  const authBucket = isAnonymousRequest(req) ? 'anon' : 'auth';
  const cacheKey = `${filePath}:${configMtime}:${policyMetadataMtime}:${authBucket}`;

  if (cachingEnabled && templateCache.has(cacheKey)) {
    const cached = templateCache.get(cacheKey);
    if (cached.mtime === mtime) {
      return { content: cached.content, fromCache: true };
    }
  }

  const content = await fs.readFile(filePath, 'utf8');
  const processedContent = injectGlobalAnalyticsScripts(
    sanitizeAnonymousPublicHtml(replacePlaceholders(content), requestPath, req),
    requestPath
  );

  if (cachingEnabled) {
    templateCache.set(cacheKey, {
      content: processedContent,
      mtime: mtime,
    });
  }

  return { content: processedContent, fromCache: false };
}

function clearCache() {
  templateCache.clear();
}

function templateMiddleware() {
  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const originalRequestPath = req.path;
    const activeHomepageVersion = await getHomepageVersionForRequest(originalRequestPath);
    const requestPath = resolvePublicTemplatePath(originalRequestPath, activeHomepageVersion);
    const isHomepageV2Preview = isHomepageV2PreviewPath(originalRequestPath);
    const isHomepageV3Preview = isHomepageV3PreviewPath(originalRequestPath);
    const isHomepageV2VariantRoot = originalRequestPath === '/' && activeHomepageVersion === 'v2';
    const isHomepageV3VariantRoot = originalRequestPath === '/' && activeHomepageVersion === 'v3';
    const isHomepagePreview = isHomepageV2Preview || isHomepageV3Preview;

    if (!shouldProcessFile(requestPath)) {
      return next();
    }

    const publicDir = path.join(__dirname, '..', 'public');
    const filePath = path.join(publicDir, requestPath);

    try {
      const { content } = await getFile(filePath, requestPath, req);
      let responseContent = content;
      const articleMatch = originalRequestPath.match(/^\/articles\/([^/?#]+)(?:\.html)?$/);
      if (articleMatch) {
        responseContent = renderArticleDates(responseContent, articleMatch[1]);
      }
      if (isHomepageV2Preview || isHomepageV2VariantRoot) {
        responseContent = buildHomepageV2Preview(responseContent);
      }
      if (isHomepageV3Preview || isHomepageV3VariantRoot) {
        responseContent = buildHomepageV3Preview(responseContent);
      }
      responseContent = isHomepagePreview ? addPreviewRobotsMeta(responseContent) : responseContent;

      setHtmlNoStoreHeaders(res);
      if (isHomepagePreview) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      }
      res.setHeader('X-EventFlow-Template-Renderer', 'active');
      res.setHeader(
        'X-EventFlow-Public-Sanitizer',
        isAnonymousRequest(req) ? 'anonymous-v2' : 'skipped-authenticated'
      );
      appendVaryHeader(res, 'Cookie');
      res.type('html');
      res.send(responseContent);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return next();
      }
      logger.error('Template rendering error:', error);
      return next(error);
    }
  };
}

module.exports = {
  templateMiddleware,
  replacePlaceholders,
  sanitizeAnonymousPublicHtml,
  injectGlobalAnalyticsScripts,
  clearCache,
  setHtmlNoStoreHeaders,
  appendVaryHeader,
  getFile,
  getPlaceholders,
  useHomepageV2,
  getHomepageVersionForRequest,
  isHomepageV2PreviewPath,
  isHomepageV3PreviewPath,
  resolvePublicTemplatePath,
  addPreviewRobotsMeta,
  buildHomepageV2Preview,
  buildHomepageV3Preview,
  injectHomepageManagerAdminScript,
};
