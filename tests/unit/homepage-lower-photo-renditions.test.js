'use strict';

/**
 * The lower homepage (category cards and the marketplace preview) asks the
 * server for a resized rendition of a stored photo (GET /api/photos/:id?w=)
 * instead of the up-to-1200 px original. Category cards show those photos at
 * about 180-500 CSS px; before this they downloaded roughly 1 MB of full-size
 * JPEG on a phone.
 *
 * This runs the real homepage-approved-lower.js in a sandbox and reads the
 * markup it writes, rather than matching its source.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'public/assets/js/pages/homepage-approved-lower.js'),
  'utf8'
);
const INDEX = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

function makeElement() {
  const listeners = {};
  const element = {
    className: '',
    innerHTML: '',
    dataset: {},
    attributes: {},
    classList: { add() {}, remove() {} },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    remove() {},
    listeners,
  };
  return element;
}

/**
 * Run the script against a fake page and wait for its async renders.
 * @param {{categories?: object[]|null, listings?: object[], categoryImages?: object[]}} data
 *   API responses, and the <img> elements the category container should report.
 * @returns {Promise<{categories: string, marketplace: string}>} Rendered HTML.
 */
async function renderHomepage({ categories = null, listings = [], categoryImages = [] } = {}) {
  const categorySection = makeElement();
  const categoryContainer = makeElement();
  categoryContainer.querySelectorAll = () => categoryImages;
  const marketplaceSection = makeElement();
  const marketplaceContainer = makeElement();

  const elementsById = {
    'category-grid-home': categoryContainer,
    'marketplace-preview-section': marketplaceSection,
    'marketplace-preview': marketplaceContainer,
  };

  const textDiv = () => {
    let text = '';
    return {
      set textContent(value) {
        text = String(value);
      },
      get innerHTML() {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      },
    };
  };

  const fetchStub = async url => {
    if (url.startsWith('/api/v1/categories')) {
      return categories === null
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => ({ items: categories }) };
    }
    if (url.startsWith('/api/v1/marketplace/listings')) {
      return { ok: true, json: async () => ({ listings }) };
    }
    return { ok: false, json: async () => ({}) };
  };

  const sandbox = {
    document: {
      readyState: 'complete',
      body: { dataset: {}, classList: { add() {} } },
      querySelector: selector => (selector === '.home-category-section' ? categorySection : null),
      getElementById: id => elementsById[id] || null,
      createElement: textDiv,
      addEventListener() {},
    },
    window: {
      location: { origin: 'https://event-flow.co.uk', href: '' },
      setTimeout: () => 0,
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: fetchStub,
    URL,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.fetch = fetchStub;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  // The category and marketplace renders are fire-and-forget async chains.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  await new Promise(resolve => setImmediate(resolve));

  return {
    categories: categoryContainer.innerHTML,
    marketplace: marketplaceContainer.innerHTML,
  };
}

const imgTags = html => html.match(/<img [^>]*>/g) || [];
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];

describe('category cards', () => {
  const storedPhoto = (id, extra = {}) => ({
    name: `Category ${id}`,
    slug: `cat-${id}`,
    heroImage: `/api/photos/photo_${id}`,
    ...extra,
  });

  test('request a rendition of a stored photo, with a srcset for denser screens', async () => {
    const { categories } = await renderHomepage({ categories: [storedPhoto('abc123')] });
    const [tag] = imgTags(categories);

    expect(attr(tag, 'src')).toBe('/api/photos/photo_abc123?w=640');
    expect(attr(tag, 'srcset')).toBe(
      '/api/photos/photo_abc123?w=320 320w, /api/photos/photo_abc123?w=480 480w, /api/photos/photo_abc123?w=640 640w, /api/photos/photo_abc123?w=1200 1200w'
    );
    expect(attr(tag, 'sizes')).toBe('(max-width: 1060px) 50vw, 280px');
    expect(attr(tag, 'loading')).toBe('lazy');
  });

  test('every srcset width is one the photo route serves, so none is snapped to another', async () => {
    const { ALLOWED_WIDTHS } = require('../../utils/photo-variants');
    const { categories } = await renderHomepage({ categories: [storedPhoto('abc123')] });
    const widths = [...attr(imgTags(categories)[0], 'srcset').matchAll(/w=(\d+) \d+w/g)].map(m =>
      Number(m[1])
    );
    expect(widths.length).toBeGreaterThan(1);
    widths.forEach(width => expect(ALLOWED_WIDTHS).toContain(width));
  });

  test('leave a photo that is not a bare stored-photo path exactly as it was', async () => {
    const { categories } = await renderHomepage({
      categories: [
        { name: 'Static', slug: 'static', heroImage: '/assets/images/collage-venue-640.webp' },
        { name: 'Query', slug: 'query', heroImage: '/api/photos/photo_x?w=320' },
        { name: 'Nested', slug: 'nested', heroImage: '/api/photos/photo_x/extra' },
      ],
    });
    const tags = imgTags(categories);

    expect(attr(tags[0], 'src')).toBe('/assets/images/collage-venue-640.webp');
    expect(attr(tags[1], 'src')).toBe('/api/photos/photo_x?w=320');
    expect(attr(tags[2], 'src')).toBe('/api/photos/photo_x/extra');
    tags.forEach(tag => {
      expect(attr(tag, 'srcset')).toBeUndefined();
      expect(attr(tag, 'sizes')).toBeUndefined();
    });
  });

  test('a third-party photo is still refused, not rewritten', async () => {
    const { categories } = await renderHomepage({
      categories: [{ name: 'Ext', slug: 'ext', heroImage: 'https://images.pexels.com/p/1.jpeg' }],
    });
    const [tag] = imgTags(categories);
    expect(attr(tag, 'src')).toBe('/assets/images/collage-venue-640.webp');
    expect(attr(tag, 'srcset')).toBeUndefined();
  });

  test('the built-in fallback categories keep their static images', async () => {
    const { categories } = await renderHomepage({ categories: null });
    imgTags(categories).forEach(tag => {
      expect(attr(tag, 'src')).toMatch(/^\/assets\/images\//);
      expect(attr(tag, 'srcset')).toBeUndefined();
    });
  });

  test('a photo id with characters outside the allowed set is not rewritten', async () => {
    const { categories } = await renderHomepage({
      categories: [{ name: 'Bad', slug: 'bad', heroImage: '/api/photos/x" onerror="alert(1)' }],
    });
    const html = categories;
    expect(html).not.toMatch(/onerror="alert/);
    imgTags(html).forEach(tag => expect(attr(tag, 'srcset')).toBeUndefined());
  });
});

describe('marketplace preview', () => {
  test('requests a rendition of a stored listing photo', async () => {
    const { marketplace } = await renderHomepage({
      listings: [{ title: 'Chair', price: 10, images: ['/api/photos/photo_listing1'] }],
    });
    const [tag] = imgTags(marketplace);

    expect(attr(tag, 'src')).toBe('/api/photos/photo_listing1?w=640');
    expect(attr(tag, 'srcset')).toBe(
      '/api/photos/photo_listing1?w=640 640w, /api/photos/photo_listing1?w=800 800w, /api/photos/photo_listing1?w=1200 1200w'
    );
    expect(attr(tag, 'sizes')).toBe('(max-width: 820px) calc(100vw - 80px), 340px');
  });

  test('leaves a listing with no stored photo on the static fallback', async () => {
    const { marketplace } = await renderHomepage({ listings: [{ title: 'Chair', price: 10 }] });
    const [tag] = imgTags(marketplace);
    expect(attr(tag, 'src')).toBe('/assets/images/collage-venue-640.webp');
    expect(attr(tag, 'srcset')).toBeUndefined();
  });
});

describe('image error fallback', () => {
  test('drops srcset and sizes before swapping src, so the failed photo is not re-requested', async () => {
    // A stand-in <img> carrying what the script rendered for a stored photo.
    const image = makeElement();
    image.dataset.fallbackSrc = '/assets/images/collage-venue-640.webp';
    image.attributes = {
      srcset: '/api/photos/photo_a?w=320 320w',
      sizes: '50vw',
      'data-fallback-src': image.dataset.fallbackSrc,
    };
    image.src = '/api/photos/photo_a?w=640';

    // The script binds its error handler to every img[data-fallback-src] it finds
    // in the container it just filled.
    await renderHomepage({ categories: null, categoryImages: [image] });

    expect(typeof image.listeners.error).toBe('function');
    image.listeners.error();

    expect(image.attributes.srcset).toBeUndefined();
    expect(image.attributes.sizes).toBeUndefined();
    expect(image.src).toBe('/assets/images/collage-venue-640.webp');
    expect(image.attributes['data-fallback-src']).toBeUndefined();
  });
});

describe('wiring', () => {
  test('index.html loads a cache-busted copy of the changed script', () => {
    // Changed asset: its ?v= must move so returning visitors (7-day asset cache)
    // pick it up. The exact number is not pinned.
    expect(INDEX).toMatch(/homepage-approved-lower\.js\?v=\d+/);
  });
});
