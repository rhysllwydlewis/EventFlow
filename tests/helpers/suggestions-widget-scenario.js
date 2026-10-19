'use strict';

/**
 * Runs the real "Suggested for you" widget (recommendations-widget.js with the shared supplier
 * avatar and link helpers) in jsdom against a mocked API and prints what it rendered as JSON.
 * Run in a child process, like the other jsdom scenarios here, because jsdom's dependencies are
 * ES modules that Jest cannot load.
 *
 * usage: node suggestions-widget-scenario.js <base64 json {results, dataset, failImages}>
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const script = file => fs.readFileSync(path.join(root, 'public/assets/js', file), 'utf8');

async function main() {
  const scenario = JSON.parse(Buffer.from(process.argv[2] || 'e30=', 'base64').toString('utf8'));
  const dom = new JSDOM(
    '<!doctype html><body><section id="recommendations-widget" hidden></section></body>',
    { url: 'http://localhost/dashboard/customer', runScripts: 'outside-only' }
  );
  const { window } = dom;
  const requested = [];
  window.fetch = async url => {
    requested.push(String(url));
    if (scenario.apiFails) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ data: { results: scenario.results } }) };
  };
  Object.entries(scenario.dataset || {}).forEach(([key, value]) => {
    window.document.getElementById('recommendations-widget').dataset[key] = value;
  });

  // The widget logs from a page on localhost; keep stdout for the JSON result only.
  window.console.log = () => {};
  window.console.error = () => {};

  window.eval(script('utils/supplier-avatar.js'));
  window.eval(script('utils/supplier-link.js'));
  window.eval(script('recommendations-widget.js'));
  await window.RecommendationsWidget.init();
  for (let i = 0; i < 4; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const widget = window.document.getElementById('recommendations-widget');
  if (scenario.failImages) {
    widget.querySelectorAll('.recommendation-avatar-wrap img').forEach(img => {
      img.dispatchEvent(new window.Event('error'));
    });
  }

  const describeAvatar = card => {
    const img = card.querySelector('img.recommendation-avatar');
    if (img) {
      return { kind: 'photo', src: img.getAttribute('src'), alt: img.getAttribute('alt') };
    }
    const fallback = card.querySelector('.recommendation-avatar--fallback');
    return {
      kind: 'initials',
      text: fallback ? fallback.textContent : null,
      background: fallback ? fallback.style.background || fallback.style.backgroundImage : null,
      hiddenFromScreenReaders: fallback ? fallback.getAttribute('aria-hidden') === 'true' : null,
    };
  };

  console.log(
    JSON.stringify({
      requested,
      hidden: widget.hidden,
      seeAll: widget.querySelector('.recommendations-view-all')?.getAttribute('href') || null,
      cards: [...widget.querySelectorAll('.recommendation-card')].map(card => ({
        href: card.getAttribute('href'),
        label: card.getAttribute('aria-label'),
        name: card.querySelector('.recommendation-card__name').textContent,
        category: card.querySelector('.recommendation-card__category')?.textContent || null,
        reason: card.querySelector('.recommendation-card__reason')?.textContent || null,
        avatar: describeAvatar(card),
        elementCount: card.querySelectorAll('*').length,
        imageCount: card.querySelectorAll('img').length,
      })),
    })
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
