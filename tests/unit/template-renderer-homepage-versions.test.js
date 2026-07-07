'use strict';

const {
  buildHomepageV2Preview,
  buildHomepageV3Preview,
  resolvePublicTemplatePath,
} = require('../../utils/template-renderer');

describe('homepage version template routing', () => {
  test('serves the real V2 file for V2 preview and live V2 root', () => {
    expect(resolvePublicTemplatePath('/home-v2-preview', null)).toBe('/home-v2.html');
    expect(resolvePublicTemplatePath('/home-v2-preview.html', null)).toBe('/home-v2.html');
    expect(resolvePublicTemplatePath('/', 'v2')).toBe('/home-v2.html');
  });

  test('serves the index template for V1 root and V3 preview/live transforms', () => {
    expect(resolvePublicTemplatePath('/', 'v1')).toBe('/index.html');
    expect(resolvePublicTemplatePath('/', 'v3')).toBe('/index.html');
    expect(resolvePublicTemplatePath('/home-v3-preview', null)).toBe('/index.html');
  });

  test('V2 preview does not receive V3 video assets', () => {
    const source = '<html><body class="home-v2-page"><main>V2</main></body></html>';
    const rendered = buildHomepageV2Preview(source);

    expect(rendered).not.toContain('/assets/css/home-v3-video.css');
    expect(rendered).not.toContain('/assets/js/pages/home-v3-video.js');
    expect(rendered).not.toContain('data-hv3-pexels-video');
  });

  test('V3 preview injects video assets and replaces the current hero', () => {
    const source = `
      <html>
        <head></head>
        <body>
          <section class="hero hero-modern" aria-labelledby="hero-title">
            <h1 id="hero-title">Original hero</h1>
          </section>
          <!-- Noscript fallback for hero CTAs -->
        </body>
      </html>
    `;

    const rendered = buildHomepageV3Preview(source);

    expect(rendered).toContain('/assets/css/home-v3-video.css');
    expect(rendered).toContain('/assets/js/pages/home-v3-video.js?v=5');
    expect(rendered).toContain('data-hv3-pexels-video');
    expect(rendered).not.toContain('images.pexels.com/videos/4586391/free-video-4586391.jpg');
  });
});
