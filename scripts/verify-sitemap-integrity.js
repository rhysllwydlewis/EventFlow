#!/usr/bin/env node
'use strict';

const { auditEverySitemapUrl } = require('../services/sitemapIntegrity.service');

async function main() {
  const baseUrl = String(process.env.SEO_AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(
    /\/$/,
    ''
  );
  const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`);
  if (!sitemapResponse.ok) {
    throw new Error(`sitemap.xml returned ${sitemapResponse.status}`);
  }
  const report = await auditEverySitemapUrl(await sitemapResponse.text(), url =>
    fetch(url, { redirect: 'follow' })
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
