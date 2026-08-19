'use strict';

/**
 * Mobile media performance guardrail (SEO-006 / SEO-011).
 *
 * A mobile lab run against the homepage measured ~32MB transferred and a
 * 14s LCP. `.hero-video-card` renders with `display: none !important` on
 * every viewport (see hero-modern.css), yet `initHeroVideo` used to fetch
 * the Pexels API, attach a real `<source src>` and call
 * `.load()`/`.play()` for it unconditionally. These tests pin the decision
 * table that now gates that call, and the markup/behaviour changes that
 * enforce it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(ROOT, 'public/assets/js/collage/hero-collage.js');
const INDEX_PATH = path.join(ROOT, 'public/index.html');
const HOME_V2_PATH = path.join(ROOT, 'public/home-v2.html');

const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
const homeV2Html = fs.readFileSync(HOME_V2_PATH, 'utf8');

/** Same sandbox shape as hero-collage-module.test.js. */
function loadModule() {
  const sandbox = {
    window: {},
    navigator: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
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

describe('hero video mobile guardrail: resolveHeroVideoLoadMode', () => {
  test('loads eagerly on desktop with no accessibility/data preferences set', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(
      resolveHeroVideoLoadMode({
        heroVideoEnabled: true,
        prefersReducedMotion: false,
        prefersReducedData: false,
        saveData: false,
        isMobileViewport: false,
      })
    ).toBe('eager');
  });

  test('defers to interaction on mobile even when every admin flag says videos are on', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    // This is the exact stale-settings scenario from the audit: an older
    // stored homepage-settings record with videos enabled and no explicit
    // mobile opt-out.
    expect(
      resolveHeroVideoLoadMode({
        heroVideoEnabled: true,
        prefersReducedMotion: false,
        prefersReducedData: false,
        saveData: false,
        isMobileViewport: true,
      })
    ).toBe('interaction');
  });

  test('mobile deferral cannot be bypassed by any combination of the other inputs staying "enabled"', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    const permutations = [
      {
        heroVideoEnabled: true,
        prefersReducedMotion: false,
        prefersReducedData: false,
        saveData: false,
      },
      {
        heroVideoEnabled: true,
        prefersReducedMotion: false,
        prefersReducedData: false,
        saveData: true,
      },
    ];
    permutations.forEach(context => {
      expect(resolveHeroVideoLoadMode({ ...context, isMobileViewport: true })).not.toBe('eager');
    });
  });

  test('prefers-reduced-motion skips the video entirely, desktop or mobile', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode({ prefersReducedMotion: true, isMobileViewport: false })).toBe(
      'skip'
    );
    expect(resolveHeroVideoLoadMode({ prefersReducedMotion: true, isMobileViewport: true })).toBe(
      'skip'
    );
  });

  test('prefers-reduced-data and Save-Data both skip the video, desktop or mobile', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode({ prefersReducedData: true, isMobileViewport: false })).toBe(
      'skip'
    );
    expect(resolveHeroVideoLoadMode({ saveData: true, isMobileViewport: false })).toBe('skip');
    expect(resolveHeroVideoLoadMode({ saveData: true, isMobileViewport: true })).toBe('skip');
  });

  test('an explicitly disabled hero video always skips, regardless of viewport', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode({ heroVideoEnabled: false, isMobileViewport: false })).toBe(
      'skip'
    );
    expect(resolveHeroVideoLoadMode({ heroVideoEnabled: false, isMobileViewport: true })).toBe(
      'skip'
    );
  });

  test('defaults (no context passed) behave like a fully-enabled desktop visitor', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode()).toBe('eager');
  });

  test('an unreachable card (hidden or inert) always skips, desktop or mobile, regardless of every other flag', () => {
    // `.hero-video-card` ships `display: none !important` unconditionally
    // in hero-modern.css (every viewport, both index.html and
    // home-v2.html) and index.html additionally wraps it in `inert`. If
    // isCardReachable is false, no other input may override that — this
    // is the check that closes the desktop half of the SEO-006/SEO-011
    // defect (eager mode used to fetch the Pexels API for an invisible
    // element on desktop too, since the old guardrail only looked at
    // viewport width).
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode({ isCardReachable: false, isMobileViewport: false })).toBe(
      'skip'
    );
    expect(resolveHeroVideoLoadMode({ isCardReachable: false, isMobileViewport: true })).toBe(
      'skip'
    );
    expect(
      resolveHeroVideoLoadMode({
        isCardReachable: false,
        isMobileViewport: false,
        heroVideoEnabled: true,
        prefersReducedMotion: false,
        prefersReducedData: false,
        saveData: false,
      })
    ).toBe('skip');
  });

  test('a reachable card on desktop still loads eagerly (isCardReachable defaults to true)', () => {
    const { resolveHeroVideoLoadMode } = loadModule();
    expect(resolveHeroVideoLoadMode({ isCardReachable: true, isMobileViewport: false })).toBe(
      'eager'
    );
    expect(resolveHeroVideoLoadMode({ isCardReachable: true, isMobileViewport: true })).toBe(
      'interaction'
    );
  });
});

describe('hero video mobile guardrail: isHeroVideoCardReachable', () => {
  test('is false when the card is display:none', () => {
    const sandbox = loadModule();
    sandbox.window.getComputedStyle = () => ({ display: 'none' });
    const videoCard = { closest: () => null };
    expect(sandbox.isHeroVideoCardReachable(videoCard)).toBe(false);
  });

  test('is false when the card sits inside an inert ancestor, even if it computes as visible', () => {
    const sandbox = loadModule();
    sandbox.window.getComputedStyle = () => ({ display: 'block' });
    const videoCard = { closest: selector => (selector === '[inert]' ? {} : null) };
    expect(sandbox.isHeroVideoCardReachable(videoCard)).toBe(false);
  });

  test('is true when the card is visible and not inert', () => {
    const sandbox = loadModule();
    sandbox.window.getComputedStyle = () => ({ display: 'block' });
    const videoCard = { closest: () => null };
    expect(sandbox.isHeroVideoCardReachable(videoCard)).toBe(true);
  });

  test('is false for a null card, or when getComputedStyle is unavailable, rather than throwing', () => {
    const sandbox = loadModule();
    sandbox.window.getComputedStyle = () => ({ display: 'block' });
    expect(sandbox.isHeroVideoCardReachable(null)).toBe(false);

    delete sandbox.window.getComputedStyle;
    expect(sandbox.isHeroVideoCardReachable({ closest: () => null })).toBe(false);
  });
});

describe('hero video mobile guardrail: isHeroVideoMobileViewport', () => {
  test('uses the site-wide 768px mobile breakpoint already established elsewhere', () => {
    const sandbox = loadModule();
    const queries = [];
    sandbox.window.matchMedia = query => {
      queries.push(query);
      return { matches: query === '(max-width: 768px)' };
    };
    expect(sandbox.isHeroVideoMobileViewport()).toBe(true);
    expect(queries).toContain('(max-width: 768px)');
  });

  test('is false when matchMedia is unavailable rather than throwing', () => {
    const sandbox = loadModule();
    delete sandbox.window.matchMedia;
    expect(sandbox.isHeroVideoMobileViewport()).toBe(false);
  });
});

describe('hero video mobile guardrail: armHeroVideoForInteraction', () => {
  test('does not call initHeroVideo until the card is clicked or tapped', () => {
    const sandbox = loadModule();
    const listeners = {};
    const videoCard = {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
      removeEventListener: () => {},
    };
    sandbox.document.querySelector = selector =>
      selector === '.hero-video-card' ? videoCard : null;
    sandbox.document.getElementById = id => (id === 'hero-pexels-video' ? {} : null);

    let calls = 0;
    sandbox.initHeroVideo = (...args) => {
      calls += 1;
      return args;
    };

    sandbox.armHeroVideoForInteraction(['pexels', {}, [], {}, null]);

    // No interaction yet: no network-triggering call.
    expect(calls).toBe(0);
    expect(typeof listeners.click).toBe('function');
    expect(typeof listeners.touchend).toBe('function');

    // Explicit interaction: now it may load.
    listeners.click();
    expect(calls).toBe(1);

    // A second interaction does not double-fire.
    listeners.touchend();
    expect(calls).toBe(1);
  });
});

describe('hero video mobile guardrail: markup', () => {
  test.each([
    ['index.html (V1)', indexHtml],
    ['home-v2.html (V2)', homeV2Html],
  ])(
    '%s ships the hero video with preload="none" and a sized poster from first paint',
    (_label, html) => {
      const videoTagMatch = html.match(/<video id="hero-pexels-video"[\s\S]*?<\/video>/);
      expect(videoTagMatch).not.toBeNull();
      const videoTag = videoTagMatch[0];

      // Never metadata/auto: nothing should be fetched before JS decides to.
      expect(videoTag).toMatch(/preload="none"/);
      expect(videoTag).not.toMatch(/preload="(metadata|auto)"/);

      // A real poster with real intrinsic dimensions, so there is no layout
      // shift once JS (or a real video) replaces it.
      expect(videoTag).toMatch(/poster="\/assets\/images\/hero-video-poster\.jpg"/);
      expect(videoTag).toMatch(/width="800"/);
      expect(videoTag).toMatch(/height="450"/);

      // The <source> is empty until JS decides to attach a real one.
      expect(videoTag).toMatch(/<source src="" type="video\/mp4" id="hero-video-source">/);
    }
  );

  test('the hero video card is display:none on every viewport, confirming why an eager fetch was pure waste', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public/assets/css/hero-modern.css'), 'utf8');
    expect(css).toMatch(/\.hero-video-card\s*\{\s*display:\s*none\s*!important;\s*\}/);
  });
});
