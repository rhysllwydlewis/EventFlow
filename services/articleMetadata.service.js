'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.resolve(__dirname, '../public/assets/data/guides.json');
const ARTICLE_PATH_PREFIX = '/articles/';

let cache = null;

function normaliseDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function loadArticleMetadata({ fresh = false } = {}) {
  if (cache && !fresh) {
    return cache;
  }
  const rows = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  cache = rows.map(row => ({
    ...row,
    slug: String(row.href || '').replace(ARTICLE_PATH_PREFIX, ''),
    publishedDate: normaliseDate(row.publishedDate),
    lastMaterialUpdate: normaliseDate(
      row.lastMaterialUpdate || row.lastUpdated || row.publishedDate
    ),
  }));
  return cache;
}

function getArticleMetadata(slug) {
  return loadArticleMetadata().find(article => article.slug === String(slug || '')) || null;
}

function formatDate(date, options = {}) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
    ...options,
  }).format(parsed);
}

function currentReviewMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(now);
}

function monthYear(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(parsed);
}

function replaceMetaProperty(content, property, value) {
  const propertyFirst = new RegExp(
    `(<meta\\b[^>]*property=["']${property}["'][^>]*content=["'])[^"']*(["'][^>]*>)`,
    'i'
  );
  const contentFirst = new RegExp(
    `(<meta\\b[^>]*content=["'])[^"']*(["'][^>]*property=["']${property}["'][^>]*>)`,
    'i'
  );
  if (propertyFirst.test(content)) {
    return content.replace(propertyFirst, `$1${value}$2`);
  }
  if (contentFirst.test(content)) {
    return content.replace(contentFirst, `$1${value}$2`);
  }
  return content.replace(/<\/head>/i, `<meta property="${property}" content="${value}">\n</head>`);
}

function renderArticleDates(content, slug, now = new Date()) {
  const metadata = getArticleMetadata(slug);
  if (!metadata) {
    return content;
  }

  const published = metadata.publishedDate;
  const modified = metadata.lastMaterialUpdate || published;
  const publishedLabel = formatDate(published);
  const modifiedLabel = formatDate(modified);
  const checkedLabel = currentReviewMonth(now);
  let result = content;

  result = result.replace(/("datePublished"\s*:\s*")[^"]*(")/g, `$1${published}$2`);
  if (/"dateModified"\s*:/.test(result)) {
    result = result.replace(/("dateModified"\s*:\s*")[^"]*(")/g, `$1${modified}$2`);
  } else {
    result = result.replace(
      /("datePublished"\s*:\s*"[^"]+")/,
      `$1,\n    "dateModified": "${modified}"`
    );
  }
  result = replaceMetaProperty(result, 'article:published_time', published);
  result = replaceMetaProperty(result, 'article:modified_time', modified);

  result = result.replace(
    /Published:\s*<time\b[^>]*>[\s\S]*?<\/time>/gi,
    `Published: <time datetime="${published}">${publishedLabel}</time>`
  );
  result = result.replace(
    /Updated(?::|\s)\s*[A-Z][a-z]+\s+20\d{2}/g,
    `Updated: ${monthYear(modified)}`
  );

  const freshness = `<aside class="article-freshness" aria-label="Article publication and review information" data-article-freshness>
  <span>Published <time datetime="${published}">${publishedLabel}</time></span>
  <span>Last materially updated <time datetime="${modified}">${modifiedLabel}</time></span>
  <span>Content checked ${checkedLabel}</span>
</aside>`;
  if (!result.includes('data-article-freshness')) {
    result = result.replace(/(<article\b[^>]*>)/i, `$1\n${freshness}`);
  }
  return result;
}

module.exports = {
  ARTICLE_PATH_PREFIX,
  MANIFEST_PATH,
  currentReviewMonth,
  formatDate,
  getArticleMetadata,
  loadArticleMetadata,
  monthYear,
  normaliseDate,
  renderArticleDates,
};
