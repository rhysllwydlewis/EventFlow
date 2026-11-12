/**
 * Carousel._renderItem – HTML attribute escaping
 *
 * The package image URL and title are interpolated into `<img src="..." alt="...">`.
 * They must be escaped for quotes as well as &, < and >, otherwise a value
 * containing `"` breaks out of the attribute and can inject e.g. `onerror=`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAROUSEL_JS = path.join(__dirname, '../../public/assets/js/components/carousel.js');

function loadCarousel() {
  const source = fs.readFileSync(CAROUSEL_JS, 'utf8');
  // Minimal DOM: escapeHtml() in carousel.js uses textContent -> innerHTML.
  const document = {
    createElement() {
      let text = '';
      return {
        set textContent(value) {
          text = String(value);
        },
        get innerHTML() {
          return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
      };
    },
  };
  const sandbox = { window: {}, document, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.Carousel;
}

function render(item) {
  const Carousel = loadCarousel();
  const instance = Object.create(Carousel.prototype);
  return instance._renderItem(item);
}

/** Parse the attributes of the first <img ...> tag, honouring quoting. */
function imgAttributes(html) {
  const tag = html.match(/<img\b([^>]*)>/)[1];
  const attrs = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1]] = m[2];
  }
  return { attrs, tag };
}

describe('Carousel._renderItem attribute escaping', () => {
  it('does not let a double quote in the image URL add an attribute', () => {
    const html = render({
      title: 'T',
      image: 'https://example.com/a.jpg" onerror="alert(1)',
    });
    const { attrs } = imgAttributes(html);
    expect(Object.keys(attrs).sort()).toEqual([
      'alt',
      'data-fallback-src',
      'decoding',
      'loading',
      'src',
    ]);
    expect(attrs).not.toHaveProperty('onerror');
    expect(attrs.src).toBe('https://example.com/a.jpg&quot; onerror=&quot;alert(1)');
    expect((html.match(/<img\b/g) || []).length).toBe(1);
  });

  it('escapes single quotes and angle brackets in the image URL', () => {
    const html = render({ title: 'T', image: "https://example.com/a.jpg' onerror='x'><script>" });
    const { attrs, tag } = imgAttributes(html);
    expect(tag).not.toContain("'");
    expect(tag).not.toContain('<');
    expect(attrs.src).toContain('&#39;');
    expect(attrs.src).toContain('&lt;script&gt;');
  });

  it('applies the same escaping to gallery images', () => {
    const html = render({
      title: 'T',
      image: '/assets/images/placeholders/package-event.svg',
      gallery: ['https://example.com/g.jpg" onerror="alert(1)'],
    });
    expect(imgAttributes(html).attrs).not.toHaveProperty('onerror');
  });

  it('escapes quotes in the title used for the alt attribute', () => {
    const html = render({
      title: `A "quoted" and 'single' title" onerror="alert(1)`,
      image: '/a.jpg',
    });
    const { attrs } = imgAttributes(html);
    expect(Object.keys(attrs).sort()).toEqual([
      'alt',
      'data-fallback-src',
      'decoding',
      'loading',
      'src',
    ]);
    expect(attrs).not.toHaveProperty('onerror');
    expect(attrs.alt).toContain('&quot;quoted&quot;');
    expect(attrs.alt).toContain('&#39;single&#39;');
  });

  it('leaves normal URLs unchanged', () => {
    for (const url of [
      'https://example.com/photos/a.jpg',
      '/api/photos/abc123?w=640',
      '/uploads/packages/pkg_1.webp',
    ]) {
      const { attrs } = imgAttributes(render({ title: 'T', image: url }));
      expect(attrs.src).toBe(url);
    }
  });

  it('escapes & in query strings as &amp; (valid HTML, same URL once parsed)', () => {
    const { attrs } = imgAttributes(render({ title: 'T', image: '/api/photos/abc?w=640&h=480' }));
    expect(attrs.src).toBe('/api/photos/abc?w=640&amp;h=480');
  });

  it('still blocks javascript:/data: URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>']) {
      const { attrs } = imgAttributes(render({ title: 'T', image: url }));
      expect(attrs.src).toBe('/assets/images/placeholders/package-event.svg');
    }
  });

  it('still escapes the title in element text', () => {
    const html = render({ title: '<b>Hi</b>', image: '/a.jpg' });
    expect(html).toContain('<h3>&lt;b&gt;Hi&lt;/b&gt;</h3>');
  });
});
