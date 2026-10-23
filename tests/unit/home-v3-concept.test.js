const fs = require('fs');
const path = require('path');
const { buildHomepageV3Preview } = require('../../utils/template-renderer');

describe('homepage V3 concept', () => {
  test('renders the approved photo-bubble concept without the previous video stack', () => {
    const html = buildHomepageV3Preview(
      fs.readFileSync(path.join(__dirname, '../../public/home-v3.html'), 'utf8')
    );
    expect(html).toContain('photo-orbit');
    expect(html).toContain('Everything you need.');
    expect(html).toContain('/assets/js/pages/home-v3-concept.js?v=1');
    expect(html).not.toContain('/assets/js/pages/home-v3-video.js');
    expect(html).not.toContain('/assets/js/pages/home-v2.js');
    expect(html).not.toContain('/assets/js/utils/pexels-client.js');
  });

  test('does not request videos or third-party media scripts for the new hero', () => {
    const html = buildHomepageV3Preview(
      fs.readFileSync(path.join(__dirname, '../../public/home-v3.html'), 'utf8')
    );
    expect(html).not.toMatch(/<video|<source|videos\.pexels\.com/);
    expect(html).toContain('width="400"');
    expect(html).toContain('decoding="async"');
  });
});
