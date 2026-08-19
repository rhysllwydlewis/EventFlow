'use strict';

/**
 * Mobile media performance guardrail (SEO-006 / SEO-011) for the V3 hero
 * video. Unlike the V1/V2 hero-video-card, this one is genuinely visible
 * on mobile, so it gets a poster instead of shipping hidden. Before this
 * change, `initialisePexelsHeroVideo` only skipped eager loading for
 * `prefers-reduced-motion` / Save-Data / an explicit admin disable — a
 * mobile visitor with none of those set still triggered a full Pexels
 * fetch and video download. `home-v3-video.js` is a plain IIFE (no
 * exports), so — matching the existing convention in
 * `home-v3-pexels-video-hero.test.js` — these assertions are on the
 * rendered markup and the script source rather than executing it.
 */

const fs = require('fs');
const path = require('path');
const { buildHomepageV3Preview } = require('../../utils/template-renderer');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'public/assets/js/pages/home-v3-video.js');

function renderedV3Html() {
  return buildHomepageV3Preview(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
}

function scriptSource() {
  return fs.readFileSync(SCRIPT_PATH, 'utf8');
}

describe('home-v3 hero video mobile guardrail', () => {
  test('ships with a real poster and intrinsic dimensions so there is no layout shift', () => {
    const html = renderedV3Html();
    const videoTagMatch = html.match(/<video[\s\S]*?<\/video>/);
    expect(videoTagMatch).not.toBeNull();
    const videoTag = videoTagMatch[0];

    expect(videoTag).toMatch(/preload="none"/);
    expect(videoTag).toMatch(/poster="\/assets\/images\/hero-video-poster\.jpg"/);
    expect(videoTag).toMatch(/width="1280"/);
    expect(videoTag).toMatch(/height="854"/);
    // Still no eager <source>.
    expect(videoTag).toContain('<source type="video/mp4" data-hv3-video-source />');
  });

  test('defers the playlist fetch/source-attach to a viewport check, not just reduced-motion/save-data', () => {
    const script = scriptSource();

    expect(script).toContain('function resolveHeroVideoV3LoadMode');
    expect(script).toContain('isMobile: isMobileViewport()');
    expect(script).toContain("loadMode === 'interaction'");
    expect(script).toContain('function armHeroVideoV3ForInteraction');

    // The extracted loader is the only thing that fetches the playlist or
    // attaches a real <source>, and it must only run eagerly or after
    // interaction — never unconditionally at parse time.
    expect(script).toContain('function loadHeroVideoPlaylistAndPlay');
    expect(script).toContain('await loadHeroVideoPlaylistAndPlay(');
  });

  test('forces preload back to none while armed for interaction, even though applyPlaybackSettings defaults it to metadata', () => {
    const script = scriptSource();
    const armedFn = script.match(/function armHeroVideoV3ForInteraction\([\s\S]*?\n {2}\}/);
    expect(armedFn).not.toBeNull();
    expect(armedFn[0]).toContain("video.preload = 'none'");
  });

  test('a click or tap is what starts the real load once armed', () => {
    const script = scriptSource();
    const armedFn = script.match(/function armHeroVideoV3ForInteraction\([\s\S]*?\n {2}\}/);
    expect(armedFn[0]).toContain("addEventListener('click', startRealLoad)");
    expect(armedFn[0]).toContain("addEventListener('touchend', startRealLoad");
    // Only fires once.
    expect(armedFn[0]).toContain('if (triggered)');
  });

  test('reduced-motion and Save-Data still win over the mobile branch (folded into "disabled")', () => {
    const script = scriptSource();
    const initFn = script.match(/async function initialisePexelsHeroVideo\([\s\S]*?\n {2}\}/);
    expect(initFn).not.toBeNull();
    expect(initFn[0]).toContain(
      'const disabled = reduceMotion || saveData || shouldDisableHeroVideo(settings);'
    );
    expect(initFn[0]).toContain(
      'resolveHeroVideoV3LoadMode({ disabled, isMobile: isMobileViewport() })'
    );
  });

  test("this component's own established mobile breakpoint (720px) is reused, not a new one", () => {
    const script = scriptSource();
    expect(script).toContain("window.matchMedia?.('(max-width: 720px)').matches === true");
    // Only one breakpoint constant for "is this mobile" in this file.
    const matchMediaMobileChecks = script.match(/matchMedia\?\.\('\(max-width: \d+px\)'\)/g) || [];
    expect(matchMediaMobileChecks).toHaveLength(1);
  });
});
