/**
 * Unit tests for SEOHelper.setTitle deduplication logic (seo-helper.js)
 *
 * Validates that setTitle() never appends "— EventFlow" when the brand is
 * already present in the supplied title string.
 */

/* global document */
'use strict';

// Minimal DOM stub — Jest runs in Node (testEnvironment: 'node') so we mock
// only the document APIs that seo-helper.js actually touches.
let _title = '';
const _metaStore = {};

global.window = {
  location: { hostname: 'localhost', origin: 'https://event-flow.co.uk' },
  EF_CANONICAL_BASE: 'https://event-flow.co.uk',
};

global.document = {
  get title() {
    return _title;
  },
  set title(v) {
    _title = v;
  },
  querySelector: sel => {
    // Return a minimal meta stub or null
    const key = sel
      .replace(/^meta\[property="(.+)"\]$/, '$1')
      .replace(/^meta\[name="(.+)"\]$/, '$1')
      .replace(/^link\[rel="canonical"\]$/, '__canonical__');
    return _metaStore[key] || null;
  },
  createElement: tag => {
    const el = { tagName: tag, _attrs: {}, textContent: '' };
    el.setAttribute = (k, v) => {
      el._attrs[k] = v;
    };
    el.getAttribute = k => el._attrs[k] || null;
    return el;
  },
  head: {
    appendChild: el => {
      // Track created meta tags by property/name
      const key = el._attrs && (el._attrs.property || el._attrs.name);
      if (key) {
        _metaStore[key] = el;
      }
    },
  },
};

const SEOHelper = require('../../public/assets/js/utils/seo-helper');

function makeHelper() {
  // Reset title and meta store for each helper
  _title = '';
  Object.keys(_metaStore).forEach(k => delete _metaStore[k]);
  return new SEOHelper();
}

describe('SEOHelper.setTitle — deduplication', () => {
  test('appends brand suffix to a plain unbranded title', () => {
    const h = makeHelper();
    h.setTitle('Plan your event the simple way');
    expect(document.title).toBe('Plan your event the simple way — EventFlow');
  });

  test('does NOT duplicate brand when title already ends with "— EventFlow"', () => {
    const h = makeHelper();
    h.setTitle('EventFlow — Plan your event the simple way');
    expect(document.title).toBe('EventFlow — Plan your event the simple way');
  });

  test('does NOT duplicate brand when title ends with "| EventFlow"', () => {
    const h = makeHelper();
    h.setTitle('Find UK Suppliers | EventFlow');
    expect(document.title).toBe('Find UK Suppliers | EventFlow');
  });

  test('does NOT duplicate brand (case-insensitive check)', () => {
    const h = makeHelper();
    h.setTitle('Something — eventflow');
    expect(document.title).toBe('Something — eventflow');
  });

  test('does NOT duplicate brand when title starts with "EventFlow —"', () => {
    const h = makeHelper();
    h.setTitle('EventFlow — Plan your event');
    expect(document.title).toBe('EventFlow — Plan your event');
  });

  test('skips suffix entirely when includeSiteName=false', () => {
    const h = makeHelper();
    h.setTitle('Custom Title', false);
    expect(document.title).toBe('Custom Title');
  });

  test('setAll respects includeSiteName:false', () => {
    const h = makeHelper();
    h.setAll({ title: 'My Page', includeSiteName: false });
    expect(document.title).toBe('My Page');
  });

  test('setAll appends brand for plain title when includeSiteName is omitted', () => {
    const h = makeHelper();
    h.setAll({ title: 'My Page' });
    expect(document.title).toBe('My Page — EventFlow');
  });
});
