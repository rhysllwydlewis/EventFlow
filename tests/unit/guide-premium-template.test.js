'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const ARTICLE = 'public/articles/event-travel-costs-guide.html';
const CSS = 'public/assets/css/guide-premium.css';
const HARDENING_CSS = 'public/assets/css/guide-premium-hardening.css';
const TS = 'src/guides/guide-premium.ts';
const JS = 'public/assets/js/pages/guide-premium.js';
const MANIFEST = 'public/assets/data/guides.json';
const TSCONFIG = 'tsconfig.guides.json';

describe('premium guide template', () => {
  const html = read(ARTICLE);
  const css = read(CSS);
  const hardeningCss = read(HARDENING_CSS);
  const ts = read(TS);
  const js = read(JS);
  const manifest = JSON.parse(read(MANIFEST));
  const tsconfig = JSON.parse(read(TSCONFIG));

  test('the trial article opts into the template and loads its assets in order', () => {
    expect(html).toContain('<body class="gp-page">');
    expect(html).toContain('<article class="gp" data-gp-article>');
    const baseCss = html.indexOf('/assets/css/guide-premium.css');
    const hardening = html.indexOf('/assets/css/guide-premium-hardening.css');
    expect(baseCss).toBeGreaterThan(-1);
    expect(hardening).toBeGreaterThan(baseCss);
    expect(html).toContain('/assets/js/pages/guide-premium.js');
    // The template is a standalone trial: it must not inherit the legacy
    // card-layout article rules in guides.css (e.g. `article header > div`,
    // which centres the hero and adds a stray 32px margin).
    expect(html).not.toContain('/assets/css/guides.css');
  });

  test('the committed browser bundle is the actual formatted TypeScript build output', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventflow-guide-build-'));
    const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const prettier = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
    try {
      execFileSync(
        process.execPath,
        [tsc, '-p', path.join(repoRoot, TSCONFIG), '--outDir', tempDir],
        { cwd: repoRoot, stdio: 'pipe' }
      );
      const emitted = fs.readFileSync(path.join(tempDir, 'guide-premium.js'), 'utf8');
      const formatted = execFileSync(
        process.execPath,
        [prettier, '--stdin-filepath', path.join(repoRoot, JS)],
        { cwd: repoRoot, input: emitted, encoding: 'utf8' }
      );
      expect(js).toBe(formatted);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('new premium guide TypeScript is held to strict compiler settings', () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noImplicitAny).toBe(true);
    expect(tsconfig.compilerOptions.noEmitOnError).toBe(true);
  });

  test('every contents link points at a section that exists', () => {
    const sectionIds = [...html.matchAll(/data-gp-section id="([^"]+)"/g)].map(match => match[1]);
    expect(sectionIds.length).toBeGreaterThan(3);

    const tocTargets = [...html.matchAll(/class="gp-toc__link" href="#([^"]+)"/g)].map(m => m[1]);
    expect(tocTargets).toEqual(sectionIds);

    const mobileTargets = [...html.matchAll(/<li><a href="#([^"]+)">/g)].map(m => m[1]);
    expect(mobileTargets).toEqual(sectionIds);
  });

  test('the FAQ schema matches the questions rendered on the page', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const faq = blocks
      .map(block => JSON.parse(block[1]))
      .find(entry => entry['@type'] === 'FAQPage');
    expect(faq).toBeDefined();

    const schemaQuestions = faq.mainEntity.map(item => item.name);
    // Scope to the FAQ block so the contents disclosure's summary isn't counted.
    const faqBlock = html.slice(
      html.indexOf('<div class="gp-faq">'),
      html.indexOf('<div class="gp-cta')
    );
    const renderedQuestions = [...faqBlock.matchAll(/<summary>([^<]+)<\/summary>/g)].map(m => m[1]);
    expect(renderedQuestions).toEqual(schemaQuestions);
    expect(schemaQuestions.length).toBeGreaterThan(2);
  });

  test('motion is opt-out and reveal animations degrade to visible content', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    // Reveal is driven by the scroll timeline, so browsers without support
    // render the prose normally instead of leaving it stuck at opacity 0.
    expect(css).toContain('@supports (animation-timeline: view())');
    expect(css).not.toMatch(/\.gp-reveal\s*\{[^}]*opacity:\s*0/);
    expect(ts).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  test('the calculator and article agree on the current 2026/27 HMRC rate', () => {
    expect(ts).toContain('LITRES_PER_GALLON = 4.54609');
    expect(ts).toContain('HMRC_RATE_PER_MILE = 0.55');
    expect(html).toContain('55p per mile for the first 10,000 business miles');
    expect(html).toContain('effective from 6 April 2026');
    expect(html).toContain('4.54609 litres per UK gallon');
    expect(html).toContain("HMRC's current approved mileage guidance");
    expect(html).not.toMatch(/\b45p\b/);
  });

  test('the calculator default output is consistent with the 55p rate', () => {
    expect(html).toContain('data-gp-out="hmrc-amount">£66.00');
    expect(html).toContain('Reimbursing at 55p leaves <strong>£47.83</strong>');
    expect(js).toContain('HMRC_RATE_PER_MILE = 0.55');
  });

  test('fuelcosts.co.uk stays one natural followed editorial reference with referral attribution', () => {
    const links = [...html.matchAll(/<a href="https:\/\/fuelcosts\.co\.uk"([^>]*)>/g)];
    expect(links).toHaveLength(1);
    const attrs = links[0][1];
    expect(attrs).toContain('rel="noopener"');
    expect(attrs).toContain('target="_blank"');
    expect(attrs).not.toContain('noreferrer');
    expect(attrs).not.toContain('nofollow');
    expect(attrs).not.toContain('sponsored');
    expect(attrs).not.toContain('ugc');
  });

  test('the hero serves responsive image candidates instead of a fixed desktop payload', () => {
    const hero = html.match(/<img[^>]+class="gp-hero__img"[^>]+>/)?.[0] || '';
    expect(hero).toContain('srcset=');
    expect(hero).toContain('sizes="100vw"');
    expect(hero).toContain('640w');
    expect(hero).toContain('1600w');
  });

  test('hardening stylesheet fixes token scope and keeps white-text controls on dark colours', () => {
    expect(hardeningCss).toMatch(/body\.gp-page\s*\{[\s\S]*--gp-surface:\s*#fff/);
    expect(hardeningCss).toMatch(/\.gp \.gp-calc__head\s*\{[\s\S]*#086b60/);
    expect(hardeningCss).toMatch(/\.gp \*:focus-visible\s*\{[\s\S]*#0b8073/);
  });

  test('material-update metadata records this substantive September rewrite', () => {
    const guide = manifest.find(entry => entry.href === '/articles/event-travel-costs-guide');
    expect(guide).toBeDefined();
    expect(guide.publishedDate).toBe('2026-08-27');
    expect(guide.lastUpdated).toBe('2026-09-03');
    expect(guide.lastMaterialUpdate).toBe('2026-09-03');
    expect(html).toContain('property="article:modified_time"');
    expect(html).toContain('content="2026-09-03" property="article:modified_time"');
    expect(html).toContain('"dateModified": "2026-09-03"');
  });
});
