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

  it('uploads the banner to the persistent banner route instead of storing a data URL', () => {
    // The generic multi-image drop-zone helper (efSetupPhotoDropZone) stored
    // the raw base64 data URL in the hidden bannerUrl field, which the
    // general supplier PATCH route truncates to 500 characters and the
    // public serializer strips outright — a save could report success while
    // the banner never persisted or rendered publicly. Uploading immediately
    // through the dedicated banner route fixes that.
    expect(controller).not.toContain('window.efSetupPhotoDropZone');
    expect(controller).toContain('function uploadBannerFile(file)');
    expect(controller).toContain('/banner`');
    expect(controller).toContain("method: 'POST'");
  });

  it('warns before an unsaved navigation, unlike every other dirty-state page here', () => {
    // Dirty state previously only controlled the in-page save bar — reload,
    // tab close and navigating away all bypassed it entirely, unlike
    // start-wizard.js's equivalent guard.
    expect(controller).toContain("window.addEventListener('beforeunload'");
    const guardIndex = controller.indexOf("window.addEventListener('beforeunload'");
    const guardBody = controller.slice(guardIndex, guardIndex + 200);
    expect(guardBody).toContain('if (!dirty)');
    expect(guardBody).toContain('event.preventDefault()');
  });

  it('rejects more than one banner file at a time', () => {
    // Unlike the gallery drop zone, a banner is exactly one image.
    expect(controller).not.toContain('input.multiple = true');
    expect(controller).toContain('e.dataTransfer?.files?.[0]');
    expect(controller).toContain('input.files?.[0]');
  });

  it('validates a banner value before assigning it to an <img> src', () => {
    // CodeQL flagged both img.src = imageUrl sinks (renderBannerPreview and
    // updatePreviewBanner) once bannerUrl could also come from a fetch
    // response, not just a local FileReader read. A data:image/svg+xml
    // value can embed a <script> tag, so only bitmap MIME types are let
    // through the data: branch; everything else must be http(s).
    expect(controller).toContain('function isSafeImageSrc(url)');
    expect(controller).toContain('if (!isSafe)');
    expect(controller).toContain('if (isSafeImageSrc(imageUrl))');
  });
});
