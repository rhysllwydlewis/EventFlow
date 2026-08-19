'use strict';

function sitemapLocations(xml) {
  return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
}

function canonicalFromHtml(html) {
  const match = String(html || '').match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    String(html || '').match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  return match ? match[1] : '';
}

async function auditEverySitemapUrl(xml, fetchPage) {
  const urls = sitemapLocations(xml);
  const failures = [];
  const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
  duplicates.forEach(url => failures.push({ url, reason: 'duplicate_sitemap_location' }));

  for (const url of [...new Set(urls)]) {
    const response = await fetchPage(url);
    const html = await response.text();
    const robots = `${response.headers.get('x-robots-tag') || ''} ${html}`;
    if (response.status !== 200) {
      failures.push({ url, reason: `terminal_status_${response.status}` });
    }
    if (/noindex/i.test(robots)) {
      failures.push({ url, reason: 'noindex' });
    }
    if (canonicalFromHtml(html) !== url) {
      failures.push({ url, reason: 'non_self_canonical' });
    }
  }
  return { checked: new Set(urls).size, failures };
}

module.exports = { sitemapLocations, canonicalFromHtml, auditEverySitemapUrl };
