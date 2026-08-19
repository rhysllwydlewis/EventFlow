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
 * The guardrail (`isHeroVideoCardReachable` in hero-collage.js) gates on
 * whether the card is actually visible/interactive, not on viewport width
 * alone — an earlier version of this fix only deferred loading on mobile,
 * which left desktop still fetching video for the same permanently-hidden
 * element. Today that means no viewport should ever request the video, since
 * the card ships hidden everywhere; the tests below hold that as the current
 * expected behaviour, not a mobile-only rule.
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
    pexelsQueries: {
      venues: 'wedding venue',
      catering: 'catering',
      entertainment: 'dj',
      photography: 'photographer',
    },
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STALE_ENABLED_SETTINGS),
    })
  );
  await page.route('**/api/admin/public/pexels-video*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_VIDEO_RESPONSE),
    })
  );
  // The four collage category cards call this; an empty result just falls
  // back to the default static images already in the HTML, which is fine —
  // it is not what this suite is testing.
  await page.route('**/api/v1/admin/public/pexels-collage*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ photos: [], videos: [] }),
    })
  );
  // A second, non-v1 collage widget on the page calls this legacy path.
  // Same reasoning as above — an empty result is a harmless no-op fallback.
  await page.route('**/api/admin/public/pexels-collage*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ photos: [], videos: [] }),
    })
  );
  // FAKE_VIDEO_RESPONSE's `image`/`link` fields point at real Pexels
  // hostnames with made-up paths, so once the hero attaches them as a
  // poster/<source>, the browser would otherwise issue a genuine outbound
  // HTTPS request that this sandbox's egress policy can only fail slowly
  // (not a fast 404) — exactly the kind of pending request that made an
  // earlier version of this suite hang on `networkidle`. Abort them at the
  // network layer so nothing here ever leaves the machine; `page.on('request', ...)`
  // still observes the attempt (it fires on request start, not completion),
  // which is all the assertions below need.
  await page.route('**videos.pexels.com/**', route => route.abort());
  await page.route('**images.pexels.com/**', route => route.abort());
}

/** True if a request URL is the hero video fetch or a raw mp4 payload. */
function isHeroVideoRequest(url) {
  return url.includes('/api/admin/public/pexels-video') || /\.mp4(\?|$)/i.test(url);
}

test.describe('Hero video mobile guardrail', () => {
  test('mobile viewport: no video request ever, even with a stale "videos enabled" record and a synthetic click', async ({
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    expect(heroVideoRequests).toEqual([]);

    // No <source src> should have been assigned before interaction.
    const srcBeforeInteraction = await page.locator('#hero-video-source').getAttribute('src');
    expect(srcBeforeInteraction || '').toBe('');

    // `.hero-video-card` ships `display: none` / `inert` today (see the
    // module-level comment), so `isHeroVideoCardReachable` gates the load
    // mode to 'skip' regardless of viewport — no click/touchend listener
    // is ever armed. Dispatching a click directly against the card (the
    // one way to prove that, since real pointer input can't reach an
    // inert/hidden element either) must still produce nothing.
    await page.evaluate(() => {
      document
        .querySelector('.hero-video-card')
        ?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.waitForTimeout(1000);

    expect(heroVideoRequests).toEqual([]);
  });

  test('desktop viewport: no video request either, since the card is unconditionally hidden by CSS (not just a mobile-only guardrail)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHeroVideoBackend(page);

    const heroVideoRequests = [];
    page.on('request', request => {
      if (isHeroVideoRequest(request.url())) {
        heroVideoRequests.push(request.url());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Before the isCardReachable check existed, 'eager' mode fired
    // unconditionally on desktop and fetched the Pexels API for an
    // element hidden by `.hero-video-card { display: none !important; }`
    // — the exact defect this guardrail closes, on every viewport.
    expect(heroVideoRequests).toEqual([]);
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    expect(heroVideoRequests).toEqual([]);

    // 'skip' mode wires no interaction listener at all, so a stray click
    // must not somehow trigger a load either.
    await page.evaluate(() => {
      document
        .querySelector('.hero-video-card')
        ?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.waitForTimeout(1000);
    expect(heroVideoRequests).toEqual([]);
  });

  test('Save-Data: never downloads the video, mirroring prefers-reduced-data', async ({
    page,
    context,
  }) => {
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
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
