#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PATHS = [
  '/',
  '/start',
  '/public-calendar',
  '/guides',
  '/pricing',
  '/faq',
  '/marketplace',
  '/suppliers',
  '/for-suppliers',
  '/legal',
  '/contact',
  '/auth',
  '/forgot-password',
  '/reset-password',
  '/verify',
];

const BANNED_PATTERNS = [
  /Version:\s*loading/i,
  /Dashboard\s+Log out/i,
  /Mark all as read/i,
  /What Our Customers Say/i,
  /Sarah\s*&(?:amp;)?\s*Tom/i,
  /James Wilson/i,
  /Emma Davies/i,
  /All suppliers are verified and vetted/i,
  /Explore our full range of verified UK suppliers/i,
  /Calendar publishing requests/i,
  /Approve suitable suppliers/i,
  /admin override/i,
  /pending_review/i,
  /rejected/i,
];

const NOTIFICATION_VIEW_ALL = /notification[^<]{0,120}View all|View all[^<]{0,120}notification/i;
const PUBLIC_CALENDAR_CONTROL = /\b(?:Add Event|Publish Event)\b/i;

function parseArgs(argv) {
  const args = { base: 'http://localhost:3000', strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--base') {
      args.base = argv[++i];
    } else if (arg.startsWith('--base=')) {
      args.base = arg.slice('--base='.length);
    }
  }
  args.base = args.base.replace(/\/$/, '');
  return args;
}

function sitemapPaths() {
  const sitemapPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    return [];
  }
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  return [...xml.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)]
    .map(match => match[1] || '/')
    .map(item => item.replace(/\/$/, '') || '/')
    .filter(item => !item.startsWith('/articles/') && !item.startsWith('/wedding/'));
}

const HEADER_REQUIRED_PATHS = new Set([
  '/',
  '/start',
  '/public-calendar',
  '/guides',
  '/marketplace',
]);

function headerValue(headers, name) {
  return headers.get(name) || '';
}

function checkStrictHeaders(route, headers) {
  if (!HEADER_REQUIRED_PATHS.has(route)) {
    return [];
  }
  const failures = [];
  const cacheControl = headerValue(headers, 'cache-control');
  const pragma = headerValue(headers, 'pragma');
  const expires = headerValue(headers, 'expires');
  const vary = headerValue(headers, 'vary');
  const renderer = headerValue(headers, 'x-eventflow-template-renderer');
  const sanitizer = headerValue(headers, 'x-eventflow-public-sanitizer');

  if (cacheControl !== 'no-store, no-cache, must-revalidate, private') {
    failures.push(`${route}: unexpected Cache-Control ${JSON.stringify(cacheControl)}`);
  }
  if (pragma !== 'no-cache') {
    failures.push(`${route}: unexpected Pragma ${JSON.stringify(pragma)}`);
  }
  if (expires !== '0') {
    failures.push(`${route}: unexpected Expires ${JSON.stringify(expires)}`);
  }
  if (!/\bCookie\b/i.test(vary)) {
    failures.push(`${route}: Vary does not include Cookie`);
  }
  if (!/^(active|active-static)$/.test(renderer)) {
    failures.push(`${route}: unexpected X-EventFlow-Template-Renderer ${JSON.stringify(renderer)}`);
  }
  if (sanitizer !== 'anonymous-v2') {
    failures.push(`${route}: unexpected X-EventFlow-Public-Sanitizer ${JSON.stringify(sanitizer)}`);
  }
  return failures;
}

async function checkPath(base, route, strict) {
  const url = `${base}${route}`;
  const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/html' } });
  if (response.status >= 300 && response.status < 400) {
    return [];
  }
  if (!response.ok) {
    return [`${route}: HTTP ${response.status}`];
  }
  const text = await response.text();
  const failures = strict ? checkStrictHeaders(route, response.headers) : [];
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      failures.push(`${route}: matched ${pattern}`);
    }
  }
  if (NOTIFICATION_VIEW_ALL.test(text)) {
    failures.push(`${route}: notification/auth-only View all bleed`);
  }
  if (route === '/public-calendar' && PUBLIC_CALENDAR_CONTROL.test(text)) {
    failures.push(`${route}: anonymous calendar controls are visible`);
  }
  return failures;
}

async function main() {
  const { base, strict } = parseArgs(process.argv.slice(2));
  const routes = [...new Set([...DEFAULT_PATHS, ...sitemapPaths()])];
  const failures = [];
  for (const route of routes) {
    try {
      failures.push(...(await checkPath(base, route, strict)));
    } catch (error) {
      failures.push(`${route}: ${error.message}`);
    }
  }
  if (failures.length) {
    console.error(`Public render check failed for ${base}:`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Public render check passed for ${routes.length} routes at ${base}`);
}

main();
