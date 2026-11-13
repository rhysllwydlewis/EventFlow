'use strict';

/**
 * Media economy for the homepage hero collage.
 *
 * A desktop Lighthouse run of the homepage transferred about 55 MB, nearly all
 * of it Pexels video for four tiles that render a few hundred pixels wide, and
 * the collage was initialised two to three times. These tests pin the client
 * side of the fix: overlapping `load()` calls share one run, slow or
 * Save-Data connections skip video, only a couple of videos per category are
 * kept, and the cycle (which downloads the next item for every tile on a
 * timer) pauses while the collage cannot be seen.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(ROOT, 'public/assets/js/collage/hero-collage.js');
const INDEX_PATH = path.join(ROOT, 'public/index.html');
const IMAGES_DIR = path.join(ROOT, 'public/assets/images');

const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');

/**
 * Evaluate the module in a bare sandbox (same shape as the other collage
 * tests) with a few extras the behaviours under test need.
 */
function loadModule(extras = {}) {
  const sandbox = {
    window: {},
    navigator: { onLine: true },
    document: {
      hidden: false,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URLSearchParams,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...extras,
  };
  sandbox.window = sandbox;
  sandbox.window.location = { hostname: 'event-flow.co.uk', search: '' };
  sandbox.location = sandbox.window.location;
  vm.createContext(sandbox);
  vm.runInContext(moduleSource, sandbox);
  return sandbox;
}

const evaluate = (sandbox, expression) => vm.runInContext(expression, sandbox);

describe('overlapping EFHeroCollage.load() calls share one run', () => {
  /** A fetch that answers once `release()` is called, counting its calls. */
  function pendingFetch() {
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const fetch = jest.fn(async () => {
      await gate;
      return { ok: false, status: 503 };
    });
    return { fetch, release };
  }

  test('three calls before the settings answer make one settings request', async () => {
    const { fetch, release } = pendingFetch();
    const { window } = loadModule({ fetch });

    // What home-init.js does: DOMContentLoaded, +1s, and window load.
    const calls = [
      window.EFHeroCollage.load(),
      window.EFHeroCollage.load(),
      window.EFHeroCollage.load(),
    ];
    release();
    await Promise.all(calls);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/public/homepage-settings');
  });

  test('the overlapping callers receive the same promise', () => {
    const { fetch } = pendingFetch();
    const { window } = loadModule({ fetch });
    const first = window.EFHeroCollage.load();
    const second = window.EFHeroCollage.load();
    expect(second).toBe(first);
  });

  test('a finished run does not block a later retry (e.g. after coming back online)', async () => {
    const fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    const { window } = loadModule({ fetch });

    await window.EFHeroCollage.load();
    await window.EFHeroCollage.load();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('a run that throws clears the in-flight state so the next call can try again', async () => {
    const fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: false, status: 503 });
    const { window } = loadModule({ fetch });

    await window.EFHeroCollage.load();
    await window.EFHeroCollage.load();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('an already-initialised collage still short-circuits without any request', async () => {
    const fetch = jest.fn();
    const sandbox = loadModule({ fetch });
    sandbox.window.__collageWidgetInitialized = true;

    await sandbox.window.EFHeroCollage.load();

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('isSlowConnectionForVideo', () => {
  const slow = connection => {
    const sandbox = loadModule({ navigator: { onLine: true, connection } });
    return evaluate(sandbox, 'isSlowConnectionForVideo()');
  };

  test('is false on a fast connection and when the API is unavailable', () => {
    expect(slow({ effectiveType: '4g', saveData: false })).toBe(false);
    expect(slow(undefined)).toBe(false);
    expect(slow({})).toBe(false);
  });

  test.each([['slow-2g'], ['2g'], ['3g']])('is true on %s', effectiveType => {
    expect(slow({ effectiveType })).toBe(true);
  });

  test('is true when the visitor has asked for less data, even on a fast connection', () => {
    expect(slow({ effectiveType: '4g', saveData: true })).toBe(true);
  });
});

describe('the number of videos kept per category', () => {
  test('is a small fixed cap', () => {
    const sandbox = loadModule();
    expect(evaluate(sandbox, 'MAX_COLLAGE_VIDEOS_PER_CATEGORY')).toBe(2);
  });

  test('is applied to the videos the collage endpoint returns', () => {
    // The request loop is async and DOM-heavy, so pin the contract at source
    // level: the cap sits between filtering the valid videos and mapping them.
    expect(moduleSource).toMatch(
      /return isValid;\s*\}\)\s*\.slice\(0, MAX_COLLAGE_VIDEOS_PER_CATEGORY\)\s*\.map\(video => \(\{/
    );
  });

  test('video is not requested at all on a slow or Save-Data connection', () => {
    expect(moduleSource).toMatch(
      /const requestVideos =\s*mediaTypes\?\.videos !== false &&\s*!isHeroVideoMobileViewport\(\) &&\s*!isSlowConnectionForVideo\(\);/
    );
  });
});

describe('cycling pauses when the collage cannot be seen', () => {
  /** An IntersectionObserver that lets a test push visibility changes. */
  function fakeObserverEnv() {
    const instances = [];
    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        instances.push(this);
      }
      observe(element) {
        this.observed.push(element);
      }
      disconnect() {
        this.disconnected = true;
      }
    }
    return { FakeIntersectionObserver, instances };
  }

  const frameIn = root => ({
    closest: selector => (selector.includes('.hero-collage') ? root : null),
  });

  test('is allowed by default, before anything has been observed', () => {
    const sandbox = loadModule();
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(true);
  });

  test('is not allowed while the tab is hidden', () => {
    const sandbox = loadModule();
    sandbox.document.hidden = true;
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(false);
    sandbox.document.hidden = false;
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(true);
  });

  test('follows the collage in and out of the viewport', () => {
    const { FakeIntersectionObserver, instances } = fakeObserverEnv();
    const sandbox = loadModule({ IntersectionObserver: FakeIntersectionObserver });
    const root = { id: 'collage-root' };

    sandbox.observeCollageVisibility([frameIn(root)]);

    expect(instances).toHaveLength(1);
    expect(instances[0].observed).toEqual([root]);
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(true);

    instances[0].callback([{ isIntersecting: false }]);
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(false);

    instances[0].callback([{ isIntersecting: true }]);
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(true);
  });

  test('uses the most recent entry when several arrive together', () => {
    const { FakeIntersectionObserver, instances } = fakeObserverEnv();
    const sandbox = loadModule({ IntersectionObserver: FakeIntersectionObserver });
    sandbox.observeCollageVisibility([frameIn({})]);

    instances[0].callback([{ isIntersecting: true }, { isIntersecting: false }]);

    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(false);
  });

  test('keeps cycling when IntersectionObserver is unavailable', () => {
    const sandbox = loadModule();
    sandbox.observeCollageVisibility([frameIn({})]);
    expect(evaluate(sandbox, 'isCollageCycleAllowed()')).toBe(true);
  });

  test('replaces an earlier observer instead of leaking it', () => {
    const { FakeIntersectionObserver, instances } = fakeObserverEnv();
    const sandbox = loadModule({ IntersectionObserver: FakeIntersectionObserver });

    sandbox.observeCollageVisibility([frameIn({})]);
    sandbox.observeCollageVisibility([frameIn({})]);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnected).toBe(true);
    expect(instances[1].disconnected).toBe(false);
  });

  test('cleanup disconnects the observer', () => {
    const { FakeIntersectionObserver, instances } = fakeObserverEnv();
    const sandbox = loadModule({ IntersectionObserver: FakeIntersectionObserver });
    sandbox.observeCollageVisibility([frameIn({})]);

    sandbox.window.EFHeroCollage.cleanup();

    expect(instances[0].disconnected).toBe(true);
    expect(sandbox.window.__collageVisibilityObserver).toBeNull();
  });

  test('both the interval and the watchdog restart use the gated tick', () => {
    expect(moduleSource).toMatch(
      /pexelsCollageIntervalId = setInterval\(tickCollage, effectiveIntervalMs\)/g
    );
    expect(moduleSource.match(/setInterval\(tickCollage, effectiveIntervalMs\)/g)).toHaveLength(2);
    expect(moduleSource).toMatch(
      /if \(!isCollageCycleAllowed\(\)\) \{\s*window\.__collageLastCycleTime = Date\.now\(\);\s*return;\s*\}/
    );
  });
});

/** A stand-in for an <img>, with real attribute semantics for the ones we touch. */
function fakeImg(attrs = {}) {
  const attributes = new Map(Object.entries(attrs));
  const img = {
    tagName: 'IMG',
    className: 'tile-img',
    parentElement: null,
    style: { cssText: '', opacity: '0' },
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    alt: '',
    decoding: '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
    hasAttribute: name => attributes.has(name),
    removeAttribute: name => attributes.delete(name),
    replaceWith: () => {},
  };
  // srcset / sizes / src behave as attributes, as on a real element.
  for (const name of ['src', 'srcset', 'sizes']) {
    Object.defineProperty(img, name, {
      get: () => attributes.get(name),
      set: value => {
        attributes.set(name, String(value));
      },
    });
  }
  return img;
}

describe('addCacheBuster', () => {
  const bust = url => evaluate(loadModule(), `addCacheBuster(${JSON.stringify(url)})`);

  test('leaves an immutable Pexels CDN URL exactly as it was', () => {
    const url = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&h=350';
    expect(bust(url)).toBe(url);
  });

  test('still busts an uploaded or local image, which may be replaced in place', () => {
    expect(bust('/uploads/collage/venue.jpg')).toMatch(/^\/uploads\/collage\/venue\.jpg\?cb=\d+$/);
    expect(bust('https://event-flow.co.uk/api/photos/p1?x=1')).toMatch(/\?x=1&cb=\d+$/);
  });

  test('does not treat a lookalike host as Pexels', () => {
    expect(bust('https://images.pexels.com.evil.example/a.jpg')).toMatch(/\?cb=\d+$/);
    expect(bust('https://evil.example/images.pexels.com/a.jpg')).toMatch(/\?cb=\d+$/);
  });

  test('passes an empty value straight through', () => {
    expect(bust('')).toBe('');
  });
});

describe('applyCollagePhoto keeps src and srcset in step', () => {
  const photo = n => ({
    url: `https://images.pexels.com/photos/${n}/p.jpeg?h=350`,
    srcset: `https://images.pexels.com/photos/${n}/p.jpeg?h=130 340w, https://images.pexels.com/photos/${n}/p.jpeg?h=350 940w`,
  });

  test('replaces the previous photo srcset, so the new photo is the one displayed', () => {
    const sandbox = loadModule();
    const img = fakeImg({ src: photo(1).url, srcset: photo(1).srcset, sizes: '25vw' });

    sandbox.applyCollagePhoto(img, photo(2), { getBoundingClientRect: () => ({ width: 230 }) });

    expect(img.src).toBe(photo(2).url);
    expect(img.srcset).toBe(photo(2).srcset);
    expect(img.srcset).not.toContain('/photos/1/');
  });

  test('removes a stale srcset when the new photo has none (the bug: it would win over src)', () => {
    const sandbox = loadModule();
    const img = fakeImg({
      src: '/old.jpg',
      srcset: 'old-1.jpg 340w, old-2.jpg 940w',
      sizes: '25vw',
    });

    sandbox.applyCollagePhoto(img, { url: '/uploads/new.jpg' }, null);

    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.hasAttribute('sizes')).toBe(false);
    expect(img.src).toMatch(/^\/uploads\/new\.jpg\?cb=\d+$/);
  });

  test('does not add a cache-buster to a Pexels photo', () => {
    const sandbox = loadModule();
    const img = fakeImg({});
    sandbox.applyCollagePhoto(img, photo(3), null);
    expect(img.src).toBe(photo(3).url);
    expect(img.src).not.toContain('cb=');
  });
});

describe('cycleWidgetMedia photo to photo', () => {
  /**
   * Run one cycle tick for a single tile and return the tile's <img>.
   * Timers run immediately and `Image` loads instantly, so the whole
   * transition completes synchronously.
   */
  function cycleOnce({ staleSrcset }) {
    const first = {
      url: 'https://images.pexels.com/photos/1/p.jpeg?h=350',
      srcset: 'https://images.pexels.com/photos/1/p.jpeg?h=130 340w',
      type: 'photo',
      photographer: 'A',
    };
    const second = {
      url: 'https://images.pexels.com/photos/2/p.jpeg?h=350',
      srcset: 'https://images.pexels.com/photos/2/p.jpeg?h=130 340w',
      type: 'photo',
      photographer: 'B',
    };
    const img = fakeImg(
      staleSrcset ? { src: first.url, srcset: first.srcset, sizes: '25vw' } : { src: first.url }
    );
    const frame = {
      getBoundingClientRect: () => ({ width: 230 }),
      querySelector: () => img,
    };
    const loads = [];
    class FakeImage {
      set src(value) {
        loads.push(value);
        if (this.onload) {
          this.onload();
        } else {
          Promise.resolve().then(() => this.onload && this.onload());
        }
      }
    }
    const sandbox = loadModule({
      Image: FakeImage,
      setTimeout: callback => callback(),
      innerWidth: 1280,
    });
    sandbox.document.body = { contains: () => true };
    sandbox.document.createElement = () => ({});
    evaluate(sandbox, 'addCreatorCredit = () => {}; removeCreatorCredit = () => {};');

    sandbox.cycleWidgetMedia(
      { venues: [first, second] },
      { venues: 0 },
      [frame],
      { venues: 0 },
      false
    );
    return { img, first, second, loads };
  }

  test('shows the next photo instead of keeping the first one on screen', async () => {
    const { img, second } = cycleOnce({ staleSrcset: true });
    await Promise.resolve();

    expect(img.src).toBe(second.url);
    expect(img.srcset).toBe(second.srcset);
    expect(img.srcset).not.toContain('/photos/1/');
  });

  test('downloads the next photo once: the displayed URL is the preloaded one', async () => {
    const { img, second, loads } = cycleOnce({ staleSrcset: true });
    await Promise.resolve();

    expect(loads).toEqual([second.url]);
    expect(img.src).toBe(loads[0]);
  });
});

describe('homepage markup uses the right-sized images', () => {
  const exists = name => fs.existsSync(path.join(IMAGES_DIR, name));

  test('the hero video keeps its sized poster, now the same small WebP the lower section uses', () => {
    // One URL for both uses means the browser downloads it once. The guardrail
    // test pins that a sized poster ships from first paint.
    const video = indexHtml.match(/<video id="hero-pexels-video"[\s\S]*?>/)[0];
    expect(video).toContain('poster="/assets/images/hero-video-poster-960.webp"');
    expect(video).not.toContain('hero-video-poster.jpg');
    const lowerSection = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/homepage-approved-lower.js'),
      'utf8'
    );
    expect(lowerSection).toContain('/assets/images/hero-video-poster-960.webp');
    expect(lowerSection).not.toContain('hero-video-poster.jpg');
  });

  test.each(['london', 'manchester', 'birmingham', 'cardiff', 'leeds', 'edinburgh'])(
    'the %s city card uses the WebP rendition, which exists',
    city => {
      expect(indexHtml).toContain(`/assets/images/cities/${city}.webp`);
      expect(indexHtml).not.toContain(`/assets/images/cities/${city}.jpg`);
      expect(exists(`cities/${city}.webp`)).toBe(true);
    }
  );

  test.each(['venue', 'catering', 'entertainment', 'photography'])(
    'the %s collage tile uses the 640px WebP rendition, which exists',
    name => {
      expect(indexHtml).toContain(`<img src="/assets/images/collage-${name}-640.webp"`);
      expect(indexHtml).not.toContain(`<img src="/assets/images/collage-${name}.jpg"`);
      expect(exists(`collage-${name}-640.webp`)).toBe(true);
    }
  );

  test('the changed scripts are loaded with a cache-busting version', () => {
    // Not pinned to a number: these files are edited again (and rebumped), and a
    // returning visitor must always be served the new bytes. `npm run
    // check:asset-versions` checks that a change moves the number; this checks
    // each one has one at all.
    [
      '/assets/js/collage/hero-collage.js',
      '/assets/js/pages/homepage-approved-lower.js',
      '/assets/js/pages/home-init.js',
      '/assets/js/components/carousel.js',
    ].forEach(script => {
      const at = indexHtml.indexOf(`${script}?v=`);
      expect(at).toBeGreaterThan(-1);
      // ...followed by an actual version, not an empty `?v=`.
      expect(indexHtml.slice(at + script.length + '?v='.length)).toMatch(/^[\w.]+/);
    });
  });
});
