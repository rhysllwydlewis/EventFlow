'use strict';

/**
 * The homepage marketplace cards ask the server for a 640 px rendition of a
 * stored photo (GET /api/photos/:id?w=640) instead of the 1200 px original.
 *
 * This runs the real `fetchMarketplacePreview` from home-init.js in a sandbox
 * rather than matching its source: the helper it relies on was once defined
 * inside a different function, which a source-level check cannot see but which
 * throws a ReferenceError at runtime and blanks the marketplace section.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../public/assets/js/pages/home-init.js'),
  'utf8'
);

function sandboxWith(listings) {
  const container = { innerHTML: '', querySelectorAll: () => [] };
  const errors = [];

  // `escape` in home-init.js round-trips text through a div.
  const makeDiv = () => {
    let text = '';
    return {
      set textContent(value) {
        text = String(value);
      },
      get innerHTML() {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  };

  const sandbox = {
    document: {
      getElementById: id => (id === 'marketplace-preview' ? container : null),
      createElement: makeDiv,
      addEventListener: () => {},
    },
    ErrorBoundary: class {
      show(error) {
        errors.push(error);
      }
      hide() {}
    },
    LoadingState: { show: () => {}, hide: () => {} },
    // Shared globals from hero-collage.js, which loads before home-init.js.
    isDebugEnabled: () => false,
    isDevelopmentEnvironment: () => false,
    fetchWithRetry: async () => ({ ok: true, status: 200, json: async () => ({ listings }) }),
    navigator: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { sandbox, container, errors };
}

const listing = (id, extra) => ({
  id,
  title: `Listing ${id}`,
  price: 25,
  category: 'decor',
  ...extra,
});

describe('photoThumbnailUrl (module scope in home-init.js)', () => {
  const { sandbox } = sandboxWith([]);
  const thumb = (url, width) =>
    vm.runInContext(`photoThumbnailUrl(${JSON.stringify(url)}, ${width})`, sandbox);

  test('is reachable from the other top-level functions that use it', () => {
    expect(vm.runInContext('typeof photoThumbnailUrl', sandbox)).toBe('function');
  });

  test('adds the width to a bare stored-photo path', () => {
    expect(thumb('/api/photos/photo_392zjh16srh19o', 640)).toBe(
      '/api/photos/photo_392zjh16srh19o?w=640'
    );
  });

  test.each([
    ['an external URL', 'https://images.pexels.com/photos/1/a.jpeg'],
    ['a placeholder', '/assets/images/collage-venue.jpg'],
    ['a stored path that already has a query', '/api/photos/photo_abc?w=320'],
    ['a stored path with extra segments', '/api/photos/photo_abc/replace'],
    ['an empty string', ''],
    ['a path with unsafe characters', '/api/photos/a"onerror=alert(1)'],
  ])('leaves %s alone', (_label, url) => {
    expect(thumb(url, 640)).toBe(url);
  });

  test.each([[null], [undefined], [42]])('passes %p straight through', value => {
    expect(
      vm.runInContext('photoThumbnailUrl(__v, 640)', Object.assign(sandbox, { __v: value }))
    ).toBe(value);
  });
});

describe('fetchMarketplacePreview', () => {
  test('requests a 640 px rendition for a stored listing photo', async () => {
    const { sandbox, container, errors } = sandboxWith([
      listing('a', { images: ['/api/photos/photo_stored1'] }),
    ]);

    await vm.runInContext('fetchMarketplacePreview()', sandbox);

    expect(errors).toEqual([]);
    expect(container.innerHTML).toContain('src="/api/photos/photo_stored1?w=640"');
    expect(container.innerHTML).not.toContain('src="/api/photos/photo_stored1"');
  });

  test('leaves an external image and the default image untouched', async () => {
    const { sandbox, container, errors } = sandboxWith([
      listing('b', { image: 'https://images.pexels.com/photos/9/pexels-photo-9.jpeg' }),
      listing('c', {}),
    ]);

    await vm.runInContext('fetchMarketplacePreview()', sandbox);

    expect(errors).toEqual([]);
    expect(container.innerHTML).toContain(
      'src="https://images.pexels.com/photos/9/pexels-photo-9.jpeg"'
    );
    expect(container.innerHTML).toContain('src="/assets/images/collage-venue.jpg"');
    expect(container.innerHTML).not.toContain('?w=640"');
  });

  test('renders the cards at all (no ReferenceError swallowed by the error boundary)', async () => {
    const { sandbox, container, errors } = sandboxWith([
      listing('d', { photos: ['/api/photos/photo_stored2'] }),
      listing('e', { images: ['/api/photos/photo_stored3'] }),
    ]);

    await vm.runInContext('fetchMarketplacePreview()', sandbox);

    expect(errors).toEqual([]);
    expect(container.innerHTML).toContain('Listing d');
    expect(container.innerHTML).toContain('Listing e');
    expect(container.innerHTML).toContain('photo_stored2?w=640');
    expect(container.innerHTML).toContain('photo_stored3?w=640');
  });
});
