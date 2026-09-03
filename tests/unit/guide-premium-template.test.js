'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const ARTICLE = 'public/articles/event-travel-costs-guide.html';
const CSS = 'public/assets/css/guide-premium.css';
const TS = 'src/guides/guide-premium.ts';
const JS = 'public/assets/js/pages/guide-premium.js';

describe('premium guide template', () => {
  const html = read(ARTICLE);
  const css = read(CSS);
  const ts = read(TS);
  const js = read(JS);

  test('the trial article opts into the template and loads its assets', () => {
    expect(html).toContain('<body class="gp-page">');
    expect(html).toContain('<article class="gp" data-gp-article>');
    expect(html).toContain('/assets/css/guide-premium.css');
    expect(html).toContain('/assets/js/pages/guide-premium.js');
    // The template is a standalone trial: it must not inherit the legacy
    // card-layout article rules in guides.css (e.g. `article header > div`,
    // which centres the hero and adds a stray 32px margin).
    expect(html).not.toContain('/assets/css/guides.css');
  });

  test('the compiled browser bundle stays in sync with its TypeScript source', () => {
    const names = source => (source.match(/function (init[A-Za-z]+)/g) || []).sort();
    expect(names(js)).toEqual(names(ts));
    expect(names(ts).length).toBeGreaterThan(0);
    expect(js).toContain('guide-premium.ts');
  });

  test('every contents link points at a section that exists', () => {
    const sectionIds = [...html.matchAll(/data-gp-section id="([^"]+)"/g)].map(match => match[1]);
    expect(sectionIds.length).toBeGreaterThan(3);

    const tocTargets = [...html.matchAll(/class="gp-toc__link" href="#([^"]+)"/g)].map(m => m[1]);
    expect(tocTargets).toEqual(sectionIds);

    const mobileTargets = [...html.matchAll(/<li><a href="#([^"]+)">/g)].map(m => m[1]);
    expect(mobileTargets).toEqual(sectionIds);
  });

  test('the FAQ schema matches the questions rendered on the page', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faq = blocks
      .map(block => JSON.parse(block[1]))
      .find(entry => entry['@type'] === 'FAQPage');
    expect(faq).toBeDefined();

    const schemaQuestions = faq.mainEntity.map(item => item.name);
    // Scope to the FAQ block so the contents disclosure's summary isn't counted.
    const faqBlock = html.slice(
      html.indexOf('<div class="gp-faq">'),
      html.indexOf('<div class="gp-cta')
    );
    const renderedQuestions = [...faqBlock.matchAll(/<summary>([^<]+)<\/summary>/g)].map(m => m[1]);
    expect(renderedQuestions).toEqual(schemaQuestions);
    expect(schemaQuestions.length).toBeGreaterThan(2);
  });

  test('motion is opt-out and reveal animations degrade to visible content', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    // Reveal is driven by the scroll timeline, so browsers without support
    // render the prose normally instead of leaving it stuck at opacity 0.
    expect(css).toContain('@supports (animation-timeline: view())');
    expect(css).not.toMatch(/\.gp-reveal\s*\{[^}]*opacity:\s*0/);
    expect(ts).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  test('the calculator uses the same constants the article quotes', () => {
    expect(ts).toContain('LITRES_PER_GALLON = 4.54609');
    expect(ts).toContain('HMRC_RATE_PER_MILE = 0.45');
    expect(html).toContain('45p per mile for the first 10,000 business miles');
    expect(html).toContain('4.54609 litres per gallon');
  });

  test('the fuelcosts.co.uk reference stays a plain editorial link', () => {
    const links = [...html.matchAll(/<a href="https:\/\/fuelcosts\.co\.uk"([^>]*)>/g)];
    expect(links.length).toBeGreaterThan(0);
    for (const [, attrs] of links) {
      expect(attrs).toContain('rel="noopener noreferrer"');
      expect(attrs).toContain('target="_blank"');
      expect(attrs).not.toContain('nofollow');
    }
  });
});
