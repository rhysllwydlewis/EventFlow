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

  it('only writes an explicit custom theme after the supplier changes the colour', () => {
    expect(controller).toContain('let themeSelectionChanged = false');
    expect(controller).toContain("payload.themeMode = 'custom'");
    expect(controller).toContain('if (themeSelectionChanged)');
    expect(controller).not.toContain('themeColor: getThemeColor(),');
  });

  it('uses the app CSRF token pattern instead of the removed auth csrf endpoint', () => {
    expect(controller).toContain("const endpoints = ['/api/csrf-token', '/api/v1/csrf-token']");
    expect(controller).toContain("readCookie('csrf')");
    expect(controller).toContain("readCookie('csrfToken')");
    expect(controller).not.toContain('/api/auth/csrf');
  });

  it('keeps banner and stock photo interactions observable by the dirty-state system', () => {
    expect(controller).toContain("form.addEventListener('submit', handleFormSubmit, true)");
    expect(controller).toContain(
      "bannerInput.dispatchEvent(new Event('input', { bubbles: true }))"
    );
    expect(controller).toContain(
      "bannerInput.dispatchEvent(new Event('change', { bubbles: true }))"
    );
    expect(controller).toContain('Stock photo selected successfully');
  });

  it('owns key click targets instead of letting legacy inline handlers double-fire', () => {
    expect(controller).toContain('function cleanInteractiveElement');
    expect(controller).toContain("cleanInteractiveSelector('.color-preset')");
    expect(controller).toContain("cleanInteractiveElement($('pc-save-bar-save'))");
    expect(controller).toContain("cleanInteractiveElement($('pc-save-bar-discard'))");
  });

  it('adds runtime UX polish for focus states, previews, sidebar and floating save bar', () => {
    expect(controller).toContain('injectPolishStyles');
    expect(controller).toContain('.pc-banner-zone:focus-visible');
    expect(controller).toContain('.photo-preview-remove');
    expect(controller).toContain('.pc-save-bar.pc-save-bar--visible');
    expect(controller).toContain('.pc-preview-body .pc-preview-name');
    expect(controller).toContain("event.key === 'Enter' || event.key === ' '");
  });

  it('renders the active colour swatch with an outer animated ring rather than an inner dot', () => {
    expect(controller).toContain('.color-preset.active::after');
    expect(controller).toContain('inset: -7px');
    expect(controller).toContain('@keyframes pcColorRingGlow');
    expect(controller).not.toContain('inset: 8px');
  });
});
