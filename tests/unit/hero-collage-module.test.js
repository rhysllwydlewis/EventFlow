'use strict';

/**
 * The hero collage was lifted out of home-init.js so homepage V2 could reuse
 * it. These tests pin the contract that split relies on: the facade both
 * homepages call, the one-way dependency between the two files, and the URL
 * guards that keep admin-supplied media from becoming an injection vector.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(ROOT, 'public/assets/js/collage/hero-collage.js');
const HOME_INIT_PATH = path.join(ROOT, 'public/assets/js/pages/home-init.js');
const HOME_V2_HERO_PATH = path.join(ROOT, 'public/assets/js/pages/home-v2-hero.js');
const INDEX_PATH = path.join(ROOT, 'public/index.html');

const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
const homeInitSource = fs.readFileSync(HOME_INIT_PATH, 'utf8');
const homeV2HeroSource = fs.readFileSync(HOME_V2_HERO_PATH, 'utf8');
const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');

function topLevelFunctions(source) {
  return new Set(
    Array.from(source.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\(/gm), m => m[1])
  );
}

/**
 * Evaluate the module in a bare sandbox. It is a classic script, so its
 * declarations land on the sandbox's global object exactly as they do on the
 * page. Nothing here touches the DOM at load time beyond the debug log guard.
 */
function loadModule() {
  const sandbox = {
    window: {},
    navigator: {},
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.window = sandbox;
  sandbox.window.location = { hostname: 'event-flow.co.uk', search: '' };
  sandbox.location = sandbox.window.location;
  vm.createContext(sandbox);
  vm.runInContext(moduleSource, sandbox);
  return sandbox;
}

describe('shared hero collage module', () => {
  test('exposes the facade both homepages drive it through', () => {
    const sandbox = loadModule();

    expect(typeof sandbox.window.EFHeroCollage).toBe('object');
    for (const method of ['load', 'cleanup', 'initErrorHandlers', 'initParallax']) {
      expect(typeof sandbox.window.EFHeroCollage[method]).toBe('function');
    }
  });

  test('initialises the video metrics tracker without home-init.js present', () => {
    // V2 loads the module on its own, so the counters the collage increments
    // cannot assume home-init.js declared them first.
    const sandbox = loadModule();

    expect(sandbox.window.__videoMetrics__).toEqual(
      expect.objectContaining({
        collageVideoAttempts: 0,
        collageVideoSuccesses: 0,
        collageVideoFailures: 0,
        lastError: null,
      })
    );
  });

  test('rejects media URLs that are not HTTP(S)', () => {
    const { window } = loadModule();
    const { validateUploadUrl, validatePexelsUrl } = window.EFHeroCollage;

    expect(validateUploadUrl('https://images.pexels.com/photo.jpg')).toBe(true);
    expect(validateUploadUrl('http://example.com/photo.jpg')).toBe(true);
    expect(validateUploadUrl('javascript:alert(1)')).toBe(false);
    expect(validateUploadUrl('data:text/html;base64,PHN2Zz4=')).toBe(false);
    expect(validateUploadUrl('')).toBe(false);
    expect(validateUploadUrl(null)).toBe(false);

    // validatePexelsUrl returns a safe href rather than a boolean: anything
    // that is not an https pexels.com URL collapses to the Pexels home page,
    // so a hostile creator link cannot become the credit anchor's href.
    expect(validatePexelsUrl('https://www.pexels.com/@someone')).toBe(
      'https://www.pexels.com/@someone'
    );
    expect(validatePexelsUrl('javascript:alert(1)')).toBe('https://www.pexels.com');
    expect(validatePexelsUrl('http://www.pexels.com/@someone')).toBe('https://www.pexels.com');
    expect(validatePexelsUrl('https://pexels.com.evil.test/@someone')).toBe(
      'https://www.pexels.com'
    );
    expect(validatePexelsUrl(null)).toBe('https://www.pexels.com');
  });

  test('the dependency between the module and home-init.js runs one way only', () => {
    const moduleFunctions = topLevelFunctions(moduleSource);
    const homeInitFunctions = topLevelFunctions(homeInitSource);

    // No duplicate globals: a second declaration would silently shadow the first.
    const duplicates = [...moduleFunctions].filter(name => homeInitFunctions.has(name));
    expect(duplicates).toEqual([]);

    // The module must not reach back into home-init.js, or V2 breaks.
    const referencedByModule = new Set(
      Array.from(moduleSource.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g), m => m[1])
    );
    const reachBack = [...referencedByModule].filter(
      name => homeInitFunctions.has(name) && !moduleFunctions.has(name)
    );
    expect(reachBack).toEqual([]);
  });

  test('home-init.js drives the collage through the facade', () => {
    expect(homeInitSource).toContain('window.EFHeroCollage.load()');
    expect(homeInitSource).toContain('window.EFHeroCollage.cleanup()');
    expect(homeInitSource).toContain('window.EFHeroCollage.initErrorHandlers()');
    expect(homeInitSource).toContain('window.EFHeroCollage.initParallax()');

    // The implementation itself is gone from home-init.js.
    expect(homeInitSource).not.toMatch(/^function loadHeroCollageImages\(/m);
    expect(homeInitSource).not.toMatch(/^async function initCollageWidget\(/m);
  });

  test('home-v2-hero.js mirrors the same calls for V2', () => {
    expect(homeV2HeroSource).toContain('api.load()');
    expect(homeV2HeroSource).toContain('api.initErrorHandlers()');
    expect(homeV2HeroSource).toContain('api.initParallax()');
    expect(homeV2HeroSource).toContain('api.cleanup()');
  });

  test('index.html loads the module before home-init.js, which depends on its globals', () => {
    const moduleIndex = indexHtml.indexOf('/assets/js/collage/hero-collage.js');
    const homeInitIndex = indexHtml.indexOf('/assets/js/pages/home-init.js');

    expect(moduleIndex).toBeGreaterThan(-1);
    expect(homeInitIndex).toBeGreaterThan(moduleIndex);

    // home-init.js keeps calling these but no longer declares them.
    expect(homeInitSource).toMatch(/\bisDebugEnabled\(\)/);
    expect(moduleSource).toMatch(/^function isDebugEnabled\(/m);
    expect(moduleSource).toMatch(/^function isDevelopmentEnvironment\(/m);
  });
});
