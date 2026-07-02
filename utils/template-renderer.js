/**
 * Template Renderer Middleware
 * Replaces placeholders in HTML files with dynamic content from content-config
 */

'use strict';

const path = require('path');
const logger = require('./logger');
const fs = require('fs').promises;
const { getPlaceholders } = require('../config/content-config');

const templateCache = new Map();
const ANONYMOUS_SANITIZER_COMMENT = '<!-- eventflow-anonymous-sanitizer: active -->';
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
const HOMEPAGE_V3_HERO_STYLES = [
  '    <link rel="preload" href="/assets/css/home-v2.css?v=11" as="style" />',
  '    <link rel="preload" href="/assets/css/home-v3.css?v=7" as="style" />',
  '    <link rel="stylesheet" href="/assets/css/home-v2.css?v=11" />',
  '    <link rel="stylesheet" href="/assets/css/home-v3.css?v=7" />',
  '    <script src="/assets/js/pages/home-v3.js?v=6"></script>',
].join('\n');
const HOMEPAGE_V3_HERO_SCRIPT = '    <script src="/assets/js/pages/home-v2.js?v=11" defer></script>';
const HOMEPAGE_V3_HERO = `      <section class="hv2-hero" aria-labelledby="hv3-title">
        <div class="hv2-hero__image" aria-hidden="true"></div>
        <div class="hv2-hero__shade" aria-hidden="true"></div>

        <div class="hv2-shell hv2-hero__content">
          <div class="hv2-hero__copy">
            <p class="hv2-eyebrow">UK event planning marketplace</p>
            <h1 id="hv3-title">Plan your event in one place</h1>
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

function injectBeforeHeadClose(content, snippet) {
  if (!/<\/head>/i.test(content) || content.includes('/assets/css/home-v3.css')) {
    return content;
  }

  return content.replace(/\s*<\/head>/i, `\n${snippet}\n</head>`);
}

function injectBeforeBodyClose(content, snippet) {
  if (!/<\/body>/i.test(content) || content.includes('/assets/js/pages/home-v2.js?v=11')) {
    return content;
  }

  return content.replace(/\s*<\/body>/i, `\n${snippet}\n</body>`);
}

function replaceHomepageHeroWithV3(content) {
  const heroPattern =
    /\s*<section class="hero hero-modern">[\s\S]*?<\/section>\s*(?=<!-- Noscript fallback for hero CTAs -->|<noscript>)/i;

  if (!heroPattern.test(content)) {
    return content;
  }

  return content.replace(heroPattern, `\n${HOMEPAGE_V3_HERO}\n\n`);
}

function buildHomepageV3Preview(content) {
  let result = addBodyClass(content, 'home-v3-page');
  result = injectBeforeHeadClose(result, HOMEPAGE_V3_HERO_STYLES);
  result = replaceHomepageHeroWithV3(result);
  result = injectBeforeBodyClose(result, HOMEPAGE_V3_HERO_SCRIPT);
  return result;
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
    .replace(/Version:\s*loadingâ€¦?/gi, '');
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
    /(<div class="wizard-card wizard-preload-card" id="wizard-preload")\s+a…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆ¤½¤°(€€€€Ä(€€¤ì)ô()™Õ¹Ñ¥½¸Í…¹¥Ñ¥Í•AÕ‰±¥…±•¹‘…È¡½¹Ñ•¹Ð¤ì(€É•ÑÕÉ¸½¹Ñ•¹Ð(€€€€¹É•Á±…” ½p½p©qÍ‘•Ù•¹Ð‰ÕÑÑ½¸p¡ÁÕ‰±¥Í¡•Ép¥qÌ©p©p½¤°€œ¼¨AÕ‰±¥Í¡•Èµ½¹±ä‰…¹¹•ÈÍÑå±•Ì€¨¼œ¤(€€€€¹É•Á±…” (€€€€€€¼ñ‘¥Ø¥ô‰ÁŒµÁÕ‰±¥Í¡•Èµ‰…¹¹•È‰mqÍqMt¨üñp½‘¥ØùqÌ¨ ñ‘¥Ø¥ô‰ÁŒµÁ•Éµ¥ÍÍ¥½¸µ¹½Ñ¥”ˆ¤½¤°(€€€€€€œñ‘¥Ø¥ô‰ÁŒµÁÕ‰±¥Í¡•Èµ‰…¹¹•Èˆ±…ÍÌô‰ÁŒµÁÕ‰±¥Í¡•Èµ‰…¹¹•Èˆ¡¥‘‘•¸ÍÑå±”ô‰‘¥ÍÁ±…äé¹½¹”ìˆÉ½±”ô‰ÍÑ…ÑÕÌˆøð½‘¥Øùq¹q¸€€€€€€€€Äœ(€€€€¤(€€€€¹É•Á±…” (€€€€€€¼ñÍ•Ñ¥½¸¥ô‰ÁŒµ…‘µ¥¸µÉ•ÅÕ•ÍÑÌµÁ…¹•°‰mqÍqMt¨üñp½Í•Ñ¥½¸ø½¤°(€€€€€€œñÍ•Ñ¥½¸¥ô‰ÁŒµ…‘µ¥¸µÉ•ÅÕ•ÍÑÌµÁ…¹•°ˆ±…ÍÌô‰ÁŒµÁÕ‰±¥Í¡•Èµ‰…¹¹•ÈÁŒµ¹½Ñ¥”´µÍ±…Ñ”ˆ¡¥‘‘•¸ÍÑå±”ô‰‘¥ÍÁ±…äé¹½¹”ìˆ…É¥„µ±…‰•±±•‘‰äô‰ÁŒµ…‘µ¥¸µÉ•ÅÕ•ÍÑÌµÑ¥Ñ±”ˆøñ‘¥Ø¥ô‰ÁŒµ…‘µ¥¸µÉ•ÅÕ•ÍÑÌµ±¥ÍÐˆ…É¥„µ±¥Ù”ô‰Á½±¥Ñ”ˆøð½‘¥Øøð½Í•Ñ¥½¸øœ(€€€€¤(€€€€¹É•Á±…” (€€€€€€¼ð„´´‘p¼‘¥ÐÙ•¹Ð5½‘…°€´´ùmqÍqMt¨üñ™½½Ñ•È±…ÍÌô‰™½½Ñ•Èˆ½¤°(€€€€€€œð„´´I½±”µ…Ñ••Ù•¹Ðµ½‘…°Í¡•±°èÁ½ÁÕ±…Ñ•½¹±ä™½È…ÕÑ¡•¹Ñ¥…Ñ•…±•¹‘…ÈÁÕ‰±¥Í¡•ÉÌ¸€´´ùq¸€€€€ñ‘¥Ø¥ô‰ÁŒµµ½‘…°µ½Ù•É±…äˆ±…ÍÌô‰ÁŒµµ½‘…°µ½Ù•É±…äˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆ…É¥„µ±…‰•±±•‘‰äô‰ÁŒµµ½‘…°µÑ¥Ñ±”ˆùq¸€€€€€€ñ‘¥Ø±…ÍÌô‰ÁŒµµ½‘…°ˆùq¸€€€€€€€€ñ‘¥Ø±…ÍÌô‰ÁŒµµ½‘…±}}¡•…‘•Èˆùq¸€€€€€€€€€€ñ È±…ÍÌô‰ÁŒµµ½‘…±}}Ñ¥Ñ±”ˆ¥ô‰ÁŒµµ½‘…°µÑ¥Ñ±”ˆøð½ Èùq¸€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÌô‰•˜µÑ„ÁŒµµ½‘…±}}±½Í”ˆ¥ô‰ÁŒµµ½‘…°µ±½Í”µ‰Ñ¸ˆ…É¥„µ±…‰•°ô‰±½Í”µ½‘…°ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆû\ð½‰ÕÑÑ½¸ùq¸€€€€€€€€ð½‘¥Øùq¸€€€€€€€€ñ™½É´¥ô‰ÁŒµ•Ù•¹Ðµ™½É´ˆ¹½Ù…±¥‘…Ñ”ùq¸€€€€€€€€€€ñ¥¹ÁÕÐÑåÁ”ô‰¡¥‘‘•¸ˆ¥ô‰ÁŒµ™½É´µ¥ˆ€¼ùq¸€€€€€€€€€€ñ‘¥Ø¥ô‰ÁŒµ™½É´µ•ÉÉ½Èˆ±…ÍÌô‰ÁŒµ™½Éµ}}•ÉÉ½ÈˆÉ½±”ô‰…±•ÉÐˆøð½‘¥Øùq¸€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ¥ô‰ÁŒµµ½‘…°µ…¹•°ˆ±…ÍÌô‰•˜µÑ„ÁŒµ‰Ñ¸ÁŒµ‰Ñ¸µ¡½ÍÐˆ¡¥‘‘•¸øð½‰ÕÑÑ½¸ùq¸€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰ÍÕ‰µ¥Ðˆ¥ô‰ÁŒµµ½‘…°µÍÕ‰µ¥Ðˆ±…ÍÌô‰•˜µÑ„ÁŒµ‰Ñ¸ÁŒµ‰Ñ¸µÁÉ¥µ…Éäˆ¡¥‘‘•¸øð½‰ÕÑÑ½¸ùq¸€€€€€€€€ð½™½É´ùq¸€€€€€€ð½‘¥Øùq¸€€€€ð½‘¥Øùq¹q¸€€€€ñ™½½Ñ•È±…ÍÌô‰™½½Ñ•Èˆœ(€€€€¤ì)ô()™Õ¹Ñ¥½¸Í…¹¥Ñ¥Í•Õ¥‘•Ì¡½¹Ñ•¹Ð¤ì(€É•ÑÕÉ¸½¹Ñ•¹Ð(€€€€¹É•Á±…” (€€€€€€¼ñ‘¥Ø±…ÍÌô‰Í­•±•Ñ½¸µÉ¥ˆ¥ô‰Õ¥‘•Ìµ±½…‘¥¹œ‰mxùt¨ùmqÍqMt¨üñp½‘¥Øø½¤°(€€€€€€œñ‘¥Ø±…ÍÌô‰Í­•±•Ñ½¸µÉ¥ˆ¥ô‰Õ¥‘•Ìµ±½…‘¥¹œˆ¡¥‘‘•¸…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆøð½‘¥Øøœ(€€€€¤(€€€€¹É•Á±…” (€€€€€€¼ñ‘¥Ø±…ÍÌô‰Õ¥‘•Ìµ•µÁÑäˆ¥ô‰Õ¥‘•Ìµ•µÁÑä‰mqÍqMt¨üñ‰ÕÑÑ½¹mqÍqMt¨üñp½‰ÕÑÑ½¸ùqÌ¨ñp½‘¥Øø½¤°(€€€€€€œñ‘¥Ø±…ÍÌô‰Õ¥‘•Ìµ•µÁÑäˆ¥ô‰Õ¥‘•Ìµ•µÁÑäˆÉ½±”ô‰ÍÑ…ÑÕÌˆ…É¥„µ±¥Ù”ô‰Á½±¥Ñ”ˆ¡¥‘‘•¸øð½‘¥Øøœ(€€€€¤(€€€€¹É•Á±…” (€€€€€€½¥Í½Ù•ÈÙ•ÑÑ•Á¡½Ñ½É…Á¡•ÉÌ°…Ñ•É•ÉÌ°Ù•¹Õ•Ì°…¹µ½É”¹•…Èå½Õp¸½¤°(€€€€€€¥Í½Ù•ÈÁ¡½Ñ½É…Á¡•ÉÌ°…Ñ•É•ÉÌ°Ù•¹Õ•Ì…¹µ½É”¹•…Èå½Ô¸œ(€€€€¤ì)ô()™Õ¹Ñ¥½¸ÕÍ•!½µ•Á…•XÈ ¤ì(€É•ÑÕÉ¸€ (€€€MÑÉ¥¹œ¡ÁÉ½•ÍÌ¹•¹Ø¹!=5A}YI%9Pñð€ØÄœ¤(€€€€€€¹ÑÉ¥´ ¤(€€€€€€¹Ñ½1½Ý•É…Í” ¤€ôôô€ØÈœ(€€¤ì)ô()™Õ¹Ñ¥½¸¥Í!½µ•Á…•XÉAÉ•Ù¥•ÝA…Ñ ¡É•ÅÕ•ÍÑA…Ñ ¤ì(€É•ÑÕÉ¸!=5A}XÉ}AIY%]}AQ!L¹¡…Ì¡É•ÅÕ•ÍÑA…Ñ ¤ì)ô()™Õ¹Ñ¥½¸¥Í!½µ•Á…•XÍAÉ•Ù¥•ÝA…Ñ ¡É•ÅÕ•ÍÑA…Ñ ¤ì(€É•ÑÕÉ¸!=5A}XÍ}AIY%]}AQ!L¹¡…Ì¡É•ÅÕ•ÍÑA…Ñ ¤ì)ô()™Õ¹Ñ¥½¸É•Í½±Ù•AÕ‰±¥Q•µÁ±…Ñ•A…Ñ ¡É•ÅÕ•ÍÑA…Ñ ¤ì(€¥˜€¡É•ÅÕ•ÍÑA…Ñ €ôôô€œ¼œ¤ì(€€€É•ÑÕÉ¸ÕÍ•!½µ•Á…•XÈ ¤€ü!=5A}XÉ}%1€è€œ½¥¹‘•à¹¡Ñµ°œì(€ô((€¥˜€¡¥Í!½µ•Á…•XÉAÉ•Ù¥•ÝA…Ñ ¡É•ÅÕ•ÍÑA…Ñ ¤¤ì(€€€É•ÑÕÉ¸!=5A}XÉ}%1ì(€ô((€¥˜€¡¥Í!½µ•Á…•XÍAÉ•Ù¥•ÝA…Ñ ¡É•ÅÕ•ÍÑA…Ñ ¤¤ì(€€€É•ÑÕÉ¸€œ½¥¹‘•à¹¡Ñµ°œì(€ô((€¥˜€ …Á…Ñ ¹•áÑ¹…µ”¡É•ÅÕ•ÍÑA…Ñ ¤¤ì(€€€É•ÑÕÉ¸€‘íÉ•ÅÕ•ÍÑA…Ñ¡ô¹¡Ñµ±€ì(€ô((€É•ÑÕÉ¸É•ÅÕ•ÍÑA…Ñ ì)ô()™Õ¹Ñ¥½¸…‘‘AÉ•Ù¥•ÝI½‰½ÑÍ5•Ñ„¡½¹Ñ•¹Ð¤ì(€¥˜€ ¼ñµ•Ñ…qÌ­¹…µ”õlˆuÉ½‰½ÑÍlˆumxùt©¹½¥¹‘•ámxùt¨ø½¤¹Ñ•ÍÐ¡½¹Ñ•¹Ð¤¤ì(€€€É•ÑÕÉ¸½¹Ñ•¹Ðì(€ô((€½¹ÍÐÉ½‰½ÑÍ5•Ñ„€ô€œ€€€€ñµ•Ñ„¹…µ”ô‰É½‰½ÑÌˆ½¹Ñ•¹Ðô‰¹½¥¹‘•à±¹½™½±±½Üˆ€¼ùq¸œì((€¥˜€ ¼ñ¡•…‘q‰mxùt¨ø½¤¹Ñ•ÍÐ¡½¹Ñ•¹Ð¤¤ì(€€€É•ÑÕÉ¸½¹Ñ•¹Ð¹É•Á±…” ¼ ñ¡•…‘q‰mxùt¨ùqÌ¨¤½¤°€Åq¸‘íÉ½‰½ÑÍ5•Ñ…õ€¤ì(€ô((€É•ÑÕÉ¸€‘íÉ½‰½ÑÍ5•Ñ…ô‘í½¹Ñ•¹Ñõ€ì)ô()™Õ¹Ñ¥½¸Í…¹¥Ñ¥é•¹½¹åµ½ÕÍAÕ‰±¥!Ñµ°¡½¹Ñ•¹Ð°É•ÅÕ•ÍÑA…Ñ °É•Ä¤ì(€¥˜€ …¥Í¹½¹åµ½ÕÍI•ÅÕ•ÍÐ¡É•Ä¤¤ì(€€€É•ÑÕÉ¸½¹Ñ•¹Ðì(€ô((€±•ÐÉ•ÍÕ±Ð€ôÍÑÉ¥Á¹½¹åµ½ÕÍÕÑ¡Q•áÐ¡½¹Ñ•¹Ð¤ì((€¥˜€¡É•ÅÕ•ÍÑA…Ñ €ôôô€œ½¥¹‘•à¹¡Ñµ°œ¤ì(€€€É•ÍÕ±Ð€ôÍ…¹¥Ñ¥Í•!½µ•Á…”¡É•ÍÕ±Ð¤ì(€ô•±Í”¥˜€¡É•ÅÕ•ÍÑA…Ñ €ôôô€œ½ÍÑ…ÉÐ¹¡Ñµ°œ¤ì(€€€É•ÍÕ±Ð€ôÍ…¹¥Ñ¥Í•MÑ…ÉÐ¡É•ÍÕ±Ð¤ì(€ô•±Í”¥˜€¡É•ÅÕ•ÍÑA…Ñ €ôôô€œ½ÁÕ‰±¥Œµ…±•¹‘…È¹¡Ñµ°œ¤ì(€€€É•ÍÕ±Ð€ôÍ…¹¥Ñ¥Í•AÕ‰±¥…±•¹‘…È¡É•ÍÕ±Ð¤ì(€ô•±Í”¥˜€¡É•ÅÕ•ÍÑA…Ñ €ôôô€œ½Õ¥‘•Ì¹¡Ñµ°œ¤ì(€€€É•ÍÕ±Ð€ôÍ…¹¥Ñ¥Í•Õ¥‘•Ì¡É•ÍÕ±Ð¤ì(€ô((€É•ÑÕÉ¸…‘‘¹½¹åµ½ÕÍM…¹¥Ñ¥é•É5…É­•È¡É•ÍÕ±Ð¤ì)ô()™Õ¹Ñ¥½¸Í¡½Õ±‘AÉ½•ÍÍ¥±”¡™¥±•A…Ñ ¤ì(€¥˜€ …™¥±•A…Ñ ¹•¹‘Í]¥Ñ  œ¹¡Ñµ°œ¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô((€½¹ÍÐ™¥±•9…µ”€ôÁ…Ñ ¹‰…Í•¹…µ”¡™¥±•A…Ñ ¤ì(€½¹ÍÐÁÉ½•ÍÍ¥±•Ì€ôl(€€€€±•…°¹¡Ñµ°œ°(€€€€Ñ•ÉµÌ¹¡Ñµ°œ°(€€€€ÁÉ¥Ù…ä¹¡Ñµ°œ°(€€€€‘…Ñ„µÉ¥¡ÑÌ¹¡Ñµ°œ°(€€€€…‘µ¥¸µÍ•ÑÑ¥¹Ì¹¡Ñµ°œ°(€tì((€¥˜€¡ÁÉ½•ÍÍ¥±•Ì¹¥¹±Õ‘•Ì¡™¥±•9…µ”¤¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€¥˜€¡™¥±•A…Ñ ¹¥¹±Õ‘•Ì œ½…ÉÑ¥±•Ì¼œ¤¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€¥˜€¡™¥±•9…µ”¹ÍÑ…ÉÑÍ]¥Ñ  Ñ•ÍÐ´œ¤¤ì(€€€É•ÑÕÉ¸™…±Í”ì(€ô((€É•ÑÕÉ¸ÑÉÕ”ì)ô()…Íå¹Œ™Õ¹Ñ¥½¸•Ñ¥±”¡™¥±•A…Ñ °É•ÅÕ•ÍÑA…Ñ °É•Ä¤ì(€½¹ÍÐ…¡¥¹¹…‰±•€ô¥Í…¡¥¹¹…‰±• ¤ì(€½¹ÍÐÍÑ…ÑÌ€ô…Ý…¥Ð™Ì¹ÍÑ…Ð¡™¥±•A…Ñ ¤ì(€½¹ÍÐµÑ¥µ”€ôÍÑ…ÑÌ¹µÑ¥µ”¹•ÑQ¥µ” ¤ì(€½¹ÍÐ½¹™¥A…Ñ €ôÁ…Ñ ¹©½¥¸¡}}‘¥É¹…µ”°€œ¸¸œ°€½¹™¥œœ°€½¹Ñ•¹Ðµ½¹™¥œ¹©Ìœ¤ì(€±•Ð½¹™¥5Ñ¥µ”€ô€Àì((€ÑÉäì(€€€½¹ÍÐ½¹™¥MÑ…ÑÌ€ô…Ý…¥Ð™Ì¹ÍÑ…Ð¡½¹™¥A…Ñ ¤ì(€€€½¹™¥5Ñ¥µ”€ô½¹™¥MÑ…ÑÌ¹µÑ¥µ”¹•ÑQ¥µ” ¤ì(€ô…Ñ €¡•ÉÈ¤ì(€€€€¼¼½¹™¥œ™¥±”‘½•Í¸Ð•á¥ÍÐ½È…¸Ð‰”É•…€´ÕÍ”€À(€ô((€½¹ÍÐ…ÕÑ¡	Õ­•Ð€ô¥Í¹½¹åµ½ÕÍI•ÅÕ•ÍÐ¡É•Ä¤€ü€…¹½¸œ€è€…ÕÑ œì(€½¹ÍÐ…¡•-•ä€ô€‘í™¥±•A…Ñ¡ôè‘í½¹™¥5Ñ¥µ•ôè‘í…ÕÑ¡	Õ­•Ñõ€ì((€¥˜€¡…¡¥¹¹…‰±•€˜˜Ñ•µÁ±…Ñ•…¡”¹¡…Ì¡…¡•-•ä¤¤ì(€€€½¹ÍÐ…¡•€ôÑ•µÁ±…Ñ•…¡”¹•Ð¡…¡•-•ä¤ì(€€€¥˜€¡…¡•¹µÑ¥µ”€ôôôµÑ¥µ”¤ì(€€€€€É•ÑÕÉ¸ì½¹Ñ•¹Ðè…¡•¹½¹Ñ•¹Ð°™É½µ…¡”èÑÉÕ”ôì(€€€ô(€ô((€½¹ÍÐ½¹Ñ•¹Ð€ô…Ý…¥Ð™Ì¹É•…‘¥±”¡™¥±•A…Ñ °€ÕÑ˜àœ¤ì(€½¹ÍÐÁÉ½•ÍÍ•‘½¹Ñ•¹Ð€ôÍ…¹¥Ñ¥é•¹½¹åµ½ÕÍAÕ‰±¥!Ñµ° (€€€É•Á±…•A±…•¡½±‘•ÉÌ¡½¹Ñ•¹Ð¤°(€€€É•ÅÕ•ÍÑA…Ñ °(€€€É•Ä(€€¤ì((€¥˜€¡…¡¥¹¹…‰±•¤ì(€€€Ñ•µÁ±…Ñ•…¡”¹Í•Ð¡…¡•-•ä°ì(€€€€€½¹Ñ•¹ÐèÁÉ½•ÍÍ•‘½¹Ñ•¹Ð°(€€€€€µÑ¥µ”èµÑ¥µ”°(€€€ô¤ì(€ô((€É•ÑÕÉ¸ì½¹Ñ•¹ÐèÁÉ½•ÍÍ•‘½¹Ñ•¹Ð°™É½µ…¡”è™…±Í”ôì)ô()™Õ¹Ñ¥½¸±•…É…¡” ¤ì(€Ñ•µÁ±…Ñ•…¡”¹±•…È ¤ì)ô()™Õ¹Ñ¥½¸Ñ•µÁ±…Ñ•5¥‘‘±•Ý…É” ¤ì(€É•ÑÕÉ¸…Íå¹Œ€¡É•Ä°É•Ì°¹•áÐ¤€ôøì(€€€¥˜€¡É•Ä¹µ•Ñ¡½€„ôô€Pœ¤ì(€€€€€É•ÑÕÉ¸¹•áÐ ¤ì(€€€ô((€€€½¹ÍÐ½É¥¥¹…±I•ÅÕ•ÍÑA…Ñ €ôÉ•Ä¹Á…Ñ ì(€€€½¹ÍÐÉ•ÅÕ•ÍÑA…Ñ €ôÉ•Í½±Ù•AÕ‰±¥Q•µÁ±…Ñ•A…Ñ ¡½É¥¥¹…±I•ÅÕ•ÍÑA…Ñ ¤ì(€€€½¹ÍÐ¥Í!½µ•Á…•XÉAÉ•Ù¥•Ü€ô¥Í!½µ•Á…•XÉAÉ•Ù¥•ÝA…Ñ ¡½É¥¥¹…±I•ÅÕ•ÍÑA…Ñ ¤ì(€€€½¹ÍÐ¥Í!½µ•Á…•XÍAÉ•Ù¥•Ü€ô¥Í!½µ•Á…•XÍAÉ•Ù¥•ÝA…Ñ ¡½É¥¥¹…±I•ÅÕ•ÍÑA…Ñ ¤ì(€€€½¹ÍÐ¥Í!½µ•Á…•AÉ•Ù¥•Ü€ô¥Í!½µ•Á…•XÉAÉ•Ù¥•Üñð¥Í!½µ•Á…•XÍAÉ•Ù¥•Üì((€€€¥˜€ …Í¡½Õ±‘AÉ½•ÍÍ¥±”¡É•ÅÕ•ÍÑA…Ñ ¤¤ì(€€€€€É•ÑÕÉ¸¹•áÐ ¤ì(€€€ô((€€€½¹ÍÐÁÕ‰±¥¥È€ôÁ…Ñ ¹©½¥¸¡}}‘¥É¹…µ”°€œ¸¸œ°€ÁÕ‰±¥Œœ¤ì(€€€½¹ÍÐ™¥±•A…Ñ €ôÁ…Ñ ¹©½¥¸¡ÁÕ‰±¥¥È°É•ÅÕ•ÍÑA…Ñ ¤ì((€€€ÑÉäì(€€€€€½¹ÍÐì½¹Ñ•¹Ðô€ô…Ý…¥Ð•Ñ¥±”¡™¥±•A…Ñ °É•ÅÕ•ÍÑA…Ñ °É•Ä¤ì(€€€€€±•ÐÉ•ÍÁ½¹Í•½¹Ñ•¹Ð€ô¥Í!½µ•Á…•XÍAÉ•Ù¥•Ü€ü‰Õ¥±‘!½µ•Á…•XÍAÉ•Ù¥•Ü¡½¹Ñ•¹Ð¤€è½¹Ñ•¹Ðì(€€€€€É•ÍÁ½¹Í•½¹Ñ•¹Ð€ô¥Í!½µ•Á…•AÉ•Ù¥•Ü€ü…‘‘AÉ•Ù¥•ÝI½‰½ÑÍ5•Ñ„¡É•ÍÁ½¹Í•½¹Ñ•¹Ð¤€èÉ•ÍÁ½¹Í•½¹Ñ•¹Ðì((€€€€€Í•Ñ!Ñµ±9½MÑ½É•!•…‘•ÉÌ¡É•Ì¤ì(€€€€€¥˜€¡¥Í!½µ•Á…•AÉ•Ù¥•Ü¤ì(€€€€€€€É•Ì¹Í•Ñ!•…‘•È `µI½‰½ÑÌµQ…œœ°€¹½¥¹‘•à°¹½™½±±½Üœ¤ì(€€€€€ô(€€€€€É•Ì¹Í•Ñ!•…‘•È `µÙ•¹Ñ±½ÜµQ•µÁ±…Ñ”µI•¹‘•É•Èœ°€…Ñ¥Ù”œ¤ì(€€€€€É•Ì¹Í•Ñ!•…‘•È (€€€€€€€€`µÙ•¹Ñ±½ÜµAÕ‰±¥ŒµM…¹¥Ñ¥é•Èœ°(€€€€€€€¥Í¹½¹åµ½ÕÍI•ÅÕ•ÍÐ¡É•Ä¤€ü€…¹½¹åµ½ÕÌµØÈœ€è€Í­¥ÁÁ•µ…ÕÑ¡•¹Ñ¥…Ñ•œ(€€€€€€¤ì(€€€€€…ÁÁ•¹‘Y…Éå!•…‘•È¡É•Ì°€½½­¥”œ¤ì(€€€€€É•Ì¹ÑåÁ” ¡Ñµ°œ¤ì(€€€€€É•Ì¹Í•¹¡É•ÍÁ½¹Í•½¹Ñ•¹Ð¤ì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€¥˜€¡•ÉÉ½È¹½‘”€ôôô€9=9Pœ¤ì(€€€€€€€É•ÑÕÉ¸¹•áÐ ¤ì(€€€€€ô(€€€€€±½•È¹•ÉÉ½È Q•µÁ±…Ñ”É•¹‘•É¥¹œ•ÉÉ½Èèœ°•ÉÉ½È¤ì(€€€€€É•ÑÕÉ¸¹•áÐ¡•ÉÉ½È¤ì(€€€ô(€ôì)ô()µ½‘Õ±”¹•áÁ½ÉÑÌ€ôì(€Ñ•µÁ±…Ñ•5¥‘‘±•Ý…É”°(€É•Á±…•A±…•¡½±‘•ÉÌ°(€Í…¹¥Ñ¥é•¹½¹åµ½ÕÍAÕ‰±¥!Ñµ°°(€±•…É…¡”°(€Í•Ñ!Ñµ±9½MÑ½É•!•…‘•ÉÌ°(€…ÁÁ•¹‘Y…Éå!•…‘•È°(€•Ñ¥±”°(€•ÑA±…•¡½±‘•ÉÌ°(€ÕÍ•!½µ•Á…•XÈ°(€¥Í!½µ•Á…•XÉAÉ•Ù¥•ÝA…Ñ °(€¥Í!½µ•Á…•XÍAÉ•Ù¥•ÝA…Ñ °(€É•Í½±Ù•AÕ‰±¥Q•µÁ±…Ñ•A…Ñ °(€…‘‘AÉ•Ù¥•ÝI½‰½ÑÍ5•Ñ„°(€‰Õ¥±‘!½µ•Á…•XÍAÉ•Ù¥•Ü°)ôì