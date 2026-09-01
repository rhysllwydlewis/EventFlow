'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('FAQ page regressions', () => {
  it('keeps JSON-LD, search headings, no-results, links, and category filtering in sync', () => {
    runNodeSmoke(String.raw`
      const assert = require('assert');
      const fs = require('fs');
      const { JSDOM } = require('jsdom');
      const html = fs.readFileSync('public/faq.html', 'utf8');
      const dom = new JSDOM(html, { url: 'https://event-flow.co.uk/faq', runScripts: 'outside-only' });
      const document = dom.window.document;
      const DomEvent = dom.window.Event;
      const visibleQuestions = [...document.querySelectorAll('.faq-item summary')].map(el => el.textContent.trim());
      const jsonLd = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
      assert.strictEqual(visibleQuestions.length, 31);
      assert.strictEqual(jsonLd.mainEntity.length, visibleQuestions.length);
      assert.deepStrictEqual(jsonLd.mainEntity.map(entity => entity.name), visibleQuestions);

      dom.window.TextHighlighting = {
        highlightQuery: (text, query) => text.replace(new RegExp(query, 'gi'), '<mark>$&</mark>'),
      };
      dom.window.eval(fs.readFileSync('public/assets/js/pages/faq-search-init.js', 'utf8'));
      dom.window.eval(fs.readFileSync('public/assets/js/pages/faq-category-filter.js', 'utf8'));
      document.dispatchEvent(new DomEvent('DOMContentLoaded', { bubbles: true }));

      const search = document.getElementById('faq-search');
      const noResults = document.getElementById('faq-no-results');
      search.value = 'budget';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      const visibleItems = [...document.querySelectorAll('.faq-item')].filter(item => item.style.display !== 'none');
      const visibleHeadings = [...document.querySelectorAll('.faq-group-heading')].filter(heading => heading.style.display !== 'none');
      assert(visibleItems.length > 0);
      assert(visibleItems.every(item => item.textContent.toLowerCase().includes('budget')));
      assert.deepStrictEqual(visibleHeadings.map(heading => heading.dataset.group), ['getting-started', 'planning']);
      assert.strictEqual(noResults.hidden, true);

      search.value = 'privacy';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      const dataSafetyAnswer = [...document.querySelectorAll('.faq-item')].find(item => item.querySelector('summary').textContent.includes('Is my data safe'));
      assert(dataSafetyAnswer.querySelector('a[href="/privacy"]'));
      assert(dataSafetyAnswer.querySelector('a[href="/legal"]'));

      search.value = 'definitelynotarealfaqquery';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      assert.strictEqual(noResults.hidden, false);
      assert.strictEqual(document.getElementById('faq-list').hidden, true);

      search.value = '';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      assert.strictEqual(noResults.hidden, true);
      assert.strictEqual(document.getElementById('faq-list').hidden, false);

      search.value = 'budget';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      document.querySelector('.faq-filter-btn[data-filter="suppliers"]').click();
      const categoryHeadings = [...document.querySelectorAll('.faq-group-heading')].filter(heading => heading.style.display !== 'none');
      const categoryItems = [...document.querySelectorAll('.faq-item')].filter(item => !item.hidden);
      assert.strictEqual(search.value, '');
      assert.deepStrictEqual(categoryHeadings.map(heading => heading.dataset.group), ['suppliers']);
      assert.strictEqual(categoryItems.length, 5);
      assert(categoryItems.every(item => item.dataset.category === 'suppliers'));

      search.value = 'privacy';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      const privacyItems = [...document.querySelectorAll('.faq-item')].filter(item => item.style.display !== 'none' && !item.hidden);
      assert(privacyItems.some(item => item.dataset.category === 'account'));

      // Marketplace category: filter button exists, filters to the right items,
      // and every item links back to /marketplace or /suppliers where relevant.
      search.value = '';
      search.dispatchEvent(new DomEvent('input', { bubbles: true }));
      const marketplaceBtn = document.querySelector('.faq-filter-btn[data-filter="marketplace"]');
      assert(marketplaceBtn, 'expected a Marketplace filter button');
      marketplaceBtn.click();
      const marketplaceHeadings = [...document.querySelectorAll('.faq-group-heading')].filter(h => h.style.display !== 'none');
      const marketplaceItems = [...document.querySelectorAll('.faq-item')].filter(item => !item.hidden);
      assert.deepStrictEqual(marketplaceHeadings.map(h => h.dataset.group), ['marketplace']);
      assert.strictEqual(marketplaceItems.length, 5);
      assert(marketplaceItems.every(item => item.dataset.category === 'marketplace'));
      const whatIsMarketplace = marketplaceItems.find(item => item.querySelector('summary').textContent.includes('What is the Marketplace'));
      assert(whatIsMarketplace.querySelector('a[href="/marketplace"]'));
      assert(whatIsMarketplace.querySelector('a[href="/suppliers"]'));

      // Filter button (N) counts are populated from the actual DOM, not hardcoded,
      // and stay in sync with the underlying item counts.
      const countFor = filter => document.querySelectorAll('.faq-item[data-category="' + filter + '"]').length;
      document.querySelectorAll('.faq-filter-btn[data-filter]').forEach(btn => {
        const filter = btn.dataset.filter;
        const countEl = btn.querySelector('.faq-filter-count');
        assert(countEl, 'expected a count element on the "' + filter + '" filter button');
        const expected = filter === 'all' ? document.querySelectorAll('.faq-item[data-category]').length : countFor(filter);
        assert.strictEqual(countEl.textContent.trim(), '(' + expected + ')');
      });

      // Reset back to "All topics" and confirm every category is represented.
      document.querySelector('.faq-filter-btn[data-filter="all"]').click();
      const allGroups = [...document.querySelectorAll('.faq-group-heading[data-group]')].map(h => h.dataset.group);
      assert.deepStrictEqual(allGroups, ['getting-started', 'planning', 'suppliers', 'marketplace', 'for-suppliers', 'account']);
    `);
  });
});
