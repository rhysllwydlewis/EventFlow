const fs = require('fs');
const path = require('path');

describe('home V3 selected upload bridge', () => {
  const pageScript = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/home-v3.js'),
    'utf8'
  );
  const playerScript = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/home-v3-video.js'),
    'utf8'
  );

  test('installs the bridge before the V3 player initialises', () => {
    expect(pageScript).toContain('installHomepageUploadBridge();');
    expect(pageScript.indexOf('installHomepageUploadBridge();')).toBeLessThan(
      pageScript.indexOf('window.__EF_HOME_V3_PREVIEW__ = true')
    );
  });

  test('maps selected uploaded videos into the legacy upload gallery contract', () => {
    expect(pageScript).toContain('widget?.mediaLibrary?.selectedUploads');
    expect(pageScript).toContain("widget?.source === 'uploads'");
    expect(pageScript).toContain("item?.type === 'video'");
    expect(pageScript).toContain('widget.uploadGallery = Array.from(new Set');
  });

  test('retains the existing V3 upload playlist and fallback flow', () => {
    expect(playerScript).toContain('buildUploadPlaylist');
    expect(playerScript).toContain("settings.source === 'uploads'");
    expect(playerScript).toContain('settings.fallbackToPexels !== false');
  });
});
