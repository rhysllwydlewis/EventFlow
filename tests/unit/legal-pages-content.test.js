'use strict';

/**
 * Content regressions on the legal pages are silent: a policy that describes
 * behaviour the product no longer has still renders perfectly. These tests pin
 * the claims that were found to have drifted from the implementation, so a
 * future product change breaks a test rather than a promise to visitors.
 *
 * See docs/legal-review-2026-09.md for the review that produced them.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const legal = read('public/legal.html');
const privacy = read('public/privacy.html');
const terms = read('public/terms.html');
const consentScript = read('public/assets/js/cookie-consent.js');
const adsScript = read('public/assets/js/google-ads-tag.js');
const legalStyles = read('public/assets/css/legal-pages.css');

describe('advertising disclosure', () => {
  it('does not claim the site is free of advertising cookies', () => {
    // True until the Google Ads tag landed; false from that day on.
    expect(legal).not.toMatch(/do not use advertising cookies/i);
  });

  it('discloses the Google Ads tag wherever a visitor would look for it', () => {
    expect(legal).toMatch(/Google Ads conversion tag/);
    expect(privacy).toMatch(/<strong>Google Ads:<\/strong>/);
    // The international-transfer table has to list it too.
    expect(privacy).toMatch(/Google Ads \(Consented Advertising\)/);
  });

  it('describes advertising as a consent choice separate from analytics', () => {
    expect(legal).toMatch(/Advertising Cookies \(With Your Consent\)/);
    expect(legal).toMatch(/separate choice from analytics/i);
    expect(privacy).toMatch(/Analytics and advertising are separate choices/);
  });

  it('keeps the advertising tag gated on the marketing category in code', () => {
    // A page that promises a separate advertising choice is only accurate while
    // the tag reads `marketing` rather than `analytics`.
    expect(adsScript).toMatch(/getConsent\(\)\?\.marketing/);
    expect(adsScript).not.toMatch(/consent\?\.analytics/);
    expect(consentScript).toMatch(/cookie-pref-marketing/);
  });
});

describe('unclaimed supplier listings', () => {
  it('has a Legal Hub section reachable from the sidebar', () => {
    expect(legal).toContain('id="unclaimed-listings"');
    expect(legal).toContain('href="#unclaimed-listings"');
  });

  it('gives the Article 14 transparency information in the Privacy Notice', () => {
    expect(privacy).toContain('id="supplier-public-sources"');
    expect(privacy).toMatch(/Article 14 UK GDPR/);
    // Source, lawful basis and the objection route are the parts a business
    // needs; none of them can quietly disappear.
    expect(privacy).toMatch(/business's own public website/);
    expect(privacy).toMatch(/Article 6\(1\)\(f\) UK GDPR/);
    expect(privacy).toMatch(/object to the processing and ask us to remove it/);
  });

  it('states in the Terms that an unclaimed listing creates no contract or fee', () => {
    expect(terms).toMatch(/does not create a contract between EventFlow and the business/);
    expect(terms).toMatch(/gives rise to no fee or subscription/);
    expect(terms).toMatch(/Nothing in these Terms binds a business that has not registered/);
  });

  it('cross-links the hub, Terms and Privacy Notice to each other', () => {
    expect(legal).toContain('href="/privacy#supplier-public-sources"');
    expect(terms).toContain('href="/legal#unclaimed-listings"');
    expect(terms).toContain('href="/privacy#supplier-public-sources"');
  });
});

describe('dated external references', () => {
  it('does not send consumers to the closed EU ODR platform', () => {
    // The platform ceased operating on 20 July 2025.
    expect(legal).not.toMatch(/<a href="https:\/\/ec\.europa\.eu\/consumers\/odr"/);
    expect(legal).toMatch(/ceased operating on 20 July 2025/);
  });

  it('does not classify a UK sole trader under the EU Digital Services Act', () => {
    expect(legal).not.toMatch(/as defined by Digital Services Act/);
    expect(legal).toMatch(/Electronic Commerce \(EC Directive\) Regulations 2002/);
  });
});

describe('policy page rendering', () => {
  const PAGES = [
    'public/legal.html',
    'public/terms.html',
    'public/privacy.html',
    'public/data-rights.html',
  ];

  it('carries no mis-decoded characters', () => {
    // A UTF-8 sequence read back as Latin-1 leaves a stray U+00C2/U+00C3/U+00E2
    // lead byte in front of a continuation byte. The hub's Community section
    // had one where an arrow should have been.
    const mojibake = /[\u00c2\u00c3\u00e2][\u0080-\u00bf]/;
    PAGES.forEach(page => {
      expect(read(page)).not.toMatch(mojibake);
    });
  });

  it('loads the shared legal reading enhancements', () => {
    PAGES.forEach(page => {
      const source = read(page);
      expect(source).toContain('/assets/css/legal-pages.css');
      expect(source).toContain('/assets/js/legal-pages.js');
    });
  });

  it('never truncates legal text on small screens', () => {
    // mobile-optimizations.css clamps `.card p` to three lines below 768px, and
    // the policy documents are a single `.card` — so every clause was cut off
    // mid-sentence on a phone until this override. A legal document that will
    // not show its own words is worse than one that is out of date.
    expect(read('public/assets/css/mobile-optimizations.css')).toContain('-webkit-line-clamp: 3');
    expect(legalStyles).toMatch(/-webkit-line-clamp: none !important/);
    expect(legalStyles).toMatch(/\.legal-doc-layout p,/);
    expect(legalStyles).toMatch(/\.legal-section p,/);
  });

  it('keeps the Legal Hub sidebar able to stick', () => {
    // `overflow-x: hidden` on the root turns it into a scroll container and
    // silently disables `position: sticky` for the sidebar; `clip` does not.
    expect(legalStyles).toMatch(/overflow-x: hidden;\n {2}overflow-x: clip;/);
  });
});
