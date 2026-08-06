#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadArticleMetadata, renderArticleDates } = require('../services/articleMetadata.service');

const articlesDir = path.resolve(__dirname, '../public/articles');
const files = fs
  .readdirSync(articlesDir)
  .filter(file => file.endsWith('.html'))
  .map(file => file.replace(/\.html$/, ''))
  .sort();
const metadata = loadArticleMetadata({ fresh: true });
const slugs = metadata.map(article => article.slug).sort();
const errors = [];
const today = new Date().toISOString().slice(0, 10);

if (new Set(slugs).size !== slugs.length) {
  errors.push('Article manifest contains duplicate slugs');
}
files
  .filter(slug => !slugs.includes(slug))
  .forEach(slug => errors.push(`Missing metadata: ${slug}`));
slugs
  .filter(slug => !files.includes(slug))
  .forEach(slug => errors.push(`Missing HTML file: ${slug}`));

metadata.forEach(article => {
  if (!article.publishedDate) {
    errors.push(`${article.slug}: invalid publishedDate`);
  }
  if (!article.lastMaterialUpdate) {
    errors.push(`${article.slug}: invalid lastMaterialUpdate`);
  }
  if (article.publishedDate > today || article.lastMaterialUpdate > today) {
    errors.push(`${article.slug}: future article date`);
  }
  if (article.lastMaterialUpdate < article.publishedDate) {
    errors.push(`${article.slug}: lastMaterialUpdate precedes publication`);
  }
  const source = fs.readFileSync(path.join(articlesDir, `${article.slug}.html`), 'utf8');
  const rendered = renderArticleDates(source, article.slug, new Date(`${today}T12:00:00Z`));
  if (!new RegExp(`"datePublished"\\s*:\\s*"${article.publishedDate}"`).test(rendered)) {
    errors.push(`${article.slug}: rendered datePublished is missing or inconsistent`);
  }
  if (!new RegExp(`"dateModified"\\s*:\\s*"${article.lastMaterialUpdate}"`).test(rendered)) {
    errors.push(`${article.slug}: rendered dateModified is missing or inconsistent`);
  }
  if ((rendered.match(/data-article-freshness/g) || []).length !== 1) {
    errors.push(`${article.slug}: expected one rendered freshness panel`);
  }
});

if (errors.length) {
  console.error(
    `Article metadata audit failed (${errors.length} issue(s)):\n- ${errors.join('\n- ')}`
  );
  process.exitCode = 1;
} else {
  console.log(`Article metadata audit passed for ${metadata.length} articles.`);
}
