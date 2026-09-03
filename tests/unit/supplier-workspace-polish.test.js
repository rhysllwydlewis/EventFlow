'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const listingHtml = read('public/supplier/marketplace-new-listing.html');
const listingJs = read('public/assets/js/marketplace-new-listing.js');
const profileHtml = read('public/supplier/profile-customization.html');
const workspaceCss = read('public/supplier/css/supplier-workspace.css');
const subscriptionGate = read('middleware/subscriptionGate.js');
const packagesRoute = read('routes/packages.js');
const appJs = read('public/assets/js/app.js');

describe('supplier workspace visual and interaction consistency', () => {
  it('shares a scoped visual layer across supplier editing pages', () => {
    expect(listingHtml).toContain('css/supplier-workspace.css?v=1.0.0');
    expect(profileHtml).toContain('css/supplier-workspace.css?v=1.0.0');
    expect(listingHtml).toContain('supplier-workspace-page supplier-marketplace-editor');
    expect(profileHtml).toContain('supplier-workspace-page supplier-profile-editor');
    expect(workspaceCss).toContain('body.supplier-workspace-page');
    expect(profileHtml.lastIndexOf('css/supplier-workspace.css')).toBeGreaterThan(
      profileHtml.lastIndexOf('</style>')
    );
  });

  it('uses the EventFlow workspace heading treatment without decorative title emoji', () => {
    expect(listingHtml).toContain('supplier-page-eyebrow');
    expect(profileHtml).toContain('supplier-page-eyebrow');
    expect(profileHtml).toContain('>Profile customisation</h1>');
    expect(profileHtml).not.toContain('>✨ Profile Customization</h1>');
  });

  it('makes the listing upload control keyboard accessible', () => {
    expect(listingHtml).toMatch(/id="image-upload-zone"[^>]*role="button"[^>]*tabindex="0"/);
    expect(listingHtml).toContain('aria-controls="listing-images"');
    expect(listingJs).toContain("event.key === 'Enter' || event.key === ' '");
    expect(listingJs).toContain('if (event.target === input)');
  });

  it('keeps upload guidance consistent with client-side validation', () => {
    expect(listingHtml).toContain('WebP, GIF, AVIF or HEIC; max 10 MB each');
    expect(listingJs).toContain("'image/heic'");
    expect(listingJs).toContain('file.size > 10 * 1024 * 1024');
    expect(listingHtml).toContain(
      'accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"'
    );
  });

  it('renders previews with DOM APIs and CSP-safe delegated removal', () => {
    expect(listingJs).toContain('grid.replaceChildren()');
    expect(listingJs).toContain("document.createElement('img')");
    expect(listingJs).toContain("event.target.closest('[data-remove-image]')");
    expect(listingJs).not.toContain('onclick="window.NewListing.removeImage');
    expect(listingJs).not.toContain('window.NewListing');
    expect(listingJs).toContain('Number.isInteger(index)');
  });

  it('announces photo count and handles broken previews', () => {
    expect(listingHtml).toContain('id="listing-images-status" role="status" aria-live="polite"');
    expect(listingJs).toContain('of 5 photos selected.');
    expect(listingJs).toContain("item.classList.add('image-preview-item--error')");
    expect(workspaceCss).toContain('.image-preview-item--error::after');
  });

  it('provides keyboard and reduced-motion treatments', () => {
    expect(workspaceCss).toContain(":is(button, a, [role='button']):focus-visible");
    expect(workspaceCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('uses the canonical subscription URL in supplier upgrade actions', () => {
    expect(subscriptionGate).not.toContain("upgradeUrl: '/supplier/subscription.html'");
    expect(packagesRoute).not.toContain("upgradeUrl: '/supplier/subscription.html'");
    expect(appJs).not.toContain("upgradeCta.href = '/supplier/subscription.html'");
    expect(subscriptionGate).toContain("upgradeUrl: '/supplier/subscription'");
    expect(packagesRoute).toContain("upgradeUrl: '/supplier/subscription'");
    expect(appJs).toContain("upgradeCta.href = '/supplier/subscription'");
  });

  it('does not recursively reopen the nested file input when its click bubbles', () => {
    const runner = path.join(__dirname, '../helpers/marketplace-upload-zone-scenario.js');
    const output = execFileSync(process.execPath, [runner], {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    expect(JSON.parse(output)).toEqual({ afterPointer: 1, afterKeyboard: 2 });
  });
});
