const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const scriptPath = path.join(__dirname, '../../public/assets/js/pages/home-stabilisation.js');
const stabilisationScript = fs.readFileSync(scriptPath, 'utf8');

function waitForAsyncWork() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createDom({ stats, listings = [], reviews = [] } = {}) {
  const dom = new JSDOM(
    `<!doctype html>
      <html>
        <head></head>
        <body>
          <section id="stats-section">
            <div class="ef-stat"><div class="ef-stat__number" data-counter="500" data-suffix="+">0</div><div class="ef-stat__label">Verified Suppliers</div></div>
            <div class="ef-stat"><div class="ef-stat__number" data-counter="1200" data-suffix="+">0</div><div class="ef-stat__label">Packages Available</div></div>
            <div class="ef-stat"><div class="ef-stat__number" data-counter="150" data-suffix="+">0</div><div class="ef-stat__label">Marketplace Items</div></div>
            <div class="ef-stat"><div class="ef-stat__number" data-counter="500" data-suffix="+">0</div><div class="ef-stat__label">Customer Reviews</div></div>
          </section>
          <section id="marketplace-preview-section">
            <h2 class="ef-section__title">Latest Items for Sale</h2>
            <p class="ef-section__subtitle">Buy and sell pre-loved event items</p>
            <div id="marketplace-preview"></div>
            <a href="/marketplace" class="ef-btn">View All Marketplace Items</a>
          </section>
          <section id="testimonials-section">
            <p class="ef-section__subtitle">Real experiences from real event planners</p>
            <div id="ef-testimonials-carousel">
              <div class="ef-testimonial active">Static testimonial</div>
            </div>
            <div class="ef-testimonials-dots"></div>
          </section>
          <section class="ef-section--supplier-cta">
            <p>Join over 500+ verified suppliers already on EventFlow</p>
          </section>
          <footer><span class="version">Version: <span id="ef-version-label">loading…</span></span></footer>
        </body>
      </html>`,
    {
      url: 'https://event-flow.co.uk/',
      runScripts: 'outside-only',
    }
  );

  dom.window.fetch = jest.fn(async url => {
    if (String(url).includes('/api/v1/public/stats')) {
      return {
        ok: true,
        json: async () =>
          stats || {
            suppliersVerified: 0,
            packagesApproved: 0,
            marketplaceListingsActive: 0,
            reviewsApproved: 0,
          },
      };
    }
    if (String(url).includes('/api/v1/marketplace/listings')) {
      return { ok: true, json: async () => ({ listings }) };
    }
    if (String(url).includes('/api/v1/reviews')) {
      return { ok: true, json: async () => ({ reviews }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

  dom.window.eval(stabilisationScript);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

describe('homepage stabilisation layer', () => {
  it('hides public stats instead of showing inflated fallback counters when stats are all zero', async () => {
    const dom = createDom();
    await waitForAsyncWork();

    const statsSection = dom.window.document.getElementById('stats-section');
    expect(statsSection.style.display).toBe('none');
    expect(statsSection.getAttribute('aria-hidden')).toBe('true');
    expect(dom.window.document.querySelector('.ef-stat__number').textContent).toBe('0');
  });

  it('renders only real non-zero stats returned by the public stats API', async () => {
    const dom = createDom({
      stats: {
        suppliersVerified: 3,
        packagesApproved: 0,
        marketplaceListingsActive: 2,
        reviewsApproved: 0,
      },
    });
    await waitForAsyncWork();

    const statsSection = dom.window.document.getElementById('stats-section');
    const numbers = Array.from(dom.window.document.querySelectorAll('.ef-stat__number')).map(el =>
      el.textContent.trim()
    );

    expect(statsSection.style.display).toBe('');
    expect(numbers).toEqual(['3+', '0', '2+', '0']);
  });

  it('shows an honest marketplace launch state when there are no live listings', async () => {
    const dom = createDom();
    await waitForAsyncWork();

    expect(dom.window.document.querySelector('#marketplace-preview-section .ef-section__title').textContent).toBe(
      'Marketplace launching soon'
    );
    expect(dom.window.document.getElementById('marketplace-preview').textContent).toContain(
      'Marketplace launching soon'
    );
  });

  it('hides static testimonials when no real approved reviews are returned', async () => {
    const dom = createDom();
    await waitForAsyncWork();

    const testimonialsSection = dom.window.document.getElementById('testimonials-section');
    expect(testimonialsSection.style.display).toBe('none');
    expect(testimonialsSection.getAttribute('aria-hidden')).toBe('true');
  });

  it('replaces the inflated supplier CTA claim with an honest growth message', async () => {
    const dom = createDom();
    await waitForAsyncWork();

    expect(dom.window.document.querySelector('.ef-section--supplier-cta p').textContent).toBe(
      'Join EventFlow as we grow our verified supplier network'
    );
  });
});
