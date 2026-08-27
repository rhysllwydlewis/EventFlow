import { chromium } from 'playwright';

const BASE_URL = 'https://event-flow.co.uk';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function inspect(url) {
  const page = await context.newPage();
  const badResponses = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      badResponses.push({ status: response.status(), url: response.url() });
    }
  });
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(page);
    const result = await page.evaluate(() => {
      const media = document.querySelector('#supplier-hero .hero-media');
      const img = document.querySelector('#hero-banner');
      return {
        finalUrl: location.href,
        statusText: document.title,
        h1: document.querySelector('#hero-title')?.textContent?.trim() || '',
        mode: document.documentElement.getAttribute('data-sp-hero-mode'),
        themeReady: document.documentElement.getAttribute('data-sp-theme-ready'),
        heroMediaHeight: media ? Math.round(media.getBoundingClientRect().height * 10) / 10 : null,
        imageSrc: img?.currentSrc || img?.src || '',
        fallback: media?.classList.contains('sp-hero-media--fallback') || false,
        unclaimed: Boolean(document.querySelector('#supplier-bot-unclaimed-banner')),
      };
    });
    result.httpStatus = response?.status() || null;
    result.badResponses = badResponses;
    return result;
  } catch (error) {
    return { finalUrl: url, error: error.message, badResponses };
  } finally {
    await page.close();
  }
}

const hensol = await inspect(`${BASE_URL}/supplier/hensol-castle`);
const directory = await context.newPage();
await directory.goto(`${BASE_URL}/suppliers`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(directory);
const links = await directory.locator('a[href*="/supplier/"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.href).filter(Boolean))]);
await directory.close();

const candidates = [];
let matched = null;
for (const link of links.slice(0, 40)) {
  if (link.includes('/supplier/hensol-castle')) continue;
  const result = await inspect(link);
  if (result.httpStatus >= 400 || result.unclaimed || !result.h1) continue;
  candidates.push(result);
  if (!matched && result.heroMediaHeight === hensol.heroMediaHeight && result.mode === hensol.mode) {
    matched = result;
  }
  if (!matched && result.heroMediaHeight === hensol.heroMediaHeight && !result.fallback) {
    matched = result;
  }
  if (matched && candidates.length >= 8) break;
}

console.log(JSON.stringify({ hensol, matched, candidates }, null, 2));
await context.close();
await browser.close();
