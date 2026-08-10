/**
 * Integration tests for homepage hero customization features
 * Tests the shared backend configuration and rebuilt homepage manager UI.
 */

const fs = require('fs');

describe('Homepage Hero Customization Tests', () => {
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

      expect(adminRoutesContent).toContain('enabled: true');
      expect(adminRoutesContent).toContain('autoplay: false');
      expect(adminRoutesContent).toContain('muted: true');
      expect(adminRoutesContent).toContain('loop: true');
      expect(adminRoutesContent).toContain("effect: 'fade'");
      expect(adminRoutesContent).toContain('duration: 1000');
    });
  });

  describe('Rebuilt Admin Homepage UI', () => {
    it('should load the rebuilt homepage manager assets only', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('admin-homepage-manager');
      expect(htmlContent).toContain('/assets/css/admin-homepage-rebuild.css');
      expect(htmlContent).toContain('/assets/js/pages/admin-homepage-rebuild.js');
      expect(htmlContent).not.toContain('/assets/js/pages/admin-homepage-init.js');
      expect(htmlContent).not.toContain('Video Analytics Dashboard');
    });

    it('should provide live homepage selection and preview controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('Homepage Manager');
      expect(htmlContent).toContain('Manage Homepage 1, 2 and 3');
      expect(htmlContent).toContain('Choose the live homepage');
      expect(htmlContent).toContain('id="homepageVersionCards"');
      expect(htmlContent).toContain('id="heroVersionTabs"');
      expect(htmlContent).toContain('id="selectedHomepagePreview"');
      expect(htmlContent).toContain('id="publishSelectedHomepage"');
    });

    it('should expose hero source, media type and playback controls', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('Hero source and queue');
      expect(htmlContent).toContain('id="heroSettingsForm"');
      expect(htmlContent).toContain('id="heroSourceMode"');
      expect(htmlContent).toContain('value="auto_pexels_photos"');
      expect(htmlContent).toContain('value="auto_pexels_videos"');
      expect(htmlContent).toContain('value="auto_pexels_mixed"');
      expect(htmlContent).toContain('value="selected_pexels"');
      expect(htmlContent).toContain('value="selected_with_fallback"');
      expect(htmlContent).toContain('value="uploads"');
      expect(htmlContent).toContain('id="heroMediaPhotos"');
      expect(htmlContent).toContain('id="heroMediaVideos"');
      expect(htmlContent).toContain('id="heroFallbackEnabled"');
      expect(htmlContent).toContain('id="heroFallbackMinimum"');
      expect(htmlContent).toContain('id="heroEnabled"');
      expect(htmlContent).toContain('id="heroIntervalSeconds"');
      expect(htmlContent).toContain('id="heroTransitionEffect"');
      expect(htmlContent).toContain('id="heroTransitionDuration"');
      expect(htmlContent).toContain('id="heroAutoplay"');
      expect(htmlContent).toContain('id="heroMuted"');
      expect(htmlContent).toContain('id="heroLoop"');
      expect(htmlContent).toContain('id="heroQuality"');
    });

    it('should expose per-category Pexels search terms', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('id="queryPhotoVenues"');
      expect(htmlContent).toContain('id="queryPhotoCatering"');
      expect(htmlContent).toContain('id="queryPhotoEntertainment"');
      expect(htmlContent).toContain('id="queryPhotoPhotography"');
      expect(htmlContent).toContain('id="queryVideoVenues"');
      expect(htmlContent).toContain('id="queryVideoCatering"');
      expect(htmlContent).toContain('id="queryVideoEntertainment"');
      expect(htmlContent).toContain('id="queryVideoPhotography"');
    });

    it('should expose selected hero media queue management', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('Selected hero media queue');
      expect(htmlContent).toContain('Media added from Admin Media appears here');
      expect(htmlContent).toContain('id="heroMediaQueue"');
      expect(htmlContent).toContain('href="/admin-media"');
    });

    it('should keep shared body and category image management on the page', () => {
      const htmlContent = fs.readFileSync('public/admin-homepage.html', 'utf8');

      expect(htmlContent).toContain('Shared body content');
      expect(htmlContent).toContain('id="categoryCardsGrid"');
      expect(htmlContent).toContain('id="categoryList"');
      expect(htmlContent).toContain('id="categoryModal"');
      expect(htmlContent).toContain('id="categoryForm"');
      expect(htmlContent).toContain('id="pexelsSearchQuery"');
      expect(htmlContent).toContain('id="categoryCustomImage"');
      expect(htmlContent).toContain('id="saveCategoryBtn"');
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

  // The collage and hero-video implementation moved out of pages/home-init.js
  // into collage/hero-collage.js so homepage V2 could share it. The assertions
  // below follow the code to its new home.
  describe('Frontend Implementation', () => {
    it('should pass heroVideo config to initHeroVideo', () => {
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

      expect(jsContent).toContain('async function initHeroVideo(');
      expect(jsContent).toContain('heroVideoConfig.enabled');
      expect(jsContent).toContain('heroVideoConfig.autoplay');
      expect(jsContent).toContain('heroVideoConfig.muted');
      expect(jsContent).toContain('heroVideoConfig.loop');
      expect(jsContent).toContain('selectedHeroMedia = null');
    });

    it('should implement mobile optimizations', () => {
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

      expect(jsContent).toContain('mobileOptimizations');
      expect(jsContent).toContain('isMobile');
      expect(jsContent).toContain('effectiveIntervalMs');
      expect(jsContent).toContain('effectiveMediaTypes');
    });

    it('should use named constants for magic numbers', () => {
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

      expect(jsContent).toContain('MOBILE_TRANSITION_MULTIPLIER');
    });

    it('should handle video quality preferences', () => {
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

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
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

      const filterMatches = jsContent.match(
        /\.filter\(f => f\.quality === 'hd' \|\| f\.quality === 'sd'\)/g
      );
      expect(filterMatches).toBeTruthy();
      expect(filterMatches.length).toBeLessThanOrEqual(2);
    });

    it('should have clear sort logic for SD preference', () => {
      const jsContent = fs.readFileSync('public/assets/js/collage/hero-collage.js', 'utf8');

      expect(jsContent).toContain("(a.quality === 'sd') ? -1 : (b.quality === 'sd') ? 1 : 0");
    });
  });
});
