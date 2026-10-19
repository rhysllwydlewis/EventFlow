'use strict';

/**
 * Homepage wedding website / RSVP / seating plan showcase.
 *
 * The admin can switch the live homepage between versions, so the section ships in both
 * public/index.html (v1 and v3) and public/home-v2.html. These tests keep the two copies
 * identical, keep the SEO structured data in step with the visible FAQ, and make sure the
 * copy avoids the strings the anonymous-page sanitizer deliberately strips.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../../public');
const read = file => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

const PAGES = ['index.html', 'home-v2.html'];
const START = '<!-- hws:start';
const END = '<!-- hws:end -->';

const sectionOf = html => {
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to + END.length);
};

const jsonLdBlocks = html =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match =>
    JSON.parse(match[1])
  );

const flattenGraph = blocks =>
  blocks.flatMap(block => (block['@graph'] ? block['@graph'] : [block]));

const textOf = html =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('homepage wedding showcase section', () => {
  const sections = PAGES.map(page => sectionOf(read(page)));

  test('both homepage files carry the same section, so every homepage version shows it', () => {
    expect(sections[0]).toBe(sections[1]);
  });

  test('it targets the wedding website, RSVP and seating plan searches in plain, visible text', () => {
    const text = textOf(sections[0]).toLowerCase();
    [
      'wedding website',
      'free wedding website',
      'online wedding rsvp',
      'wedding rsvps',
      'guest list',
      'seating plan',
      'qr code',
      'whatsapp',
    ].forEach(keyword => expect(text).toContain(keyword));
  });

  test('it has one h2, h3 sub-headings and no skipped heading levels', () => {
    const html = sections[0];
    expect(html.match(/<h2\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h1\b/);
    expect(html.match(/<h3\b/g).length).toBeGreaterThanOrEqual(5);
    expect(html).not.toMatch(/<h4\b/);
  });

  test('its internal links point at pages that exist and avoid supplier query links', () => {
    const hrefs = [...sections[0].matchAll(/href="([^"]+)"/g)].map(match =>
      match[1].replace(/&amp;/g, '&')
    );
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach(href => {
      expect(href).toMatch(/^\//);
      expect(href).not.toMatch(/^\/suppliers\?/);
    });
    expect(hrefs).toContain('/articles/wedding-website-on-eventflow-guide');
    expect(hrefs).toContain('/auth?tab=create&role=customer');
    expect(
      fs.existsSync(path.join(PUBLIC_DIR, 'articles/wedding-website-on-eventflow-guide.html'))
    ).toBe(true);
  });

  test('the graphics are described once and hidden from assistive technology', () => {
    const html = sections[0];
    expect(html).toMatch(
      /class="hws__stage" role="img" aria-label="Illustration of a wedding website/
    );
    ['hws__tracker', 'hws__phone', 'hws__seating'].forEach(name =>
      expect(html).toMatch(
        new RegExp(
          `class="hws__card ${name}"[^>]*aria-hidden="true"|class="${name}"[^>]*aria-hidden="true"`
        )
      )
    );
    // every inline svg is decorative
    expect(html.match(/<svg\b(?![^>]*aria-hidden="true")[^>]*>/g)).toBeNull();
    expect(html).toContain('<figcaption>Illustrative preview');
  });

  test('it makes no claims the site cannot back up and avoids strings the sanitizer strips', () => {
    const text = textOf(sections[0]);
    expect(text).not.toMatch(
      /View all|Verified|Customer Reviews|What Our Customers Say|Notifications|Log out|Mark all as read/i
    );
    expect(text).not.toMatch(/\b(thousands|millions|\d+,\d{3}) (of )?(couples|weddings|users)/i);
    expect(text).not.toMatch(/rated|stars?\b|testimonial/i);
    expect(sections[0]).not.toMatch(/>\s*Dashboard\s*</);
  });
});

describe('homepage wedding showcase structured data', () => {
  test.each(PAGES)('%s declares the service and one FAQPage that matches the visible FAQ', page => {
    const html = read(page);
    const nodes = flattenGraph(jsonLdBlocks(html));

    const service = nodes.find(node => node['@type'] === 'Service');
    expect(service).toBeDefined();
    expect(service.provider).toEqual({ '@id': 'https://event-flow.co.uk/#organization' });
    expect(service.offers).toMatchObject({ price: '0', priceCurrency: 'GBP' });

    const faqPages = nodes.filter(node => node['@type'] === 'FAQPage');
    expect(faqPages).toHaveLength(1);

    const visible = [
      ...sectionOf(html).matchAll(/<details class="hws__faq-item">([\s\S]*?)<\/details>/g),
    ].map(match => ({
      question: textOf(match[1].match(/<summary>([\s\S]*?)<\/summary>/)[1]),
      answer: textOf(match[1].replace(/<summary>[\s\S]*?<\/summary>/, '')),
    }));
    const declared = faqPages[0].mainEntity.map(item => ({
      question: item.name,
      answer: item.acceptedAnswer.text,
    }));
    expect(declared.length).toBeGreaterThanOrEqual(4);
    expect(declared).toEqual(visible);
  });

  test.each(PAGES)('%s gives every JSON-LD @id only once', page => {
    const ids = flattenGraph(jsonLdBlocks(read(page)))
      .map(node => node['@id'])
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('homepage wedding showcase assets', () => {
  test.each(PAGES)('%s loads the stylesheet with a version', page => {
    expect(read(page)).toMatch(/home-wedding-showcase\.css\?v=[\d.]+/);
  });

  test('the stylesheet is scoped to the section so it cannot restyle the rest of the homepage', () => {
    const css = read('assets/css/home-wedding-showcase.css');
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{')
      .slice(0, -1)
      .map(part => part.split('}').pop().trim())
      .filter(part => part && !part.startsWith('@') && !/^\d+%$|^(from|to)$/.test(part))
      .flatMap(part => part.split(/,(?![^(]*\))/).map(sel => sel.trim()));
    const unscoped = selectors.filter(sel => !/\.hws/.test(sel));
    expect(unscoped).toEqual([]);
  });
});
