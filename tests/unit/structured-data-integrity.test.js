'use strict';

/**
 * Regression guard for SEO-009 ("Confirmed search-feature/URL hygiene
 * defects"). Google Search Console reported a literal "Bad escape sequence in
 * string" JSON-LD parse error on /for-suppliers (a hand-built `\'` escape,
 * which is not valid JSON — JSON only allows \" \\ \/ \b \f \n \r \t \uXXXX)
 * and had discovered `/suppliers?q=%7Bsearch_term_string%7D` as if it were a
 * real, crawlable page.
 *
 * These tests:
 *  1. Parse every static `application/ld+json` block shipped in public/ HTML
 *     with JSON.parse and fail loudly on invalid JSON — a CI-enforced check
 *     covering every page, not just /for-suppliers.
 *  2. Re-run the exact bug class (apostrophes/backslashes in the underlying
 *     copy) against both the fixed static page and the dynamic supplier/
 *     package/event JSON-LD generators, which already serialize via
 *     JSON.stringify and must stay that way.
 *  3. Confirm the WebSite SearchAction uses the schema.org-compliant
 *     EntryPoint + urlTemplate form, and that the literal placeholder token
 *     `{search_term_string}` (encoded or decoded) never appears anywhere in
 *     tracked content except inside that one urlTemplate string.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');

function walk(dir, extensions, exclude = []) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return out;
  }
  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, extensions, exclude));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function extractLdJsonBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    blocks.push(match[1]);
  }
  return blocks;
}

const publicHtmlFiles = walk(path.join(REPO_ROOT, 'public'), ['.html']);

describe('structured data — every static application/ld+json block is valid JSON', () => {
  const filesWithLdJson = publicHtmlFiles
    .map(file => ({ file, blocks: extractLdJsonBlocks(fs.readFileSync(file, 'utf8')) }))
    .filter(({ blocks }) => blocks.length > 0);

  // Sanity check on the test itself: this repo does ship static ld+json.
  test('at least one static page ships application/ld+json (sanity check)', () => {
    expect(filesWithLdJson.length).toBeGreaterThan(0);
  });

  test.each(
    filesWithLdJson.flatMap(({ file, blocks }) => blocks.map((block, i) => [file, i, block]))
  )('%s block #%i parses as valid JSON', (file, _index, block) => {
    expect(() => JSON.parse(block)).not.toThrow();
  });
});

describe('structured data — /for-suppliers regression (the reported bad-escape bug)', () => {
  const filePath = path.join(REPO_ROOT, 'public/for-suppliers.html');
  const html = fs.readFileSync(filePath, 'utf8');
  const blocks = extractLdJsonBlocks(html);

  test('ships exactly one ld+json block', () => {
    expect(blocks).toHaveLength(1);
  });

  test('parses without throwing and is not merely tolerated by a lenient parser', () => {
    // JSON only permits \" \\ \/ \b \f \n \r \t \uXXXX as escape sequences.
    // A hand-typed `\'` (escaping an apostrophe, valid in JS strings but not
    // in JSON strings) is exactly what produced GSC's "Bad escape sequence in
    // string" error. Guard both that JSON.parse succeeds AND that the raw
    // source never contains a backslash-apostrophe again.
    expect(blocks[0]).not.toMatch(/\\'/);
    const data = JSON.parse(blocks[0]);
    expect(data['@type']).toBe('Service');
    expect(data.description).toContain("UK's leading");
  });

  test('schema url matches the page’s actual canonical URL', () => {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)[1];
    const data = JSON.parse(blocks[0]);
    expect(data.url).toBe(canonical);
    expect(canonical).toBe('https://event-flow.co.uk/for-suppliers');
  });

  test('does not claim an unsupported supplier-facing "verified" trust signal', () => {
    expect(JSON.stringify(JSON.parse(blocks[0]))).not.toMatch(/verified/i);
  });
});

describe('structured data — Organization schema does not encode an unsupported verification claim', () => {
  test.each(['public/index.html', 'public/home-v2.html'])(
    '%s Organization description says "approved", not "verified"',
    relPath => {
      const html = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const blocks = extractLdJsonBlocks(html);
      const org = blocks
        .map(block => JSON.parse(block))
        .flatMap(doc => (Array.isArray(doc['@graph']) ? doc['@graph'] : [doc]))
        .find(node => node['@type'] === 'Organization');

      expect(org).toBeDefined();
      expect(org.description).not.toMatch(/verified/i);
      expect(org.description).toMatch(/approved event suppliers/i);
    }
  );
});

describe('structured data — WebSite SearchAction is schema.org-compliant and non-crawlable', () => {
  test.each(['public/index.html', 'public/home-v2.html'])(
    '%s SearchAction uses an EntryPoint target with urlTemplate',
    relPath => {
      const html = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const blocks = extractLdJsonBlocks(html);
      const website = blocks
        .map(block => JSON.parse(block))
        .flatMap(doc => (Array.isArray(doc['@graph']) ? doc['@graph'] : [doc]))
        .find(node => node['@type'] === 'WebSite');

      expect(website).toBeDefined();
      const action = website.potentialAction;
      expect(action['@type']).toBe('SearchAction');
      // The old bug: `target` was a bare string. Google's own structured-data
      // docs specify the EntryPoint object form for a SearchAction target.
      expect(typeof action.target).toBe('object');
      expect(action.target['@type']).toBe('EntryPoint');
      expect(action.target.urlTemplate).toBe(
        'https://event-flow.co.uk/suppliers?q={search_term_string}'
      );
      expect(action['query-input']).toBe('required name=search_term_string');
    }
  );

  const trackedFiles = [
    ...walk(path.join(REPO_ROOT, 'public'), ['.html', '.xml']),
    ...walk(path.join(REPO_ROOT, 'public/assets/js'), ['.js'], ['vendor']),
    ...walk(path.join(REPO_ROOT, 'routes'), ['.js']),
    ...walk(path.join(REPO_ROOT, 'services'), ['.js']),
  ];

  test('the literal {search_term_string} placeholder (encoded or decoded) appears nowhere except inside the two SearchAction urlTemplate values', () => {
    const ENCODED = '%7Bsearch_term_string%7D';
    const DECODED = '{search_term_string}';
    const allowedFiles = new Set([
      path.join(REPO_ROOT, 'public/index.html'),
      path.join(REPO_ROOT, 'public/home-v2.html'),
    ]);

    const offenders = [];
    for (const file of trackedFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const hasEncoded = content.includes(ENCODED);
      const hasDecoded = content.includes(DECODED);
      if (!hasEncoded && !hasDecoded) {
        continue;
      }
      if (allowedFiles.has(file) && hasDecoded && !hasEncoded) {
        // Confirm every decoded occurrence is inside a urlTemplate string, not
        // a bare/crawlable href or navigation target.
        const decodedOutsideUrlTemplate = content
          .split(DECODED)
          .slice(0, -1)
          .some(chunk => !/urlTemplate"\s*:\s*"[^"]*$/.test(chunk));
        if (decodedOutsideUrlTemplate) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
        continue;
      }
      offenders.push(path.relative(REPO_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  test('no real <a href> or navigation ever points at the literal search placeholder', () => {
    const offenders = [];
    for (const file of publicHtmlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (
        /<a\b[^>]*href="[^"]*(?:%7Bsearch_term_string%7D|\{search_term_string\})[^"]*"/i.test(
          content
        )
      ) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('structured data — dynamic generators already use JSON.stringify and stay bug-class-safe', () => {
  const {
    buildSupplierSeoModel,
    renderSupplierHtml,
  } = require('../../services/publicSupplierSeo.service');
  const {
    buildPackageSeoModel,
    buildEventSeoModel,
    renderSeoHtml,
  } = require('../../services/publicListingSeo.service');

  const supplierTemplate = `<!doctype html><html><head>
    <title>Supplier Profile — EventFlow</title>
    <meta name="description" content="Generic supplier profile">
  </head><body><main><h1 id="supplier-name">Loading supplier</h1></main></body></html>`;

  // The exact bug class that broke /for-suppliers: apostrophes and backslashes
  // in ordinary copy, hand-escaped incorrectly. Every generator must survive
  // this fixture via JSON.stringify, not string concatenation.
  const trickyName = "O'Brien's Marquees \\ Events";
  const trickyDescription =
    'Dan\'s team don\'t cut corners — quotes like "the best" and a stray backslash \\ still parse.';

  test('supplier JSON-LD survives apostrophes and backslashes in the name/description', () => {
    const supplier = {
      id: 'supplier-apostrophe',
      ownerUserId: 'user-1',
      approved: true,
      name: trickyName,
      category: 'Marquees',
      location: 'Cardiff',
      description_short: trickyDescription,
      updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const rendered = renderSupplierHtml(supplierTemplate, supplier);
    const block = extractLdJsonBlocks(rendered)[0];
    expect(() => JSON.parse(block)).not.toThrow();
    const data = JSON.parse(block);
    expect(data.name).toBe(trickyName);

    const model = buildSupplierSeoModel(supplier);
    expect(() => JSON.parse(JSON.stringify(model.structuredData))).not.toThrow();
  });

  test('package JSON-LD survives apostrophes and backslashes in the title/description', () => {
    const pkg = {
      id: 'pkg-apostrophe',
      supplierId: 'supplier-1',
      approved: true,
      title: trickyName,
      slug: 'apostrophe-package',
      description: trickyDescription,
      price: '£1,250',
      primaryCategoryKey: 'marquees',
    };
    const supplier = { id: 'supplier-1', ownerUserId: 'user-1', approved: true, name: trickyName };
    const seo = buildPackageSeoModel(pkg, supplier, { baseUrl: 'https://event-flow.co.uk' });
    expect(() => JSON.parse(JSON.stringify(seo.structuredData))).not.toThrow();

    const template = `<!doctype html><html><head><title>Generic</title><meta name="description" content="Generic"><link rel="canonical" href="https://event-flow.co.uk/package/"><script type="application/ld+json" id="package-structured-data">{}</script></head><body><main id="content">Unchanged</main></body></html>`;
    const html = renderSeoHtml(template, 'package', pkg.id, seo, true);
    const block = extractLdJsonBlocks(html).find(b => b.trim() !== '{}');
    expect(() => JSON.parse(block)).not.toThrow();
  });

  test('event JSON-LD survives apostrophes and backslashes in the title/description', () => {
    const event = {
      id: 'pce_apostrophe',
      slug: 'apostrophe-event',
      title: trickyName,
      description: trickyDescription,
      status: 'published',
      startDate: '2030-06-15T10:00:00.000Z',
      endDate: '2030-06-15T16:00:00.000Z',
      venueName: trickyName,
      townCity: 'Cardiff',
      priceType: 'free',
    };
    const seo = buildEventSeoModel(event, { baseUrl: 'https://event-flow.co.uk' });
    expect(() => JSON.parse(JSON.stringify(seo.structuredData))).not.toThrow();

    const template = `<!doctype html><html><head><title>Generic</title><meta name="description" content="Generic"><link rel="canonical" href="https://event-flow.co.uk/events/"><script type="application/ld+json" id="event-structured-data">{}</script></head><body><main id="content">Unchanged</main></body></html>`;
    const html = renderSeoHtml(template, 'event', event.id, seo, true);
    const block = extractLdJsonBlocks(html).find(b => b.trim() !== '{}');
    expect(() => JSON.parse(block)).not.toThrow();
  });
});
