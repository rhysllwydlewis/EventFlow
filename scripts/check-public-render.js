#!/usr/bin/env node
'use strict';

// Usage for post-deploy live verification:
// npm run check:public-render -- --base=https://event-flow.co.uk --strict
// In strict live mode, proxy/CDN header differences are warnings, but body leaks
// remain hard failures.

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
  /Shared Events Calendar publishing enabled/i,
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

const HEADER_REQUIRED_PATHS = new Set([
  '/',
  '/start',
  '/public-calendar',
  '/guides',
  '/suppliers',
  '/pricing',
  '/marketplace',
]);

function headerValue(headers, name) {
  return headers.get(name) || '';
}

function isLiveBase(base) {
  return (
    /^https?:\/\//i.test(base) && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(base)
  );
}

function checkStrictHeaders(route, headers, { allowProxyHeaderWarnings = false } = {}) {
  if (!HEADER_REQUIRED_PATHS.has(route)) {
    return { failures: [], warnings: [] };
  }
  const failures = [];
  const warnings = [];
  const cacheControl = headerValue(headers, 'cache-control');
  const pragma = headerValue(headers, 'pragma');
  const expires = headerValue(headers, 'expires');
  const vary = headerValue(headers, 'vary');
  const renderer = headerValue(headers, 'x-eventflow-template-renderer');
  const sanitizer = headerValue(headers, 'x-eventflow-public-sanitizer');

  if (cacheControl !== 'no-store, no-cache, must-revalidate, private') {
    (allowProxyHeaderWarnings ? warnings : failures).push(
      `${route}: unexpected Cache-Control ${JSON.stringify(cacheControl)}`
    );
  }
  if (pragma !== 'no-cache') {
    (allowProxyHeaderWarnings ? warnings : failures).push(
      `${route}: unexpected Pragma ${JSON.stringify(pragma)}`
    );
  }
  if (expires !== '0') {
    (allowProxyHeaderWarnings ? warnings : failures).push(
      `${route}: unexpected Expires ${JSON.stringify(expires)}`
    );
  }
  if (!/\bCookie\b/i.test(vary)) {
    (allowProxyHeaderWarnings ? warnings : failures).push(`${route}: Vary does not include Cookie`);
  }
  if (!/^(active|active-static)$/.test(renderer)) {
    (allowProxyHeaderWarnings ? warnings : failures).push(
      `${route}: unexpected X-EventFlow-Template-Renderer ${JSON.stringify(renderer)}`
    );
  }
  if (sanitizer !== 'anonymous-v2') {
    (allowProxyHeaderWarnings ? warnings : failures).push(
      `${route}: unexpected X-EventFlow-Public-Sanitizer ${JSON.stringify(sanitizer)}`
    );
  }
  return { failures, warnings };
}

async function checkPath(base, route, strict) {
  const url = `${base}${route}`;
  const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/html' } });
  if (response.status >= 300 && response.status < 400) {
    return { failures: [], warnings: [] };
  }
  if (!response.ok) {
    return { failures: [`${route}: HTTP ${response.status}`], warnings: [] };
  }
  const text = await response.text();
  const failures = [];
  const warnings = [];
  if (strict) {
    const headerResult = checkStrictHeaders(route, response.headers, {
      allowProxyHeaderWarnings: isLiveBase(base),
    });
    failures.push(...headerResult.failures);
    warnings.push(...headerResult.warnings);
  }
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
  return { failures, warnings };
}

async function main() {
  const { base, strict } = parseArgs(process.argv.slice(2));
  const routes = [...new Set(DEFAULT_PATHS)];
  const failures = [];
  const warnings = [];
  for (const route of routes) {
    try {
      const result = await checkPath(base, route, strict);
      failures.push(...result.failures);
      warnings.push(...result.warnings);
    } catch (error) {
      failures.push(`${route}: ${error.message}`);
    }
  }
  if (warnings.length) {
    console.warn(`Public render strict header warnings for ${base} (body leaks still fail hard):`);
    warnings.forEach(warning => console.warn(`- ${warning}`));
  }
  if (failures.length) {
    console.error(`Public render check failed for ${base}:`);
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Public render check passed for ${routes.length} routes at ${base}`);
  if (strict && isLiveBase(base)) {
    console.log(
      'Live strict command: npm run check:public-render -- --base=https://event-flow.co.uk --strict'
    );
  }
}

main();
