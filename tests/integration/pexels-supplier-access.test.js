/**
 * Integration tests for Pexels Supplier Access
 * Tests that supplier role can access Pexels endpoints and PexelsSelector component
 */

const fs = require('fs');
const path = require('path');

describe('Pexels Supplier Access', () => {
  let authMiddlewareContent;
  let pexelsRoutesContent;
  let pexelsSelectorContent;
  let profileCustomizationHtmlContent;
  let profileCustomizationJsContent;

  beforeAll(() => {
    authMiddlewareContent = fs.readFileSync(
      path.join(__dirname, '../../middleware/auth.js'),
      'utf8'
    );
    pexelsRoutesContent = fs.readFileSync(path.join(__dirname, '../../routes/pexels.js'), 'utf8');
    pexelsSelectorContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/components/pexels-selector.js'),
      'utf8'
    );
    profileCustomizationHtmlContent = fs.readFileSync(
      path.join(__dirname, '../../public/supplier/profile-customization.html'),
      'utf8'
    );
    profileCustomizationJsContent = fs.readFileSync(
      path.join(__dirname, '../../public/supplier/js/profile-customization.js'),
      'utf8'
    );
  });

  describe('Auth Middleware Updates', () => {
    it('should support array of roles in roleRequired middleware', () => {
      expect(authMiddlewareContent).toContain('Array.isArray(role)');
      expect(authMiddlewareContent).toContain('role.includes(req.user.role)');
    });

    it('should maintain backward compatibility with single role string', () => {
      expect(authMiddlewareContent).toContain('if (req.user.role !== role)');
    });

    it('should have proper JSDoc for role parameter', () => {
      expect(authMiddlewareContent).toContain('@param {string|string[]} role');
    });
  });

  describe('Pexels Routes Access Control', () => {
    it('should allow admin and supplier roles for /search endpoint', () => {
      expect(pexelsRoutesContent).toContain("roleRequired(['admin', 'supplier'])");
      expect(pexelsRoutesContent).toMatch(/router\.get\(['"]\/search['"]/);
    });

    it('should allow admin and supplier roles for /curated endpoint', () => {
      const curatedMatch = pexelsRoutesContent.match(
        /router\.get\(['"]\/curated['"],.*roleRequired\(\['admin', 'supplier'\]\)/s
      );
      expect(curatedMatch).toBeTruthy();
    });

    it('should have updated comments for supplier access', () => {
      expect(pexelsRoutesContent).toContain('admin or supplier authentication');
    });
  });

  describe('PexelsSelector Component', () => {
    it('should define PEXELS_ALLOWED_DOMAINS constant', () => {
      expect(pexelsSelectorContent).toContain('const PEXELS_ALLOWED_DOMAINS');
      expect(pexelsSelectorContent).toContain('images.pexels.com');
      expect(pexelsSelectorContent).toContain('www.pexels.com');
    });

    it('should export PexelsSelector class to window', () => {
      expect(pexelsSelectorContent).toContain('window.PexelsSelector = PexelsSelector');
    });

    it('should export PEXELS_ALLOWED_DOMAINS to window', () => {
      expect(pexelsSelectorContent).toContain('window.PEXELS_ALLOWED_DOMAINS');
    });

    it('should have validatePexelsUrl method', () => {
      expect(pexelsSelectorContent).toContain('validatePexelsUrl(url)');
      expect(pexelsSelectorContent).toContain('PEXELS_ALLOWED_DOMAINS.includes');
    });

    it('should use DOM methods only (no innerHTML with external data)', () => {
      // Check for createElement usage
      expect(pexelsSelectorContent).toContain('document.createElement');
      expect(pexelsSelectorContent).toContain('textContent');

      // Should not have innerHTML assignments with dynamic data in render methods
      const createPhotoCardSection = pexelsSelectorContent.match(
        /createPhotoCard\(photo\)\s*{[\s\S]*?return cardDiv;/
      );
      if (createPhotoCardSection) {
        expect(createPhotoCardSection[0]).not.toMatch(/innerHTML\s*=/);
      }
    });

    it('should have open method with callback parameter', () => {
      expect(pexelsSelectorContent).toContain('open(onSelectCallback)');
      expect(pexelsSelectorContent).toContain('this.selectionCallback = onSelectCallback');
    });

    it('should implement search and curated functionality', () => {
      expect(pexelsSelectorContent).toContain('performSearch');
      expect(pexelsSelectorContent).toContain('fetchCuratedContent');
    });

    it('should implement load more pagination', () => {
      expect(pexelsSelectorContent).toContain('loadNextPage');
      expect(pexelsSelectorContent).toContain('hasMoreContent');
    });
  });

  describe('Profile Customization Integration', () => {
    it('should import pexels-selector.js script', () => {
      expect(profileCustomizationHtmlContent).toContain('/assets/js/components/pexels-selector.js');
    });

    it('should have "Select Stock Photo" button', () => {
      expect(profileCustomizationHtmlContent).toContain('id="select-stock-photo-btn"');
      expect(profileCustomizationHtmlContent).toContain('Select Stock Photo');
    });

    it('should initialize PexelsSelector in JavaScript', () => {
      expect(profileCustomizationJsContent).toContain('new window.PexelsSelector()');
      expect(profileCustomizationJsContent).toContain('selector.open');
    });

    it('should validate selected image URLs', () => {
      expect(profileCustomizationJsContent).toContain('validatePexelsImageUrl');
      expect(profileCustomizationJsContent).toContain('window.PEXELS_ALLOWED_DOMAINS');
    });

    it('should use DOM methods for banner preview update', () => {
      expect(profileCustomizationJsContent).toContain('updateBannerPreview');
      expect(profileCustomizationJsContent).toContain('document.createElement');
      expect(profileCustomizationJsContent).toContain('while (bannerPreview.firstChild)');
    });

    it('should update hidden input with selected URL', () => {
      expect(profileCustomizationJsContent).toContain("getElementById('sup-banner')");
      expect(profileCustomizationJsContent).toContain('bannerInput.value = selectedImageUrl');
    });

    it('should show success notification on selection', () => {
      expect(profileCustomizationJsContent).toContain('Stock photo selected successfully');
    });
  });

  describe('Security Validation', () => {
    it('should validate URLs before rendering in PexelsSelector', () => {
      expect(pexelsSelectorContent).toContain('validatePexelsUrl(photo.src.large)');
      expect(pexelsSelectorContent).toContain('validatePexelsUrl(photo.src.medium)');
    });

    it('should filter out invalid photos before rendering', () => {
      expect(pexelsSelectorContent).toContain('photosCache.filter');
      expect(pexelsSelectorContent).toContain('if (!largeUrl || !mediumUrl)');
    });

    it('should validate URL before accepting in profile customization', () => {
      expect(profileCustomizationJsContent).toContain(
        'if (!validatePexelsImageUrl(selectedImageUrl))'
      );
    });

    it('should use try-catch for URL validation', () => {
      expect(pexelsSelectorContent).toContain('new URL(url)');
      expect(pexelsSelectorContent).toMatch(/catch.*{[\s\S]*?return '';/);
    });
  });
});
