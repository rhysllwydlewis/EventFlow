'use strict';

const XML_ENTITY_MAP = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

function decodeXml(value) {
  return String(value || '').replace(/&(lt|gt|quot|apos|amp);/g, entity => XML_ENTITY_MAP[entity]);
}

function parseSitemapEntries(xml) {
  const entries = [];
  const source = String(xml || '');
  for (const match of source.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/gi)) {
    const block = match[1];
    const location = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] || '';
    if (location) {
      entries.push({ url: decodeXml(location.trim()), lastmod: decodeXml(lastmod.trim()) });
    }
  }
  return entries;
}

function isListingPath(pathname) {
  return /^\/(?:supplier|package|events)\//.test(pathname);
}

function validateSitemapXml(xml, canonicalBaseUrl, now = new Date()) {
  const issues = [];
  const entries = parseSitemapEntries(xml);
  let canonicalOrigin = '';
  try {
    canonicalOrigin = new URL(canonicalBaseUrl).origin;
  } catch (_error) {
    issues.push('canonical base URL is invalid');
  }

  if (entries.length === 0) issues.push('sitemap has no URL entries');
  if (/<(?:priority|changefreq)>/i.test(String(xml || ''))) {
    issues.push('sitemap contains ignored priority or changefreq hints');
  }

  const seen = new Set();
  for (const entry of entries) {
    let parsed;
    try {
      parsed = new URL(entry.url);
    } catch (_error) {
      issues.push(`invalid URL: ${entry.url}`);
      continue;
    }

    if (parsed.protocol !== 'https:') issues.push(`non-HTTPS URL: ${entry.url}`);
    if (canonicalOrigin && parsed.origin !== canonicalOrigin) {
      issues.push(`non-canonical origin: ${entry.url}`);
    }
    if (parsed.hash) issues.push(`URL contains a fragment: ${entry.url}`);
    if (/\/package\.html$/i.test(parsed.pathname)) {
      issues.push(`legacy package URL: ${entry.url}`);
    }
    if (isListingPath(parsed.pathname) && parsed.search) {
      issues.push(`listing URL contains query parameters: ${entry.url}`);
    }
    if (seen.has(entry.url)) issues.push(`duplicate URL: ${entry.url}`);
    seen.add(entry.url);

    if (entry.lastmod) {
      const lastmod = new Date(entry.lastmod);
      if (Number.isNaN(lastmod.getTime())) {
        issues.push(`invalid lastmod for ${entry.url}`);
      } else if (lastmod.getTime() > now.getTime() + 10 * 60 * 1000) {
        issues.push(`future lastmod for ${entry.url}`);
      }
    }
  }

  return { valid: issues.length === 0, issues, entries };
}

function extractCanonical(html) {
  const source = String(html || '');
  const link = source.match(
    /<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i
  );
  if (link?.[1]) return decodeXml(link[1]);
  const reversed = source.match(
    /<link\b(?=[^>]*\bhref=["']([^"']+)["'])(?=[^>]*\brel=["']canonical["'])[^>]*>/i
  );
  return reversed?.[1] ? decodeXml(reversed[1]) : '';
}

function extractMetaContent(html, attribute, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = String(html || '');
  const first = source.match(
    new RegExp(
      `<meta\\b(?=[^>]*\\b${attribute}=["']${escaped}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`,
      'i'
    )
  );
  if (first?.[1] !== undefined) return decodeXml(first[1]);
  const reversed = source.match(
    new RegExp(
      `<meta\\b(?=[^>]*\\bcontent=["']([^"']*)["'])(?=[^>]*\\b${attribute}=["']${escaped}["'])[^>]*>`,
      'i'
    )
  );
  return reversed?.[1] !== undefined ? decodeXml(reversed[1]) : '';
}

function listingContract(expectedUrl) {
  try {
    const pathname = new URL(expectedUrl).pathname;
    if (pathname.startsWith('/supplier/')) {
      return { structuredDataId: 'supplier-structured-data', serverMarker: '' };
    }
    if (pathname.startsWith('/package/')) {
      return { structuredDataId: 'package-structured-data', serverMarker: 'package' };
    }
    if (pathname.startsWith('/events/')) {
      return { structuredDataId: 'event-structured-data', serverMarker: 'event' };
    }
  } catch (_error) {
    // The caller reports the canonical mismatch; no listing-specific contract is possible.
  }
  return { structuredDataId: '', serverMarker: '' };
}

function validateIndexableHtml({ html, expectedUrl, headers = {}, requireStructuredData = false }) {
  const issues = [];
  const source = String(html || '');
  const canonical = extractCanonical(source);
  const title = source.match(/<title\b[^>]*>\s*([\s\S]*?)\s*<\/title>/i)?.[1]?.trim() || '';
  const description = extractMetaContent(source, 'name', 'description').trim();
  const metaRobots = extractMetaContent(source, 'name', 'robots').toLowerCase();
  const headerRobots = String(
    headers['x-robots-tag'] || headers.get?.('x-robots-tag') || ''
  ).toLowerCase();

  if (!canonical) issues.push('canonical is missing');
  else if (canonical !== expectedUrl) issues.push(`canonical mismatch: ${canonical}`);
  if (!title) issues.push('title is missing');
  if (!description) issues.push('meta description is missing');
  if (/\bnoindex\b/.test(metaRobots) || /\bnoindex\b/.test(headerRobots)) {
    issues.push('page is marked noindex');
  }
  if (/^(?:Package Details|Event details)(?:\s*[—|].*)?$/i.test(title)) {
    issues.push('page has generic placeholder title');
  }

  if (requireStructuredData) {
    const contract = listingContract(expectedUrl);
    const structuredDataPattern = contract.structuredDataId
      ? new RegExp(
          `<script\\b(?=[^>]*\\btype=["']application/ld\\+json["'])(?=[^>]*\\bid=["']${contract.structuredDataId}["'])[^>]*>`,
          'i'
        )
      : /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/i;
    if (!structuredDataPattern.test(source)) {
      issues.push('listing structured data is missing');
    }
    if (
      contract.serverMarker &&
      extractMetaContent(source, 'name', 'ef-server-seo') !== contract.serverMarker
    ) {
      issues.push('server-rendered listing marker is missing');
    }
  }

  return { valid: issues.length === 0, issues, canonical, title, description };
}

function selectAuditEntries(entries, limit = 60) {
  const groups = {
    core: [],
    supplier: [],
    package: [],
    event: [],
    article: [],
    other: [],
  };
  for (const entry of entries || []) {
    let pathname = '';
    try {
      pathname = new URL(entry.url).pathname;
    } catch (_error) {
      continue;
    }
    if (pathname.startsWith('/supplier/')) groups.supplier.push(entry);
    else if (pathname.startsWith('/package/')) groups.package.push(entry);
    else if (pathname.startsWith('/events/')) groups.event.push(entry);
    else if (pathname.startsWith('/articles/')) groups.article.push(entry);
    else if (['/', '/suppliers', '/marketplace', '/public-calendar', '/guides'].includes(pathname)) {
      groups.core.push(entry);
    } else groups.other.push(entry);
  }

  const selected = [];
  const take = (group, maximum) => {
    for (const entry of group.slice(0, maximum)) {
      if (selected.length < limit) selected.push(entry);
    }
  };
  take(groups.core, 5);
  take(groups.supplier, 10);
  take(groups.package, 10);
  take(groups.event, 10);
  take(groups.article, 15);
  take(groups.other, limit);
  return selected.slice(0, limit);
}

module.exports = {
  extractCanonical,
  extractMetaContent,
  isListingPath,
  listingContract,
  parseSitemapEntries,
  selectAuditEntries,
  validateIndexableHtml,
  validateSitemapXml,
};
