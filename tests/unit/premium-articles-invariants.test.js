/**
 * Invariants every article on the premium template must hold, checked across
 * every such article — not just the one `guide-premium-template.test.js`
 * happens to be scoped to.
 *
 * That file is a deep, article-specific test of the reference implementation
 * (event-travel-costs-guide.html): it pins exact figures, exact copy, the
 * calculator's split from the core template. It was never meant to catch a
 * *second* article getting the structural basics wrong, and converting
 * wedding-venue-selection-guide.html exposed exactly that gap — nothing here
 * verified TOC/section agreement, stylesheet order or JSON-LD validity on
 * anything but the one reference file.
 *
 * As more legacy articles move onto this template, this file is what keeps
 * each new one honest without hand-deriving the same checks again.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const ARTICLES_DIR = path.join(ROOT, 'public/articles');
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/assets/data/guides.json'), 'utf8')
);

/**
 * Every article currently on the premium template.
 * @returns {Array<{name: string, html: string}>} The articles.
 */
function premiumArticles() {
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter(name => name.endsWith('.html'))
    .map(name => ({ name, html: fs.readFileSync(path.join(ARTICLES_DIR, name), 'utf8') }))
    .filter(article => article.html.includes('<body class="gp-page">'));
}

const articles = premiumArticles();

describe('every article on the premium template', () => {
  test('at least the known pilots are being checked', () => {
    // Guards the rest of the file: if the gp-page detection above ever stops
    // matching anything, every test below would pass vacuously.
    expect(articles.length).toBeGreaterThanOrEqual(2);
  });

  test.each(articles.map(a => [a.name, a.html]))('%s opts in correctly', (_name, html) => {
    expect(html).toContain('<body class="gp-page">');
    expect(html).toMatch(/<article class="gp( gp--numbered)?" data-gp-article>/);
    // The legacy layout's card-based article rules (e.g. `article header > div`)
    // conflict with the premium hero — a converted article must not load both.
    expect(html).not.toContain('/assets/css/guides.css');
  });

  test.each(articles.map(a => [a.name, a.html]))(
    '%s loads its stylesheets and script in order',
    (_name, html) => {
      const base = html.indexOf('/assets/css/guide-premium.css');
      const hardening = html.indexOf('/assets/css/guide-premium-hardening.css');
      const script = html.indexOf('/assets/js/pages/guide-premium.js');
      expect(base).toBeGreaterThan(-1);
      expect(hardening).toBeGreaterThan(base);
      expect(script).toBeGreaterThan(hardening);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: the rail contents, mobile contents and sections agree',
    (_name, html) => {
      const sectionIds = [...html.matchAll(/data-gp-section id="([^"]+)"/g)].map(m => m[1]);
      expect(sectionIds.length).toBeGreaterThan(1);

      const railTargets = [...html.matchAll(/class="gp-toc__link" href="#([^"]+)"/g)].map(
        m => m[1]
      );
      expect(railTargets).toEqual(sectionIds);

      // The mobile <details><ol> list is the only <li><a href="#..."> pattern
      // in these articles, so this does not need to be scoped further.
      const mobileTargets = [...html.matchAll(/<li><a href="#([^"]+)">/g)].map(m => m[1]);
      expect(mobileTargets).toEqual(sectionIds);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: every JSON-LD block is valid JSON',
    (_name, html) => {
      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ];
      expect(blocks.length).toBeGreaterThan(0);
      for (const [, body] of blocks) {
        expect(() => JSON.parse(body)).not.toThrow();
      }
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: an FAQ block, if present, matches its FAQPage schema exactly',
    (_name, html) => {
      const faqStart = html.indexOf('<div class="gp-faq">');
      if (faqStart === -1) {
        return;
      }
      // .gp-cta always follows .gp-faq in this template — see docs/ARTICLE_TEMPLATE.md.
      const faqBlock = html.slice(faqStart, html.indexOf('<div class="gp-cta', faqStart));
      const renderedQuestions = [...faqBlock.matchAll(/<summary>([^<]+)<\/summary>/g)].map(
        m => m[1]
      );

      const blocks = [
        ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
      ];
      const faqSchema = blocks
        .map(b => JSON.parse(b[1]))
        .find(entry => entry['@type'] === 'FAQPage');

      expect(faqSchema).toBeDefined();
      expect(faqSchema.mainEntity.map(item => item.name)).toEqual(renderedQuestions);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: a hero image, if present, serves responsive candidates',
    (_name, html) => {
      const hero = html.match(/<img[^>]+class="gp-hero__img"[^>]+>/)?.[0];
      if (!hero) {
        return;
      }
      expect(hero).toContain('srcset=');
      expect(hero).toContain('sizes="100vw"');
      // At least two distinct width descriptors — a single-candidate srcset
      // is the fixed-payload problem this check exists to catch, just spelled
      // as one <img> attribute instead of none.
      const widths = [...hero.matchAll(/(\d+)w/g)];
      expect(widths.length).toBeGreaterThanOrEqual(2);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: the kicker is plain text, not a decorated badge',
    (_name, html) => {
      const eyebrow = html.match(/<p class="gp-eyebrow">([^<]*)<\/p>/)?.[1];
      expect(eyebrow).toBeDefined();
      expect(eyebrow.trim().length).toBeGreaterThan(0);
      // No emoji: docs/ARTICLE_TEMPLATE.md calls this "plain text — not a
      // badge" precisely because the legacy category badges it replaces were
      // emoji-prefixed (🏛️ Venues, 🌿 Sustainability, ...).
      expect(eyebrow).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: the fourth meta item, if present, states the manifest difficulty verbatim',
    (_name, html) => {
      // The rail's optional fourth .gp-meta__item (after author, published
      // date, reading time) is a difficulty indicator. It has drifted once
      // already — "Beginner friendly" on one article, bare "Intermediate" on
      // another, for the same manifest field — so this pins the convention:
      // the badge is the manifest's own word, nothing appended, so it is
      // real, traceable data rather than invented copy.
      //
      // Extraction is boundary-based rather than matched-closing-tag based:
      // the reading-time item nests its own <span id="article-reading-time">,
      // which a non-greedy `.*?</span>` match closes on instead of the outer
      // span — so each item's text is everything between its opening tag and
      // the next item's opening tag (or the wrapper's close, for the last).
      const openTag = '<span class="gp-meta__item">';
      const starts = [...html.matchAll(/<span class="gp-meta__item">/g)].map(m => m.index);
      if (starts.length < 4) {
        return;
      }
      const wrapperStart = html.indexOf('<div class="gp-meta');
      const wrapperEnd = html.indexOf('</div>', starts[starts.length - 1]);
      expect(wrapperStart).toBeGreaterThan(-1);
      expect(wrapperEnd).toBeGreaterThan(starts[starts.length - 1]);

      const itemBounds = starts.map((start, i) =>
        i + 1 < starts.length ? starts[i + 1] : wrapperEnd
      );
      let badgeText = html.slice(starts[3] + openTag.length, itemBounds[3]);
      let previous;
      do {
        previous = badgeText;
        badgeText = badgeText.replace(/<[^>]+>/g, '');
      } while (badgeText !== previous);
      badgeText = badgeText.trim();

      const canonical = html.match(
        /<link href="(https:\/\/event-flow\.co\.uk\/articles\/[^"]+)" rel="canonical"\/>/
      )?.[1];
      expect(canonical).toBeDefined();
      const href = canonical.replace('https://event-flow.co.uk', '');
      const entry = MANIFEST.find(g => g.href === href);
      expect(entry).toBeDefined();
      expect(entry.difficulty).toBeDefined();
      expect(badgeText).toBe(entry.difficulty);
    }
  );

  test.each(articles.map(a => [a.name, a.html]))(
    '%s: at least one print control exists',
    (_name, html) => {
      expect((html.match(/data-gp-print/g) || []).length).toBeGreaterThanOrEqual(1);
    }
  );
});
