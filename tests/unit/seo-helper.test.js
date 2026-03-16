/**
 * Unit tests for SEOHelper.setTitle deduplication logic (seo-helper.js)
 *
 * Validates that setTitle() never appends "— EventFlow" when the brand is
 * already present in the supplied title string.
 */

'use strict';

// Provide a minimal browser-like environment so seo-helper.js can be required
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><head><title></title></head><body></body></html>', {
  url: 'https://event-flow.co.uk',
});
global.window = dom.window;
global.document = dom.window.document;

const SEOHelper = require('../../public/assets/js/utils/seo-helper');

function makeHelper() {
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
