/**
 * Integration tests for collage widget customization features
 * Tests the new customization endpoints and configuration options
 */

const fs = require('fs');

describe('Collage Widget Customization Tests', () => {
  describe('Backend API Structure', () => {
    it('should have collage-widget GET endpoint', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      expect(adminRoutesContent).toContain("router.get('/homepage/collage-widget'");
      expect(adminRoutesContent).toContain('heroVideo:');
      expect(adminRoutesContent).toContain('videoQuality:');
      expect(adminRoutesContent).toContain('transition:');
      expect(adminRoutesContent).toContain('preloading:');
      expect(adminRoutesContent).toContain('mobileOptimizations:');
      expect(adminRoutesContent).toContain('contentFiltering:');
      expect(adminRoutesContent).toContain('playbackControls:');
    });

    it('should have collage-widget PUT endpoint with validation', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      expect(adminRoutesContent).toContain('router.put');
      expect(adminRoutesContent).toContain('/homepage/collage-widget');
      expect(adminRoutesContent).toContain('transition?.effect');
      expect(adminRoutesContent).toContain("fade', 'slide', 'zoom', 'crossfade'");
      expect(adminRoutesContent).toContain('preloading?.count');
      expect(adminRoutesContent).toContain('videoQuality?.preference');
    });

    it('should have sensible default values', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      // Check hero video defaults
      expect(adminRoutesContent).toContain('enabled: true');
      expect(adminRoutesContent).toContain('autoplay: false');
      expect(adminRoutesContent).toContain('muted: true');
      expect(adminRoutesContent).toContain('loop: true');

      // Check transition defaults
      expect(adminRoutesContent).toContain("effect: 'fade'");
      expect(adminRoutesContent).toContain('duration: 1000');
    });
  });

  describe('Admin UI Elements', () => {
    it('should have hero video control inputs', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="heroVideoEnabled"');
      expect(htmlContent).toContain('id="heroVideoAutoplay"');
      expect(htmlContent).toContain('id="heroVideoMuted"');
      expect(htmlContent).toContain('id="heroVideoLoop"');
      expect(htmlContent).toContain('id="heroVideoQuality"');
    });

    it('should have video quality settings inputs', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="videoQualityPreference"');
      expect(htmlContent).toContain('id="videoQualityAdaptive"');
      expect(htmlContent).toContain('id="videoQualityMobileOptimized"');
    });

    it('should have transition effect controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="transitionEffect"');
      expect(htmlContent).toContain('id="transitionDuration"');
      expect(htmlContent).toContain('value="fade"');
      expect(htmlContent).toContain('value="slide"');
      expect(htmlContent).toContain('value="zoom"');
      expect(htmlContent).toContain('value="crossfade"');
    });

    it('should have preloading controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="preloadingEnabled"');
      expect(htmlContent).toContain('id="preloadingCount"');
    });

    it('should have mobile optimization controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="mobileSlowerTransitions"');
      expect(htmlContent).toContain('id="mobileDisableVideos"');
      expect(htmlContent).toContain('id="mobileTouchControls"');
    });

    it('should have content filtering controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="filterAspectRatio"');
      expect(htmlContent).toContain('id="filterOrientation"');
      expect(htmlContent).toContain('id="filterMinResolution"');
    });

    it('should have playback controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="playbackShowControls"');
      expect(htmlContent).toContain('id="playbackPauseOnHover"');
      expect(htmlContent).toContain('id="playbackFullscreen"');
    });

    it('should have video analytics dashboard', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('Video Analytics Dashboard');
      expect(htmlContent).toContain('id="heroVideoSuccessRate"');
      expect(htmlContent).toContain('id="collageVideoSuccessRate"');
      expect(htmlContent).toContain('id="totalVideoAttempts"');
    });
  });

  describe('Admin JavaScript Functions', () => {
    it('should handle all new settings in renderCollageWidget', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/admin-homepage-init.js', 'utf8');

      expect(jsContent).toContain('heroVideo');
      expect(jsContent).toContain('videoQuality');
      expect(jsContent).toContain('transition');
      expect(jsContent).toContain('preloading');
      expect(jsContent).toContain('mobileOptimizations');
      expect(jsContent).toContain('contentFiltering');
      expect(jsContent).toContain('playbackControls');
    });

    it('should serialize all settings in saveCollageWidget', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/admin-homepage-init.js', 'utf8');

      expect(jsContent).toContain('heroVideo:');
      expect(jsContent).toContain('videoQuality:');
      expect(jsContent).toContain('transition:');
      expect(jsContent).toContain('preloading:');
      expect(jsContent).toContain('mobileOptimizations:');
      expect(jsContent).toContain('contentFiltering:');
      expect(jsContent).toContain('playbackControls:');
    });

    it('should use nullish coalescing for consistent defaults', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/admin-homepage-init.js', 'utf8');

      expect(jsContent).toContain('??');
    });
  });

  describe('Frontend Implementation', () => {
    it('should pass heroVideo config to initHeroVideo', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      expect(jsContent).toContain('async function initHeroVideo(');
      expect(jsContent).toContain('heroVideoConfig.enabled');
      expect(jsContent).toContain('heroVideoConfig.autoplay');
      expect(jsContent).toContain('heroVideoConfig.muted');
      expect(jsContent).toContain('heroVideoConfig.loop');
      expect(jsContent).toContain('selectedHeroMedia = null');
    });

    it('should implement mobile optimizations', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      expect(jsContent).toContain('mobileOptimizations');
      expect(jsContent).toContain('isMobile');
      expect(jsContent).toContain('effectiveIntervalMs');
      expect(jsContent).toContain('effectiveMediaTypes');
    });

    it('should use named constants for magic numbers', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      expect(jsContent).toContain('MOBILE_TRANSITION_MULTIPLIER');
    });

    it('should handle video quality preferences', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      expect(jsContent).toContain('qualityPreference');
      expect(jsContent).toContain('heroVideoConfig.quality');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate transition effects', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      expect(adminRoutesContent).toContain("!['fade', 'slide', 'zoom', 'crossfade'].includes");
      expect(adminRoutesContent).toContain('Invalid transition effect');
    });

    it('should validate preloading count range', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      expect(adminRoutesContent).toContain('preloading?.count');
      expect(adminRoutesContent).toContain('count < 0 || count > 5');
      expect(adminRoutesContent).toContain('Preloading count must be between 0 and 5');
    });

    it('should validate video quality preference', () => {
      const adminRoutesContent = fs.readFileSync('routes/admin.js', 'utf8');

      expect(adminRoutesContent).toContain('videoQuality?.preference');
      expect(adminRoutesContent).toContain("!['hd', 'sd', 'auto'].includes");
      expect(adminRoutesContent).toContain('Invalid video quality preference');
    });
  });

  describe('Code Quality', () => {
    it('should have no duplicate filtering logic', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      // Check that filtering is done once, not duplicated
      const filterMatches = jsContent.match(
        /\.filter\(f => f\.quality === 'hd' \|\| f\.quality === 'sd'\)/g
      );
      expect(filterMatches).toBeTruthy();
      // Should appear only once in video quality section
      expect(filterMatches.length).toBeLessThanOrEqual(2);
    });

    it('should have clear sort logic for SD preference', () => {
      const jsContent = fs.readFileSync('public/assets/js/pages/home-init.js', 'utf8');

      expect(jsContent).toContain("(a.quality === 'sd') ? -1 : (b.quality === 'sd') ? 1 : 0");
    });
  });
});
