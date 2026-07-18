#!/usr/bin/env node

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = String(process.env.SYNTHETIC_BASE_URL || 'https://event-flow.co.uk').replace(/\/$/, '');
const timeoutMs = Number(process.env.SYNTHETIC_TIMEOUT_MS || 10000);
const outputDirectory = path.join(process.cwd(), 'reports', 'synthetics');
const outputPath = path.join(outputDirectory, 'production-synthetics.json');
const commitShaPattern = /^[0-9a-f]{40}$/i;

const checks = [
  {
    path: '/deployment.json',
    type: 'json',
    validate: body => commitShaPattern.test(String(body.commit || '')),
  },
  {
    path: '/api/health',
    type: 'json',
    validate: body => ['ok', 'degraded'].includes(body.status),
  },
  { path: '/api/ready', type: 'json', validate: body => body.status === 'ready' },
  { path: '/api/config', type: 'json', validate: body => typeof body.version === 'string' },
  { path: '/', type: 'text', validate: body => /<html/i.test(body) },
  { path: '/marketplace', type: 'text', validate: body => /<html/i.test(body) },
  { path: '/pricing', type: 'text', validate: body => /<html/i.test(body) },
  { path: '/suppliers', type: 'text', validate: body => /<html/i.test(body) },
  { path: '/robots.txt', type: 'text', validate: body => /user-agent/i.test(body) },
  { path: '/sitemap.xml', type: 'text', validate: body => /<urlset|<sitemapindex/i.test(body) },
];

function result(pathname, started, outcome) {
  return {
    path: pathname,
    ok: outcome === 'pass',
    durationMs: Math.round(performance.now() - started),
    outcome,
  };
}

async function runCheck(check) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${check.path}`;

  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}synthetic=${Date.now()}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: check.type === 'json' ? 'application/json' : 'text/html,text/plain,application/xml',
        'Cache-Control': 'no-cache',
        'User-Agent': 'EventFlow-Production-Synthetic/1.0',
      },
    });

    let body;
    try {
      body = check.type === 'json' ? await response.json() : await response.text();
    } catch (_error) {
      return result(check.path, started, 'invalid_response');
    }

    if (response.status !== 200) return result(check.path, started, 'http_error');
    if (!check.validate(body)) return result(check.path, started, 'content_invalid');
    if (performance.now() - started > timeoutMs) return result(check.path, started, 'slow_response');
    return result(check.path, started, 'pass');
  } catch (error) {
    return result(check.path, started, error.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const check of checks) {
  // Sequential execution makes the check intentionally low-impact and easier to diagnose.
  results.push(await runCheck(check));
}

const report = {
  target: baseUrl,
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
  `Target: \`${baseUrl}\``,
  '',
  '| Path | Result | Duration |',
  '| --- | --- | ---: |',
  ...results.map(
    item => `| \`${item.path}\` | ${item.ok ? 'pass' : `fail: ${item.outcome}`} | ${item.durationMs}ms |`
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
