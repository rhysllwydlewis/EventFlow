'use strict';

const fs = require('fs');
const { JSDOM } = require('jsdom');

function decodeScenario(encodedPayload) {
  if (!encodedPayload) {
    return {};
  }
  return JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
}

function makeJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function createDom(scenario) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body>' +
      '<section id="stats-section">' +
      '<div class="ef-stat"><div class="ef-stat__number" data-counter="500" data-suffix="+">0</div><div class="ef-stat__label">Verified Suppliers</div></div>' +
      '<div class="ef-stat"><div class="ef-stat__number" data-counter="1200" data-suffix="+">0</div><div class="ef-stat__label">Packages Available</div></div>' +
      '<div class="ef-stat"><div class="ef-stat__number" data-counter="150" data-suffix="+">0</div><div class="ef-stat__label">Marketplace Items</div></div>' +
      '<div class="ef-stat"><div class="ef-stat__number" data-counter="500" data-suffix="+">0</div><div class="ef-stat__label">Customer Reviews</div></div>' +
      '</section>' +
      '<section id="marketplace-preview-section"><h2 class="ef-section__title">Latest Items for Sale</h2><p class="ef-section__subtitle">Buy and sell pre-loved event items</p><div id="marketplace-preview"></div><a href="/marketplace" class="ef-btn">View All Marketplace Items</a></section>' +
      '<section id="testimonials-section"><p class="ef-section__subtitle">Real experiences from real event planners</p><div id="ef-testimonials-carousel"><div class="ef-testimonial active">Static testimonial</div></div><div class="ef-testimonials-dots"></div></section>' +
      '<section class="ef-section--supplier-cta"><p>Early supplier access is open now</p></section>' +
      '<footer><span class="version">Version: <span id="ef-version-label">loading…</span></span></footer>' +
      '</body></html>',
    { url: 'https://event-flow.co.uk/', runScripts: 'outside-only' }
  );

  dom.window.fetch = async url => {
    const requestUrl = String(url);
    if (requestUrl.includes('/api/v1/public/stats')) {
      return makeJsonResponse(
        scenario.stats || {
          suppliersVerified: 0,
          packagesApproved: 0,
          marketplaceListingsActive: 0,
          reviewsApproved: 0,
        }
      );
    }
    if (requestUrl.includes('/api/v1/marketplace/listings')) {
      return makeJsonResponse({ listings: scenario.listings || [] });
    }
    if (requestUrl.includes('/api/v1/reviews')) {
      return makeJsonResponse({ reviews: scenario.reviews || [] });
    }
    return makeJsonResponse({}, false, 404);
  };

  return dom;
}

function collectResult(document) {
  const statsSection = document.getElementById('stats-section');
  const testimonialsSection = document.getElementById('testimonials-section');

  return {
    statsDisplay: statsSection.style.display,
    statsHidden: statsSection.getAttribute('aria-hidden'),
    numbers: Array.from(document.querySelectorAll('.ef-stat__number')).map(el =>
      el.textContent.trim()
    ),
    marketplaceTitle: document.querySelector('#marketplace-preview-section .ef-section__title')
      ?.textContent,
    marketplaceText: document.getElementById('marketplace-preview')?.textContent,
    testimonialsDisplay: testimonialsSection.style.display,
    testimonialsHidden: testimonialsSection.getAttribute('aria-hidden'),
    supplierCta: document.querySelector('.ef-section--supplier-cta p')?.textContent,
  };
}

async function waitForAsyncWork() {
  // Flush the microtask queue enough times to let the full
  // fetch → .json() → DOM-update Promise chain settle.
  // Under Jest parallel load two yields was not always enough.
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  // A short real delay as a safety net under system load.
  await new Promise(resolve => setTimeout(resolve, 30));
}

async function main() {
  const scenario = decodeScenario(process.argv[2]);
  const stabilisationScript = fs.readFileSync(
    'public/assets/js/pages/home-stabilisation.js',
    'utf8'
  );
  const dom = createDom(scenario);

  dom.window.eval(stabilisationScript);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await waitForAsyncWork();

  process.stdout.write(JSON.stringify(collectResult(dom.window.document)));
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
