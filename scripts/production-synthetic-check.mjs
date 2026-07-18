#!/usr/bin/env node

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const canonicalBaseUrl = String(
  process.env.SYNTHETIC_BASE_URL || 'https://event-flow.co.uk'
).replace(/\/$/, '');
const alternateBaseUrl = String(
  process.env.SYNTHETIC_ALTERNATE_URL || 'https://www.event-flow.co.uk'
).replace(/\/$/, '');
const timeoutMs = Number(process.env.SYNTHETIC_TIMEOUT_MS || 10000);
const outputDirectory = path.join(process.cwd(), 'reports', 'synthetics');
const outputPath = path.join(outputDirectory, 'production-synthetics.json');
const commitShaPattern = /^[0-9a-f]{40}$/i;

const checks = [
  {
    name: 'deployment identity',
    url: `${canonicalBaseUrl}/deployment.json`,
    type: 'json',
    validate: ({ body }) => commitShaPattern.test(String(body.commit || '')),
  },
  {
    name: 'application health',
    url: `${canonicalBaseUrl}/api/health`,
    type: 'json',
    validate: ({ body }) => ['ok', 'degraded'].includes(body.status),
  },
  {
    name: 'application readiness',
    url: `${canonicalBaseUrl}/api/ready`,
    type: 'json',
    validate: ({ body }) => body.status === 'ready',
  },
  {
    name: 'public configuration',
    url: `${canonicalBaseUrl}/api/config`,
    type: 'json',
    validate: ({ body }) => typeof body.version === 'string',
  },
  {
    name: 'homepage content contract',
    url: `${canonicalBaseUrl}/`,
    type: 'text',
    validate: ({ body }) =>
      /<html/i.test(body) &&
      !/Join over 500\+ verified suppliers already on EventFlow/i.test(body),
  },
  {
    name: 'marketplace content contract',
    url: `${canonicalBaseUrl}/marketplace`,
    type: 'text',
    validate: ({ body }) =>
      /<html/i.test(body) &&
      !/We're currently building the marketplace platform/i.test(body) &&
      !/<h2[^>]*>\s*Coming Soon\s*<\/h2>/i.test(body),
  },
  {
    name: 'pricing page',
    url: `${canonicalBaseUrl}/pricing`,
    type: 'text',
    validate: ({ body }) => /<html/i.test(body),
  },
  {
    name: 'supplier directory',
    url: `${canonicalBaseUrl}/suppliers`,
    type: 'text',
    validate: ({ body }) => /<html/i.test(body),
  },
  {
    name: 'robots file',
    url: `${canonicalBaseUrl}/robots.txt`,
    type: 'text',
    validate: ({ body }) => /user-agent/i.test(body),
  },
  {
    name: 'sitemap',
    url: `${canonicalBaseUrl}/sitemap.xml`,
    type: 'text',
    validate: ({ body }) => /<urlset|<sitemapindex/i.test(body),
  },
  {
    name: 'alternate homepage host redirect',
    url: `${alternateBaseUrl}/`,
    type: 'redirect',
    redirect: 'manual',
    validate: ({ response }) =>
      [301, 308].includes(response.status) &&
      response.headers.get('location') === `${canonicalBaseUrl}/`,
  },
  {
    name: 'alternate marketplace host redirect',
    url: `${alternateBaseUrl}/marketplace`,
    type: 'redirect',
    redirect: 'manual',
    validate: ({ response }) =>
      [301, 308].includes(response.status) &&
      response.headers.get('location') === `${canonicalBaseUrl}/marketplace`,
  },
];

function result(check, started, outcome) {
  return {
    name: check.name,
    target: new URL(check.url).pathname || '/',
    hostRole: check.url.startsWith(alternateBaseUrl) ? 'alternate' : 'canonical',
    ok: outcome === 'pass',
    durationMs: Math.round(performance.now() - started),
    outcome,
  };
}

async function runCheck(check) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestUrl =
      check.type === 'redirect'
        ? check.url
        : `${check.url}${check.url.includes('?') ? '&' : '?'}synthetic=${Date.now()}`;
    const response = await fetch(requestUrl, {
      signal: controller.signal,
      redirect: check.redirect || 'follow',
      headers: {
        Accept:
          check.type === 'json'
            ? 'application/json'
            : 'text/html,text/plain,application/xml',
        'Cache-Control': 'no-cache',
        'User-Agent': 'EventFlow-Production-Synthetic/2.0',
      },
    });

    if (check.type === 'redirect') {
      return result(check, started, check.validate({ response }) ? 'pass' : 'redirect_invalid');
    }

    let body;
    try {
      body = check.type === 'json' ? await response.json() : await response.text();
    } catch (_error) {
      return result(check, started, 'invalid_response');
    }

    if (response.status !== 200) return result(check, started, 'http_error');
    if (!check.validate({ response, body })) return result(check, started, 'content_invalid');
    if (performance.now() - started > timeoutMs)
      return result(check, started, 'slow_response');
    return result(check, started, 'pass');
  } catch (error) {
    return result(check, started, error.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const check of checks) {
  // Sequential execution keeps the monitor deliberately low-impact and diagnosable.
  results.push(await runCheck(check));
}

const report = {
  canonicalTarget: canonicalBaseUrl,
  alternateTarget: alternateBaseUrl,
  checkedAt: new Date().toISOString(),
  total: results.length,
  passed: results.filter(item => item.ok).length,
  failed: results.filter(item => !item.ok).length,
  results,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const markdown = [
  '## Production synthetic checks',
  '',
  `Canonical target: \`${canonicalBaseUrl}\``,
  `Alternate target: \`${alternateBaseUrl}\``,
  '',
  '| Check | Host | Path | Result | Duration |',
  '| --- | --- | --- | --- | ---: |',
  ...results.map(
    item =>
      `| ${item.name} | ${item.hostRole} | \`${item.target}\` | ${
        item.ok ? 'pass' : `fail: ${item.outcome}`
      } | ${item.durationMs}ms |`
  ),
  '',
  `**${report.passed}/${report.total} passed.**`,
  '',
].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
}

if (report.failed > 0) process.exitCode = 1;
