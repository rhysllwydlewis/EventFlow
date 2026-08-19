const { test, expect } = require('@playwright/test');

/**
 * Mobile media performance guardrail (SEO-006 / SEO-011).
 *
 * A mobile lab run against the homepage measured ~32MB transferred and a
 * 14s LCP. `.hero-video-card` (#hero-pexels-video) renders with
 * `display: none !important` on every viewport (see hero-modern.css), yet
 * the JS used to fetch the Pexels video API and attach a real
 * `<source src>` unconditionally — a hidden element that still pulls a
 * full video payload. This is a confirmed performance/UX defect (Search
 * Console/CrUX does not yet have enough field data to attribute a ranking
 * effect to it), not a ranking claim.
 *
 * These tests mock the homepage-settings and Pexels-video endpoints so the
 * scenario is deterministic: a "stale" stored settings record with videos
 * enabled and `mobileOptimizations.disableVideos` left at its default
 * (`false`) — exactly the record the guardrail must not be bypassable by.
 */

const STALE_ENABLED_SETTINGS = {
  collageWidget: {
    enabled: true,
    source: 'pexels',
    intervalSeconds: 6,
    mediaTypes: { photos: true, videos: true },
    pexelsQueries: { venues: 'wedding venue', catering: 'catering', entertainment: 'dj', photography: 'photographer' },
    uploadGallery: [],
    fallbackToPexels: true,
    heroVideo: { enabled: true, autoplay: true, muted: true, loop: true, quality: 'sd' },
    transition: { effect: 'fade', duration: 800 },
    preloading: { enabled: true, count: 1 },
    // The pre-fix default: the admin never explicitly opted into disabling
    // mobile video, so this stays false on older stored records.
    mobileOptimizations: { slowerTransitions: true, disableVideos: false, touchControls: true },
    contentFiltering: { aspectRatio: 'any', orientation: 'any', minResolution: 'SD' },
    playbackControls: { showControls: false, pauseOnHover: false, fullscreen: false },
  },
};

const FAKE_VIDEO_RESPONSE = {
  videos: [
    {
      id: 1,
      image: 'https://images.pexels.com/videos/0/fake-thumb.jpg',
      video_files: [
        {
          link: 'https://videos.pexels.com/video-files/0/fake-mobile-guardrail.mp4',
          file_type: 'video/mp4',
          quality: 'sd',
          width: 640,
          height: 360,
        },
      ],
    },
  ],
};

async function mockHeroVideoBackend(page) {
  await page.route('**/api/v1/public/homepage-settings*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STALE_ENABLED_SETTINGS) })
  );
  await page.route('**/api/admin/public/pexels-video*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VIDEO_RESPONSE) })
  );
  // The four collage category cards call this; an empty result just falls
  // back to the default static images already in the HTML, which is fine —
  // it is not what this suite is testing.
  await page.route('**/api/v1/admin/public/pexels-collage*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ photos: [], videos: [] }) })
  );
}

/** True if a request URL is the hero video fetch or a raw mp4 payload. */
function isHeroVideoRequest(url) {
  return url.includes('/api/admin/public/pexels-video') || /\.mp4(\?|$)/i.test(url);
}

test.describe('Hero video mobile guardrail', () => {
  test('mobile viewport: no video request before interaction, even with a stale "videos enabled" record', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockHeroVideoBackend(page);

    const heroVideoRequests = [];
    page.on('request', request => {
      if (isHeroVideoRequest(request.url())) {
        heroVideoRequests.push(request.url());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    expect(heroVideoRequests).toEqual([]);

    // No <source src> should have been assigned before interaction.
    const srcBeforeInteraction = await page.locator('#hero-video-source').getAttribute('src');
    expect(srcBeforeInteraction || '').toBe('');

    // `.hero-video-card` ships `display: none` / `inert` (decorative, not
    // yet re-enabled for mobile), so real pointer input can't reach it —
    // dispatch the interaction event directly, which is exactly what the
    // guardrail's click/touchend listener is waiting for.
    await page.evaluate(() => {
      document.querySelector('.hero-video-card')?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.waitForTimeout(1000);

    expect(heroVideoRequests.length).toBeGreaterThan(0);
  });

  test('desktop viewport: hero video still loads eagerly (unchanged behaviour)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHeroVideoBackend(page);

    const heroVideoRequests = [];
    page.on('request', request => {
      if (isHeroVideoRequest(request.url())) {
        heroVideoRequests.push(request.url());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // No interaction simulated — desktop must not need one.
    expect(heroVideoRequests.length).toBeGreaterThan(0);
  });

  test('prefers-reduced-motion: never downloads the video, on any device, with or without interaction', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockHeroVideoBackend(page);

    const heroVideoRequests = [];
    page.on('request', request => {
      if (isHeroVideoRequest(request.url())) {
        heroVideoRequests.push(request.url());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(heroVideoRequests).toEqual([]);

    // 'skip' mode wires no interaction listener at all, so a stray click
    // must not somehow trigger a load either.
    await page.evaluate(() => {
      document.querySelector('.hero-video-card')?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.waitForTimeout(1000);
    expect(heroVideoRequests).toEqual([]);
  });

  test('Save-Data: never downloads the video, mirroring prefers-reduced-data', async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHeroVideoBackend(page);

    // navigator.connection.saveData is not directly emulatable via the
    // Playwright API; stub it before any page script runs.
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, 'connection', {
        configurable: true,
        get: () => ({ saveData: true, effectiveType: '2g' }),
      });
    });

    const heroVideoRequests = [];
    page.on('request', request => {
      if (isHeroVideoRequest(request.url())) {
        heroVideoRequests.push(request.url());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    expect(heroVideoRequests).toEqual([]);
  });

  test('the poster has real intrinsic dimensions on mobile from first paint (no CLS once media resolves)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockHeroVideoBackend(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const video = page.locator('#hero-pexels-video');
    await expect(video).toBeAttached();
    expect(await video.getAttribute('preload')).toBe('none');
    expect(await video.getAttribute('poster')).toBe('/assets/images/hero-video-poster.jpg');
    expect(await video.getAttribute('width')).toBe('800');
    expect(await video.getAttribute('height')).toBe('450');
  });
});
