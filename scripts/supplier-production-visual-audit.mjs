import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://event-flow.co.uk';
const HENSOL_ALIAS = `${BASE_URL}/supplier/hensol-castle`;
const OUT_DIR = path.resolve('artifacts/supplier-production-visual-audit');

const devices = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-15-pro', width: 393, height: 852 },
  { name: 'pixel-8', width: 412, height: 915 },
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'small-tablet', width: 600, height: 960 },
  { name: 'ipad-mini', width: 768, height: 1024 },
  { name: 'ipad-pro-11', width: 834, height: 1194 },
  { name: 'ipad-pro-12-9', width: 1024, height: 1366 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

const fullPageDevices = new Set([
  'iphone-se',
  'iphone-15-pro-max',
  'ipad-mini',
  'ipad-pro-12-9',
  'desktop-1440',
  'desktop-1920',
]);

await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const accept = page.getByRole('button', { name: /accept( all)?|allow all/i }).first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.waitForFunction(
    () => Array.from(document.images).every(img => img.complete),
    { timeout: 12000 }
  ).catch(() => {});

  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.7));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(350);
}

async function discoverRegularSupplier(context) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/suppliers`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);

  const candidates = await page.locator('a[href*="/supplier/"]').evaluateAll(anchors =>
    anchors
      .map(a => a.href)
      .filter(Boolean)
      .filter(href => !href.includes('/supplier/hensol-castle'))
  );

  const unique = [...new Set(candidates)];
  if (!unique.length) {
    throw new Error('Could not discover a regular public supplier profile from /suppliers');
  }

  for (const candidate of unique) {
    const probe = await context.newPage();
    try {
      const response = await probe.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(probe);
      const status = response?.status() || 0;
      const hasHero = await probe.locator('#supplier-hero').count();
      const hasUnclaimed = await probe.locator('#supplier-bot-unclaimed-banner').count();
      if (status < 400 && hasHero && !hasUnclaimed) {
        const result = { discoveredHref: candidate, finalUrl: probe.url() };
        await probe.close();
        await page.close();
        return result;
      }
    } catch {
      // Keep probing visible directory profiles until one resolves cleanly.
    }
    await probe.close();
  }

  await page.close();
  throw new Error('Supplier links were found, but none resolved to a regular claimed public profile');
}

function attachDiagnostics(page) {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', request => {
    diagnostics.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
  });
  return diagnostics;
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const selectorFor = el => {
      if (!el) return null;
      if (el.id) return `#${el.id}`;
      const classes = [...el.classList].slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };

    const measure = selector => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector,
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        display: style.display,
        position: style.position,
        fontSize: style.fontSize,
        overflowX: style.overflowX,
      };
    };

    const keySelectors = [
      'header.ef-header',
      '#supplier-bot-unclaimed-banner',
      '.supplier-breadcrumb',
      '#supplier-hero',
      '#supplier-hero .hero-media',
      '#supplier-hero .hero-content',
      '#supplier-hero .hero-identity',
      '#supplier-hero .hero-actions',
      'main',
      'footer',
    ];

    const overflowElements = Array.from(document.querySelectorAll('body *'))
      .filter(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .slice(0, 30)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          selector: selectorFor(el),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    const banner = document.querySelector('#supplier-bot-unclaimed-banner');
    const header = document.querySelector('header.ef-header');
    const hero = document.querySelector('#supplier-hero');
    const bannerRect = banner?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const heroRect = hero?.getBoundingClientRect();

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      },
      title: document.title,
      h1: document.querySelector('#hero-title')?.textContent?.trim() || '',
      bannerText: banner?.textContent?.trim() || '',
      bannerHeight: bannerRect ? Math.round(bannerRect.height * 10) / 10 : 0,
      normalized: {
        headerYWithoutBanner: headerRect ? Math.round((headerRect.y - (bannerRect?.height || 0)) * 10) / 10 : null,
        heroYRelativeToHeader: heroRect && headerRect ? Math.round((heroRect.y - headerRect.y) * 10) / 10 : null,
      },
      key: Object.fromEntries(keySelectors.map(selector => [selector, measure(selector)])),
      overflowElements,
    };
  });
}

async function auditProfile(context, profileName, url, device) {
  const page = await context.newPage();
  await page.setViewportSize({ width: device.width, height: device.height });
  const diagnostics = attachDiagnostics(page);

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);

  const prefix = `${profileName}__${device.name}__${device.width}x${device.height}`;
  await page.screenshot({ path: path.join(OUT_DIR, `${prefix}__viewport.png`), fullPage: false });
  if (fullPageDevices.has(device.name)) {
    await page.screenshot({ path: path.join(OUT_DIR, `${prefix}__full.png`), fullPage: true });
  }

  const layout = await collectLayout(page);
  const result = {
    profileName,
    requestedUrl: url,
    finalUrl: page.url(),
    httpStatus: response?.status() || null,
    device,
    layout,
    diagnostics,
  };

  await page.close();
  return result;
}

function comparePair(hensol, regular) {
  const h = hensol.layout;
  const r = regular.layout;
  const sharedSelectors = [
    'header.ef-header',
    '.supplier-breadcrumb',
    '#supplier-hero',
    '#supplier-hero .hero-media',
    '#supplier-hero .hero-content',
    '#supplier-hero .hero-identity',
    '#supplier-hero .hero-actions',
  ];

  const deltas = {};
  for (const selector of sharedSelectors) {
    const a = h.key[selector];
    const b = r.key[selector];
    if (!a || !b) continue;
    deltas[selector] = {
      x: Math.round((a.x - b.x) * 10) / 10,
      width: Math.round((a.width - b.width) * 10) / 10,
      height: Math.round((a.height - b.height) * 10) / 10,
    };
  }

  const structuralPass = Object.values(deltas).every(delta =>
    Math.abs(delta.x) <= 2 && Math.abs(delta.width) <= 2
  );

  return {
    device: hensol.device,
    hensolFinalUrl: hensol.finalUrl,
    regularFinalUrl: regular.finalUrl,
    hensolHasExpectedBanner: Boolean(h.bannerText) && /unclaimed profile/i.test(h.bannerText),
    regularHasNoUnclaimedBanner: !r.bannerText,
    hensolHorizontalOverflow: h.document.horizontalOverflow,
    regularHorizontalOverflow: r.document.horizontalOverflow,
    normalizedHeaderYOffset: h.normalized.headerYWithoutBanner,
    regularHeaderY: r.key['header.ef-header']?.y ?? null,
    structuralPass,
    deltas,
  };
}

const discoveryContext = await browser.newContext();
const regularSupplier = await discoverRegularSupplier(discoveryContext);
await discoveryContext.close();

const results = [];
for (const device of devices) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: 1,
    isMobile: device.width < 600,
    hasTouch: device.width < 1100,
  });

  const hensol = await auditProfile(context, 'hensol-unclaimed', HENSOL_ALIAS, device);
  const regular = await auditProfile(context, 'regular-claimed', regularSupplier.finalUrl, device);
  results.push({ hensol, regular, comparison: comparePair(hensol, regular) });
  await context.close();
}

await browser.close();

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  hensolAlias: HENSOL_ALIAS,
  regularSupplier,
  devices: devices.length,
  passes: results.filter(item => item.comparison.structuralPass).length,
  overflowFailures: results.filter(
    item => item.comparison.hensolHorizontalOverflow || item.comparison.regularHorizontalOverflow
  ).map(item => item.comparison.device.name),
  bannerFailures: results.filter(
    item => !item.comparison.hensolHasExpectedBanner || !item.comparison.regularHasNoUnclaimedBanner
  ).map(item => item.comparison.device.name),
};

await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ summary, results }, null, 2));

const markdown = [
  '# EventFlow supplier production responsive audit',
  '',
  `Generated: ${summary.generatedAt}`,
  `Hensol: ${HENSOL_ALIAS}`,
  `Regular supplier: ${regularSupplier.finalUrl}`,
  '',
  `Structural width/alignment passes: ${summary.passes}/${summary.devices}`,
  `Horizontal overflow failures: ${summary.overflowFailures.length ? summary.overflowFailures.join(', ') : 'none'}`,
  `Claim/unclaimed banner failures: ${summary.bannerFailures.length ? summary.bannerFailures.join(', ') : 'none'}`,
  '',
  '| Device | Hensol | Regular | Width/alignment | H overflow | Regular overflow |',
  '|---|---:|---:|---|---|---|',
  ...results.map(({ comparison: c }) =>
    `| ${c.device.name} (${c.device.width}×${c.device.height}) | ${c.hensolHasExpectedBanner ? 'banner ✓' : 'banner ✗'} | ${c.regularHasNoUnclaimedBanner ? 'no banner ✓' : 'banner ✗'} | ${c.structuralPass ? 'PASS' : 'CHECK'} | ${c.hensolHorizontalOverflow ? 'YES' : 'no'} | ${c.regularHorizontalOverflow ? 'YES' : 'no'} |`
  ),
  '',
];
await fs.writeFile(path.join(OUT_DIR, 'SUMMARY.md'), markdown.join('\n'));

console.log(JSON.stringify(summary, null, 2));
