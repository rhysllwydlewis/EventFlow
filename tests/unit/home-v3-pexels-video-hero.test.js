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
    expect(html).toContain('https://images.pexels.com/videos/4586391/free-video-4586391.jpg');
    expect(html).toContain('/assets/css/home-v3-video.css?v=2');
    expect(html).toContain('/assets/js/pages/home-v3.js?v=13');
    expect(html).toContain('/assets/js/pages/home-v3-video.js?v=2');
    expect(html).not.toContain('/assets/js/pages/home-v2.js');
    expect(html).not.toContain('/assets/js/utils/pexels-client.js');
  });

  test('does not eagerly request a fallback video before preference checks run', () => {
    const html = buildHomepageV3Preview(
      fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8')
    );

    expect(html).toContain('preload="none"');
    expect(html).toContain('<source type="video/mp4" data-hv3-video-source />');
    expect(html).not.toContain('4586391-sd_640_360_25fps.mp4');
    expect(html).not.toMatch(/<video[\s\S]*?\sautoplay\b/i);
  });

  test('keeps playback gated by reduced-motion, save-data and admin settings checks', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/home-v3-video.js'),
      'utf8'
    );

    expect(script).toContain('prefers-reduced-motion: reduce');
    expect(script).toContain('saveData');
    expect(script).toContain('/api/v1/public/homepage-settings');
    expect(script).toContain('/api/v1/public/homepage-video');
    expect(script).toContain('pexelsVideoQueries');
    expect(script).toContain('buildUploadPlaylist');
    expect(script).toContain('settings.fallbackToPexels !== false');
    expect(script).toContain('video.loop = false');
    expect(script).toContain('video.addEventListener(\'error\', handleVideoError)');
    expect(script).toContain('startHeroVideoRotation');
    expect(script).toContain('chooseHeroVideoFile');
  });

  test('honours admin customisation controls used by the V3 video player', () => {
    const script = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/home-v3-video.js'),
      'utf8'
    );
    const styles = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/home-v3-video.css'),
      'utf8'
    );

    expect(script).toContain('videoPassesContentFilters');
    expect(script).toContain('MOBILE_TRANSITION_MULTIPLIER');
    expect(script).toContain('container.dataset.transitionEffect');
    expect(script).toContain('settings.mobileOptimizations?.touchControls === false');
    expect(script).toContain('controlsList');
    expect(styles).toContain("data-transition-effect='slide'");
    expect(styles).toContain("data-transition-effect='zoom'");
  });
});
