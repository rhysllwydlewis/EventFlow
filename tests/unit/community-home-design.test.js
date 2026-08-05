/**
 * Unit tests for the community homepage redesign.
 *
 * Covers the shared client helpers the new hero depends on (`compactCount`,
 * `categoryIcon`, `previewCard`), the `heroImage` field added to discussion
 * cards, and the structural promises the hero markup makes — a single `h1`,
 * a labelled rail for each side, and no second copy of the page heading in
 * the server-rendered fallback.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

/**
 * Load `core.js` and hand back the namespace it exports.
 *
 * The community client is a plain IIFE that hangs its helpers off `window`
 * rather than a CommonJS export, so there is nothing to `require`. It runs in
 * a `vm` context with a stub for the handful of DOM globals it touches while
 * loading rather than under JSDOM: jsdom v28 pulls in an ESM-only dependency
 * that Jest's `node` test environment cannot require. The helpers under test
 * here build strings and never touch the document, so a full DOM would buy
 * nothing.
 * @returns {Object} The `window.EFCommunity` namespace.
 */
function loadCore() {
  const source = fs.readFileSync(path.join(ROOT, 'public/assets/js/community/core.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { dispatchEvent() {} },
    CustomEvent: class {
      /**
       * @param {string} type Event name.
       */
      constructor(type) {
        this.type = type;
      }
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'core.js' });
  return sandbox.window.EFCommunity;
}

describe('compactCount', () => {
  const EFC = loadCore();

  it('leaves counts below a thousand exactly as they are', () => {
    // Rounding 847 to "0.8k" would lose precision a reader can actually use.
    expect(EFC.compactCount(0)).toBe('0');
    expect(EFC.compactCount(1)).toBe('1');
    expect(EFC.compactCount(847)).toBe('847');
    expect(EFC.compactCount(999)).toBe('999');
  });

  it('abbreviates thousands to one decimal place', () => {
    expect(EFC.compactCount(1000)).toBe('1k');
    expect(EFC.compactCount(1234)).toBe('1.2k');
    expect(EFC.compactCount(9949)).toBe('9.9k');
    expect(EFC.compactCount(12000)).toBe('12k');
  });

  it('drops the decimal when rounding lands on a whole unit', () => {
    // "10.0k" is wider than the strip is sized for; 9950 rounds to 10k.
    expect(EFC.compactCount(9950)).toBe('10k');
  });

  it('abbreviates millions', () => {
    expect(EFC.compactCount(1000000)).toBe('1m');
    expect(EFC.compactCount(2500000)).toBe('2.5m');
    // 999,950 rounds up past the thousands range and must not read "1000k".
    expect(EFC.compactCount(999950)).toBe('1m');
  });

  it('treats junk as zero rather than rendering NaN into the page', () => {
    expect(EFC.compactCount(undefined)).toBe('0');
    expect(EFC.compactCount(null)).toBe('0');
    expect(EFC.compactCount('nonsense')).toBe('0');
    expect(EFC.compactCount(-5)).toBe('0');
  });
});

describe('categoryIcon', () => {
  const EFC = loadCore();

  it('uses the line-art glyph for a seeded category', () => {
    const html = EFC.categoryIcon({ slug: 'venues', icon: '🏛️' });
    expect(html).toContain('<svg');
    expect(html).toContain('efc-caticon__glyph');
    expect(html).toContain('aria-hidden="true"');
  });

  it('falls back to the stored emoji for an operator-created category', () => {
    // Operators can add categories the icon map has never heard of; the strip
    // must not render a hole where their icon should be.
    const html = EFC.categoryIcon({ slug: 'sustainability', icon: '🌱' });
    expect(html).toContain('🌱');
    expect(html).toContain('efc-caticon__emoji');
  });

  it('falls back again when the category has no icon at all', () => {
    expect(EFC.categoryIcon({ slug: 'unknown' })).toContain('💬');
    expect(EFC.categoryIcon(null)).toContain('💬');
  });

  it('escapes an icon rather than trusting it as markup', () => {
    const html = EFC.categoryIcon({ slug: 'unknown', icon: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('covers every seeded category slug', () => {
    const { SEED_CATEGORIES } = require('../../models/CommunityContent');
    const missing = SEED_CATEGORIES.filter(c => !EFC.CATEGORY_ICON_PATHS[c.slug]).map(c => c.slug);
    expect(missing).toEqual([]);
  });
});

describe('previewCard', () => {
  const EFC = loadCore();

  const base = {
    stableId: 'abc123',
    url: '/community/discussion/abc123/marquee-hire',
    title: 'Marquee hire in Kent — who did you use?',
    author: { displayName: 'Sam' },
    category: { slug: 'venues', name: 'Venues', icon: '🏛️' },
    replyCount: 2,
    heroImage: null,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  it('links to the discussion and shows its title and author', () => {
    const html = EFC.previewCard(base);
    expect(html).toContain('href="/community/discussion/abc123/marquee-hire"');
    expect(html).toContain('Marquee hire in Kent');
    expect(html).toContain('Sam');
  });

  it('falls back to a category tile when the discussion has no image', () => {
    const html = EFC.previewCard(base);
    expect(html).toContain('efc-preview__thumb--icon');
    expect(html).not.toContain('<img');
  });

  it('uses the discussion image when there is one', () => {
    const html = EFC.previewCard({ ...base, heroImage: { url: '/uploads/tent.jpg', alt: '' } });
    expect(html).toContain('<img');
    expect(html).toContain('/uploads/tent.jpg');
    // Decorative in this context: the title beside it already names the thread.
    expect(html).toContain('alt=""');
  });

  it('pluralises the reply count', () => {
    expect(EFC.previewCard({ ...base, replyCount: 1 })).toContain('1 reply');
    expect(EFC.previewCard({ ...base, replyCount: 0 })).toContain('0 replies');
    expect(EFC.previewCard({ ...base, replyCount: 7 })).toContain('7 replies');
  });

  it('marks a discussion active only when something happened this week', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(EFC.previewCard(base)).toContain('efc-preview__dot');
    expect(EFC.previewCard({ ...base, lastActivityAt: old })).not.toContain('efc-preview__dot');
  });

  it('gives the activity dot a text equivalent', () => {
    // The dot is colour alone otherwise, which fails 1.4.1 Use of Colour.
    expect(EFC.previewCard(base)).toContain('Active this week');
  });

  it('escapes a hostile title rather than injecting it', () => {
    const html = EFC.previewCard({ ...base, title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the community homepage shell', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/community.html'), 'utf8');

  it('declares exactly one h1', () => {
    // The server fallback used to emit a second copy of the page heading, so
    // the page shipped two competing top-level headings.
    expect(html.match(/<h1[\s>]/g) || []).toHaveLength(1);
  });

  it('gives each preview rail its own accessible name', () => {
    expect(html).toContain('aria-label="Recent discussions"');
    expect(html).toContain('aria-label="Popular discussions"');
  });

  it('places the hero card before the rails in the document', () => {
    // Keyboard and screen-reader users reach the h1 and the search field
    // before three secondary preview cards, even though the rails sit either
    // side of the card on a wide screen.
    expect(html.indexOf('efc-stage__card')).toBeLessThan(html.indexOf('efc-rail--left'));
  });

  it('hides the decorative layer from assistive technology', () => {
    expect(html).toMatch(/<div class="efc-stage__decor" aria-hidden="true">/);
  });

  it('does not let the static server inject a second h1', () => {
    // scripts/serve-static.js fills #efc-noscript for the browser suites. It
    // used to hard-code <h1>${title}</h1>, which gave /community two top-level
    // headings once the shell grew a hero heading of its own.
    const serveStatic = fs.readFileSync(path.join(ROOT, 'scripts/serve-static.js'), 'utf8');
    expect(serveStatic).not.toContain('`<h1>${title}</h1>`');
    expect(serveStatic).toContain("/<h1[\\s>]/i.test(html) ? 'h2' : 'h1'");
  });

  it('serves the assets it changed under a fresh cache-busting version', () => {
    // Static CSS/JS is cached for a week. Shipping this markup against the
    // previously cached community.css leaves the hero unstyled, and against
    // the previously cached home.js the rails and category strip never fill.
    expect(html).toContain('community.css?v=18.4.0');
    expect(html).toContain('community/core.js?v=18.4.0');
    expect(html).toContain('community/home.js?v=18.4.0');
    expect(html).toContain('mobile-optimizations.css?v=18.4.0');
  });

  it('exempts the hero search button from the mobile full-width rule', () => {
    const mobile = fs.readFileSync(
      path.join(ROOT, 'public/assets/css/mobile-optimizations.css'),
      'utf8'
    );
    // Without the exemption the submit button went full width and squeezed
    // the search input down to 32px.
    expect(html).toContain('class="efc-searchbtn"');
    expect(mobile).toContain(':not(.efc-searchbtn)');
  });
});

describe('discussion card thumbnails', () => {
  const community = require('../../services/community.service');

  /**
   * Build the minimum discussion a card needs.
   * @param {Object[]|undefined} attachments Attachment records.
   * @returns {Object} Discussion document.
   */
  function discussionWith(attachments) {
    return {
      stableId: 'abc123',
      slug: 'a-thread',
      title: 'A thread',
      author: { displayName: 'Sam' },
      categorySlug: 'venues',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      attachments,
    };
  }

  it('is null when the discussion has no attachments', () => {
    // Uploads are not implemented yet, so this is the live behaviour today.
    expect(community.toDiscussionCard(discussionWith([])).heroImage).toBeNull();
    expect(community.toDiscussionCard(discussionWith(undefined)).heroImage).toBeNull();
  });

  it('picks the first image attachment', () => {
    const card = community.toDiscussionCard(
      discussionWith([
        { kind: 'file', url: '/uploads/notes.pdf' },
        { kind: 'image', url: '/uploads/one.jpg', alt: 'A marquee' },
        { kind: 'image', url: '/uploads/two.jpg' },
      ])
    );
    expect(card.heroImage).toEqual({ url: '/uploads/one.jpg', alt: 'A marquee' });
  });

  it('refuses off-origin and protocol-relative URLs', () => {
    // A card thumbnail is not a place to start fetching arbitrary remote URLs.
    const remote = community.toDiscussionCard(
      discussionWith([{ kind: 'image', url: 'https://evil.example/x.jpg' }])
    );
    const protocolRelative = community.toDiscussionCard(
      discussionWith([{ kind: 'image', url: '//evil.example/x.jpg' }])
    );
    expect(remote.heroImage).toBeNull();
    expect(protocolRelative.heroImage).toBeNull();
  });

  it('survives malformed attachment records', () => {
    const card = community.toDiscussionCard(
      discussionWith([null, { kind: 'image' }, { url: '/x.jpg' }])
    );
    expect(card.heroImage).toBeNull();
  });
});
