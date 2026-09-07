'use strict';

const { renderStaticNotFound } = require('../../routes/public-listing-seo');

const PACKAGE_TEMPLATE = `<!doctype html>
<html>
<head><title>Package Details</title></head>
<body>
  <div id="package-loading" class="card pkg-skeleton-card" aria-busy="true" aria-label="Loading package details">
    <div class="pkg-skeleton pkg-skeleton--img"></div>
  </div>
  <div id="package-error" style="display: none;" class="card" role="status">
    <h2>Package not found</h2>
  </div>
  <div id="package-content" style="display: none;"></div>
  <script src="/assets/js/pages/package-init.js?v=19.2.1"></script>
</body>
</html>`;

const EVENT_TEMPLATE = `<!doctype html>
<html>
<head><title>Event details</title></head>
<body>
  <h1 id="event-title" class="event-detail-hero__title">
    <span class="skeleton skeleton-title"></span>
  </h1>
  <main>
    <article class="event-panel" id="event-panel">
      <div class="skeleton-event-detail" aria-hidden="true">loading…</div>
    </article>
  </main>
  <script src="/assets/js/pages/event-detail-init.js?v=18.3.1" defer></script>
</body>
</html>`;

describe('renderStaticNotFound', () => {
  test('strips the package-init.js bootstrap script and reveals the error panel', () => {
    const html = renderStaticNotFound(PACKAGE_TEMPLATE, 'package');
    expect(html).not.toMatch(/<script[^>]*src="\/assets\/js\/pages\/package-init\.js/);
    expect(html).toContain('id="package-error" style="display: block;"');
    expect(html).toContain(
      'id="package-loading" class="card pkg-skeleton-card" aria-busy="true" aria-label="Loading package details" style="display: none;"'
    );
  });

  test('strips the event-detail-init.js bootstrap script and renders a static not-found panel', () => {
    const html = renderStaticNotFound(EVENT_TEMPLATE, 'event');
    expect(html).not.toMatch(/<script[^>]*src="\/assets\/js\/pages\/event-detail-init\.js/);
    expect(html).toContain('Event not found');
    expect(html).not.toContain('skeleton-event-detail');
  });

  test('returns null instead of serving a live-scripted page when the package bootstrap markup is unrecognised', () => {
    const changedTemplate = PACKAGE_TEMPLATE.replace(
      '<script src="/assets/js/pages/package-init.js?v=19.2.1"></script>',
      '<script type="module" src="/assets/js/pages/package-init.mjs"></script>'
    );
    expect(renderStaticNotFound(changedTemplate, 'package')).toBeNull();
  });

  test('returns null instead of serving a live-scripted page when the event bootstrap markup is unrecognised', () => {
    const changedTemplate = EVENT_TEMPLATE.replace(
      '<script src="/assets/js/pages/event-detail-init.js?v=18.3.1" defer></script>',
      '<script type="module" src="/assets/js/pages/event-detail-init.mjs"></script>'
    );
    expect(renderStaticNotFound(changedTemplate, 'event')).toBeNull();
  });
});
