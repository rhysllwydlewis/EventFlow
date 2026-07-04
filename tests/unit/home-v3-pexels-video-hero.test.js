const fs = require('fs');
const path = require('path');
const { buildHomepageV3Preview } = require('../../utils/template-renderer');

describe('homepage V3 Pexels video hero', () => {
  test('renders the V3 hero with Pexels video media instead of the legacy photo client', () => {
    const html = buildHomepageV3Preview(
      fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8')
    );

    expect(html).toContain('data-hv3-pexels-video');
    expect(html).toContain('data-hv3-video-media');
    expect(html).toContain('data-hv3-video-source');
    expect(html).toContain('https://videos.pexels.com');
    expect(html).toContain('/assets/css/home-v3-video.css?v=1');
    expect(html).toContain('/assets/js/pages/home-v3.js?v=13');
    expect(html).toContain('/assets/js/pages/home-v3-video.js?v=1');
    expect(html).not.toContain('/assets/js/pages/home-v2.js');
    expect(html).not.toContain('/assets/js/utils/pexels-client.js');
  });
});
