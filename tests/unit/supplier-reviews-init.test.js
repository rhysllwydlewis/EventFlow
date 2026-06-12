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

describe('supplier review management frontend', () => {
  it('validates reply length, uses /api/csrf-token, and refreshes analytics after posting', () => {
    runNodeSmoke(String.raw`
      const assert = require('assert');
      const fs = require('fs');
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM('<!doctype html><div id="supplier-reviews-section"></div>', {
        url: 'https://event-flow.co.uk/dashboard-supplier',
        runScripts: 'outside-only',
      });
      const { document } = dom.window;
      const calls = [];
      function reviewsPayload(responseRate = 0) {
        return { data: { reviews: [{ _id: 'rev-1', rating: 4, title: 'Helpful team', text: 'They were excellent on the day.', authorName: 'A Customer', createdAt: '2026-06-01T12:00:00.000Z', votes: {} }], pagination: { total: 1, page: 1, pages: 1, limit: 10 }, analytics: { avgRating: 4, totalReviews: 1, responseRate, ratingDistribution: [0, 0, 0, 1, 0] } } };
      }
      dom.window.fetch = async (url, options = {}) => {
        calls.push([String(url), options]);
        if (String(url).startsWith('/api/v2/reviews/supplier/')) {
          const responseRate = calls.some(call => call[1]?.method === 'POST') ? 0.5 : 0;
          return { ok: true, json: async () => reviewsPayload(responseRate) };
        }
        if (url === '/api/csrf-token') return { ok: true, json: async () => ({ csrfToken: 'csrf-from-system-route' }) };
        if (url === '/api/v2/reviews/rev-1/response' && options.method === 'POST') return { ok: true, json: async () => ({ success: true }) };
        throw new Error('Unexpected fetch: ' + url);
      };
      dom.window.eval(fs.readFileSync('public/assets/js/pages/supplier-reviews-init.js', 'utf8'));
      (async () => {
        await dom.window.SupplierReviews.init('sup-1', 'supplier-reviews-section');
        document.querySelector('.sr-reply-btn').click();
        document.querySelector('.sr-reply-textarea').value = 'Thanks';
        document.querySelector('.sr-reply-submit').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert(document.querySelector('.sr-reply-status').textContent.includes('at least 10 characters'));
        assert.strictEqual(calls.length, 1);

        document.querySelector('.sr-reply-textarea').value = 'Thank you for the thoughtful review.';
        document.querySelector('.sr-reply-submit').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
        const postCall = calls.find(call => call[1]?.method === 'POST');
        assert(calls.some(call => call[0] === '/api/csrf-token'));
        assert.strictEqual(postCall[1].headers['X-CSRF-Token'], 'csrf-from-system-route');
        assert.strictEqual(document.querySelector('.sr-stat-value').textContent, '50%');
      })().catch(error => { console.error(error); process.exit(1); });
    `);
  });
});
