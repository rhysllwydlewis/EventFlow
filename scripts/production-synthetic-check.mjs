import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import seoAudit from '../utils/seoAudit.js';

const { selectAuditEntries, validateIndexableHtml, validateSitemapXml } = seoAudit;
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
const technicalSeoAuditLimit = Math.max(1, Number(process.env.SYNTHETIC_SEO_URL_LIMIT || 60));

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
      /<html/i.test(body) && !/Join over 500\+ verified suppliers already on EventFlow/i.test(body),
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': 'EventFlow-Production-Synthetic/2.2',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runCheck(check) {
  const started = performance.now();

  try {
    const requestUrl =
      check.type === 'redirect'
        ? check.url
        : `${check.url}${check.url.includes('?') ? '&' : '?'}synthetic=${Date.now()}`;
    const response = await fetchWithTimeout(requestUrl, {
      redirect: check.redirect || 'follow',
      headers: {
        Accept: check.type === 'json' ? 'application/json' : 'text/html,text/plain,application/xml',
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
    if (performance.now() - started > timeoutMs) return result(check, started, 'slow_response');
    return result(check, started, 'pass');
  } catch (error) {
    return result(check, started, error.name === 'AbortError' ? 'timeout' : 'network_error');
  }
}

function firstSupplierProfileUrl(sitemapXml) {
  const matches = sitemapXml.matchAll(/<loc>([^<]*\/supplier\/[^<]+)<\/loc>/gi);
  for (const match of matches) {
    try {
      const candidate = new URL(match[1].replace(/&amp;/g, '&'));
      if (candidate.origin === canonicalBaseUrl && /^\/supplier\/[^/]+/.test(candidate.pathname)) {
        return candidate.href;
      }
    } catch (_error) {
      // Ignore malformed sitemap entries and continue looking for a valid supplier URL.
    }
  }
  return '';
}

function supplierProfileContract(html, expectedUrl) {
  const canonicalMatch = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const supplierIdMatch = html.match(
    /<meta\b[^>]*name=["']ef-public-supplier-id["'][^>]*content=["']([^"']+)["']/i
  );
  const robotsIndexable = /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*index/i.test(html);
  const hasJsonLd = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/i.test(html);

  return {
    valid:
      canonicalMatch?.[1] === expectedUrl &&
      Boolean(supplierIdMatch?.[1]) &&
      robotsIndexable &&
      hasJsonLd,
    supplierId: supplierIdMatch?.[1] || '',
  };
}

async function runSupplierProfileChecks() {
  const profileCheck = {
    name: 'canonical supplier profile contract',
    url: `${canonicalBaseUrl}/supplier/discovery`,
  };
  const profileStarted = performance.now();

  try {
    const sitemapResponse = await fetchWithTimeout(`${canonicalBaseUrl}/sitemap.xml`, {
      headers: { Accept: 'application/xml,text/xml,text/plain' },
    });
    if (!sitemapResponse.ok) {
      return [result(profileCheck, profileStarted, 'sitemap_http_error')];
    }

    const sitemapXml = await sitemapResponse.text();
    const profileUrl = firstSupplierProfileUrl(sitemapXml);
    if (!profileUrl) {
      return [result(profileCheck, profileStarted, 'supplier_not_discovered')];
    }

    profileCheck.url = profileUrl;
    const profileResponse = await fetchWithTimeout(profileUrl, {
      redirect: 'follow',
      headers: { Accept: 'text/html' },
    });
    if (profileResponse.status !== 200 || profileResponse.url !== profileUrl) {
      return [result(profileCheck, profileStarted, 'profile_http_error')];
    }

    const profileHtml = await profileResponse.text();
    const contract = supplierProfileContract(profileHtml, profileUrl);
    const profileResult = result(
      profileCheck,
      profileStarted,
      contract.valid ? 'pass' : 'profile_contract_invalid'
    );

    const legacyCheck = {
      name: 'legacy supplier profile redirect',
      url: `${canonicalBaseUrl}/supplier?id=${encodeURIComponent(contract.supplierId || 'missing')}`,
    };
    const legacyStarted = performance.now();

    if (!contract.supplierId) {
      return [profileResult, result(legacyCheck, legacyStarted, 'supplier_id_missing')];
    }

    const legacyResponse = await fetchWithTimeout(legacyCheck.url, {
      redirect: 'manual',
      headers: { Accept: 'text/html' },
    });
    const location = legacyResponse.headers.get('location');
    const expectedPath = new URL(profileUrl).pathname;
    const actualPath = location ? new URL(location, canonicalBaseUrl).pathname : '';
    const redirectValid = [301, 308].includes(legacyResponse.status) && actualPath === expectedPath;

    return [
      profileResult,
      result(legacyCheck, legacyStarted, redirectValid ? 'pass' : 'redirect_invalid'),
    ];
  } catch (error) {
    return [
      result(
        profileCheck,
        profileStarted,
        error.name === 'AbortError' ? 'timeout' : 'network_error'
      ),
    ];
  }
}

function requiresListingStructuredData(url) {
  try {
    return /^\/(?:supplier|package|events)\//.test(new URL(url).pathname);
  } catch (_error) {
    return false;
  }
}

async function runTechnicalSeoAudit() {
  const sitemapCheck = {
    name: 'sitemap technical SEO contract',
    url: `${canonicalBaseUrl}/sitemap.xml`,
  };
  const sitemapStarted = performance.now();

  try {
    const sitemapResponse = await fetchWithTimeout(sitemapCheck.url, {
      headers: { Accept: 'application/xml,text/xml,text/plain' },
    });
    if (sitemapResponse.status !== 200) {
      return [result(sitemapCheck, sitemapStarted, 'sitemap_http_error')];
    }

    const sitemapXml = await sitemapResponse.text();
    const sitemapContract = validateSitemapXml(sitemapXml, canonicalBaseUrl);
    const sitemapResult = result(
      sitemapCheck,
      sitemapStarted,
      sitemapContract.valid ? 'pass' : 'sitemap_contract_invalid'
    );
    if (!sitemapContract.valid) {
      sitemapResult.details = sitemapContract.issues.slice(0, 20);
      return [sitemapResult];
    }

    const crawlCheck = {
      name: 'sitemap URL indexability crawl',
      url: `${canonicalBaseUrl}/sitemap.xml`,
    };
    const crawlStarted = performance.now();
    const failures = [];
    const entries = selectAuditEntries(sitemapContract.entries, technicalSeoAuditLimit);

    for (const entry of entries) {
      try {
        const response = await fetchWithTimeout(entry.url, {
          redirect: 'follow',
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        if (response.status !== 200) {
          failures.push(`${entry.url}: HTTP ${response.status}`);
          continue;
        }
        if (response.url !== entry.url) {
          failures.push(`${entry.url}: redirected to ${response.url}`);
          continue;
        }

        const html = await response.text();
        const contract = validateIndexableHtml({
          html,
          expectedUrl: entry.url,
          headers: response.headers,
          requireStructuredData: requiresListingStructuredData(entry.url),
        });
        if (!contract.valid) {
          failures.push(`${entry.url}: ${contract.issues.join(', ')}`);
        }
      } catch (error) {
        failures.push(`${entry.url}: ${error.name === 'AbortError' ? 'timeout' : 'network error'}`);
      }
    }

    const crawlResult = result(
      crawlCheck,
      crawlStarted,
      failures.length === 0 ? 'pass' : 'indexability_contract_invalid'
    );
    crawlResult.details = failures.slice(0, 20);
    crawlResult.auditedUrls = entries.length;
    return [sitemapResult, crawlResult];
  } catch (error) {
    return [
      result(
        sitemapCheck,
        sitemapStarted,
        error.name === 'AbortError' ? 'timeout' : 'network_error'
      ),
    ];
  }
}

const results = [];
for (const check of checks) {
  // Sequential execution keeps the monitor deliberately low-impact and diagnosable.
  results.push(await runCheck(check));
}
results.push(...(await runSupplierProfileChecks()));
results.push(...(await runTechnicalSeoAudit()));

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
