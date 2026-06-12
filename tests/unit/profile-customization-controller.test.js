const fs = require('fs');
const path = require('path');

describe('profile customization controller', () => {
  let controller;

  beforeAll(() => {
    controller = fs.readFileSync(
      path.join(__dirname, '../../public/supplier/js/profile-customization.js'),
      'utf8'
    );
  });

  it('always builds a complete save payload so cleared fields persist', () => {
    expect(controller).toContain('function buildSavePayload()');
    expect(controller).toContain('bannerUrl: bannerInput?.value?.trim() ||');
    expect(controller).toContain('highlights: readHighlights()');
    expect(controller).toContain('featuredServices: readFeaturedServices()');
    expect(controller).toContain('socialLinks: readSocialLinks()');
    expect(controller).not.toContain('if (highlights.length > 0)');
    expect(controller).not.toContain('if (Object.keys(socialLinks).length > 0)');
  });

  it('keeps banner and stock photo interactions observable by the dirty-state system', () => {
    expect(controller).toContain("form.addEventListener('submit', handleFormSubmit, true)");
    expect(controller).toContain("bannerInput.dispatchEvent(new Event('input', { bubbles: true }))");
    expect(controller).toContain("bannerInput.dispatchEvent(new Event('change', { bubbles: true }))");
    expect(controller).toContain('Stock photo selected successfully');
  });

  it('adds runtime UX polish for focus states, previews and click targets', () => {
    expect(controller).toContain('injectPolishStyles');
    expect(controller).toContain('.pc-banner-zone:focus-visible');
    expect(controller).toContain('.photo-preview-remove');
    expect(controller).toContain("event.key === 'Enter' || event.key === ' '");
  });
});
