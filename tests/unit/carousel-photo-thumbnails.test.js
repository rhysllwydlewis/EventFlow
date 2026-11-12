'use strict';

/**
 * Package cards on the homepage ask the server for a 640 px rendition of a
 * stored photo (GET /api/photos/:id?w=640) instead of the 1200 px original.
 * This drives the real `Carousel._renderItem`, so a helper that is out of
 * scope fails here as it would on the page.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../public/assets/js/components/carousel.js'),
  'utf8'
);

const PLACEHOLDER = '/assets/images/placeholders/package-event.svg';

function renderer(globals = {}) {
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
    document: { createElement: makeDiv, addEventListener: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    ...globals,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  // `_renderItem` needs no instance state, so skip the constructor's DOM work.
  const instance = Object.create(sandbox.Carousel.prototype);
  return item => instance._renderItem(item);
}

const imgSrc = html => (html.match(/<img src="([^"]*)"/) || [])[1];
const pkg = extra => ({ id: 'p1', slug: 'wedding-day', title: 'Wedding day', ...extra });

describe('Carousel package card image', () => {
  const render = renderer();

  test('requests a 640 px rendition of a stored photo', () => {
    const html = render(pkg({ image: '/api/photos/photo_392zjh16srh19o' }));
    expect(imgSrc(html)).toBe('/api/photos/photo_392zjh16srh19o?w=640');
  });

  test('does the same for a stored photo found in the gallery', () => {
    const html = render(pkg({ gallery: [{ url: '/api/photos/photo_in_gallery' }] }));
    expect(imgSrc(html)).toBe('/api/photos/photo_in_gallery?w=640');
  });

  test.each([
    ['an external image', 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg'],
    ['an uploaded file path', '/uploads/packages/wedding.jpg'],
    ['a stored photo that already asks for a width', '/api/photos/photo_abc?w=320'],
  ])('leaves %s as it was', (_label, image) => {
    expect(imgSrc(render(pkg({ image })))).toBe(image);
  });

  test('keeps the placeholder when there is no image', () => {
    expect(imgSrc(render(pkg({})))).toBe(PLACEHOLDER);
  });

  test('still blocks a javascript: URL', () => {
    expect(imgSrc(render(pkg({ image: 'javascript:alert(1)' })))).toBe(PLACEHOLDER);
  });

  test('uses the shared package image resolver when it is loaded, and thumbnails its result', () => {
    const withResolver = renderer({ resolvePackageImage: () => '/api/photos/photo_from_resolver' });
    expect(imgSrc(withResolver(pkg({})))).toBe('/api/photos/photo_from_resolver?w=640');
  });

  test('keeps the lazy-loading and the placeholder fallback on the image', () => {
    const html = render(pkg({ image: '/api/photos/photo_x' }));
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`data-fallback-src="${PLACEHOLDER}"`);
  });
});
