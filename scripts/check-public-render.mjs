#!/usr/bin/env node

/**
 * Public render checker for launch mop-up work.
 *
 * This is deliberately small and dependency-free so it can be run against a
 * local server or the live deployment:
 *
 *   EVENTFLOW_PUBLIC_BASE_URL=https://event-flow.co.uk node scripts/check-public-render.mjs --strict
 *
 * Without --strict it prints a report and exits 0. With --strict it exits 1 if
 * stale/leaked public text is found.
 */

const baseUrl = (process.env.EVENTFLOW_PUBLIC_BASE_URL || process.argv.find(arg => arg.startsWith('--base='))?.slice(7) || 'http://localhost:3000').replace(/\/$/, '');
const strict = process.argv.includes('--strict') || process.env.EVENTFLOW_PUBLIC_RENDER_STRICT === '1';

const pages = [
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
];

const globalBanned = [
  /Version:\s*loading/i,
  /Mark all as read/i,
  /View all/i,
  /Dashboard\s+Log out/i,
];

const pageBanned = {
  '/': [
    /What Our Customers Say/i,
    /Real experiences from real event planners/i,
    /Sarah\s*&(?:amp;)?\s*Tom/i,
    /James Wilson/i,
    /Emma Davies/i,
    /Explore our full range of verified UK suppliers/i,
  ],
  '/public-calendar': [
    /pending_review/i,
    /rejected/i,
    /Calendar publishing requests/i,
    /Approve suitable suppliers/i,
    /admin override/i,
    /Shared Events Calendar publishing enabled/i,
    />\s*Add Event\s*</i,
    />\s*Publish Event\s*</i,
  ],
  '/guides': [
    />\s*Loading guides…\s*</i,
  ],
};

const expectedText = {
  '/': [/EventFlow is opening|Early access|Start planning/i],
  '/start': [/Plan your event in minutes|Start Planning Your Event/i],
  '/public-calendar': [/All upcoming events|Events Calendar/i],
};

async function fetchText(pathname) {
  const url = `${baseUrl}${pathname}`;
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'EventFlow-public-render-checker/1.0',
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    },
  });
  const text = await response.text();
  return { url, status: response.status, ok: response.ok, text };
}

function findPatterns(text, patterns) {
  return patterns
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.toString());
}

const findings = [];

console.log(`Checking public render at ${baseUrl}`);
console.log(`Mode: ${strict ? 'strict' : 'report-only'}\n`);

for (const page of pages) {
  try {
    const { url, status, ok, text } = await fetchText(page);
    const banned = [...globalBanned, ...(pageBanned[page] || [])];
    const hits = findPatterns(text, banned);
    const expectedMissing = (expectedText[page] || [])
      .filter(pattern => !pattern.test(text))
      .map(pattern => pattern.toString());

    if (!ok) {
      findings.push({ page, issue: `HTTP ${status}`, patterns: [] });
      console.log(`✖ ${page} — HTTP ${status}`);
      continue;
    }

    if (hits.length || expectedMissing.length) {
      findings.push({ page, issue: 'public render mismatch', patterns: hits, expectedMissing });
      console.log(`⚠ ${page} — ${url}`);
      if (hits.length) {
        console.log(`  banned text found: ${hits.join(', ')}`);
      }
      if (expectedMissing.length) {
        console.log(`  expected text missing: ${expectedMissing.join(', ')}`);
      }
    } else {
      console.log(`✓ ${page}`);
    }
  } catch (error) {
    findings.push({ page, issue: error.message, patterns: [] });
    console.log(`✖ ${page} — ${error.message}`);
  }
}

try {
  const meta = await fetchText('/build-meta.json');
  if (meta.ok) {
    console.log('\n✓ /build-meta.json is reachable');
    console.log(meta.text.slice(0, 300).trim());
  } else {
    console.log(`\n⚠ /build-meta.json returned HTTP ${meta.status}`);
  }
} catch (error) {
  console.log(`\n⚠ /build-meta.json check failed: ${error.message}`);
}

if (findings.length) {
  console.log(`\n${findings.length} public render issue group(s) found.`);
  if (strict) {
    process.exitCode = 1;
  }
} else {
  console.log('\nNo public render issues found.');
}
