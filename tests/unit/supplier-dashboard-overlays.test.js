'use strict';

/**
 * The profile and package editors as dialogs over the supplier dashboard, and the banner field
 * inside the profile editor: structure of the page, the unsaved-changes guard, focus, and the
 * banner upload and removal. The scripts run for real in jsdom (tests/helpers).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const appJs = read('public/assets/js/app.js');
const homeJs = read('public/assets/js/pages/supplier-dashboard-home.js');
const css = read('public/assets/css/supplier-dashboard-home.css');

const runner = path.join(__dirname, '../helpers/supplier-overlays-scenario.js');
/** Runs one scenario of the helper in a child process and returns what it printed. */
const run = (name, options) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, name, Buffer.from(JSON.stringify(options || {}), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

describe('supplier dashboard editors: page structure', () => {
  test('the profile and package forms live in native dialogs, not in the cards', () => {
    expect(html).toMatch(/<dialog id="sdh-profile-dialog"[^>]*aria-labelledby="sdh-profile-title"/);
    expect(html).toMatch(/<dialog id="sdh-package-dialog"[^>]*aria-labelledby="sdh-package-title"/);
    const profileDialog = html.slice(
      html.indexOf('<dialog id="sdh-profile-dialog"'),
      html.indexOf('</dialog>', html.indexOf('<dialog id="sdh-profile-dialog"'))
    );
    expect(profileDialog).toContain('id="supplier-form"');
    expect(profileDialog).toContain('id="profile-form-section"');
    const packageDialog = html.slice(
      html.indexOf('<dialog id="sdh-package-dialog"'),
      html.indexOf('</dialog>', html.indexOf('<dialog id="sdh-package-dialog"'))
    );
    expect(packageDialog).toContain('id="package-form"');
    expect(packageDialog).toContain('id="pkg-id-hidden"');
    // Not inside the cards any more.
    const profileCard = html.slice(
      html.indexOf('id="profile-card"'),
      html.indexOf('<!-- Packages -->')
    );
    expect(profileCard).not.toContain('id="supplier-form"');
  });

  test('each editor has a close button, Cancel, a sticky footer with Save, and a status line', () => {
    ['sdh-profile-dialog', 'sdh-package-dialog'].forEach(id => {
      const start = html.indexOf(`<dialog id="${id}"`);
      const dialog = html.slice(start, html.indexOf('</dialog>', start));
      expect(dialog).toContain('data-overlay-close');
      expect(dialog).toContain('class="sdh-dialog__foot"');
      expect(dialog).toContain('role="status" aria-live="polite"');
    });
    expect(html).toMatch(/id="cancel-profile-form"(?![^>]*hidden)/);
    expect(html).toMatch(/id="cancel-package-form"(?![^>]*hidden)/);
    expect(html).toContain('id="sup-create" type="submit">Save profile');
  });

  test('the toggles open a dialog: haspopup, no aria-expanded or aria-controls', () => {
    ['toggle-profile-form', 'toggle-package-form'].forEach(id => {
      const start = html.indexOf(`id="${id}"`);
      const button = html.slice(start, html.indexOf('</button>', start));
      expect(button).toContain('aria-haspopup="dialog"');
      expect(button).not.toContain('aria-expanded');
      expect(button).not.toContain('aria-controls');
    });
  });

  test('the editor scripts are loaded, versioned, after the home script', () => {
    expect(html).toMatch(/supplier-dashboard-overlays\.js\?v=\d/);
    expect(html).toMatch(/supplier-dashboard-banner\.js\?v=\d/);
    expect(html.indexOf('supplier-dashboard-home.js')).toBeLessThan(
      html.indexOf('supplier-dashboard-overlays.js')
    );
  });

  test('the banner field is in the profile editor, with upload, remove and a status line', () => {
    const start = html.indexOf('<dialog id="sdh-profile-dialog"');
    const dialog = html.slice(start, html.indexOf('</dialog>', start));
    ['sdh-banner-upload', 'sdh-banner-remove', 'sdh-banner-input', 'sdh-banner-img'].forEach(id =>
      expect(dialog).toContain(`id="${id}"`)
    );
    expect(dialog).toMatch(/id="sdh-banner-input"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
    expect(dialog).toMatch(/id="sdh-banner-status"[^>]*role="status"/);
    // No page-top banner action: the Add banner button is not outside the editor.
    expect(html.replace(dialog, '')).not.toContain('id="sdh-banner-upload"');
    expect(html).not.toContain('Add a banner image');
  });

  test('every old profile and package field is still in the editors', () => {
    const old = [
      'sup-id',
      'sup-name',
      'sup-category',
      'sup-location',
      'sup-base-postcode',
      'sup-short',
      'sup-long',
      'sup-website',
      'sup-photo-drop',
      'pkg-supplier',
      'pkg-title',
      'pkg-price',
      'pkg-category',
      'pkg-desc',
      'pkg-photo-drop',
      'pkg-id-hidden',
    ];
    old.forEach(id => expect(html).toContain(`id="${id}"`));
  });

  test('the sheet styles the editor dialog as a bottom sheet on phones and locks the page scroll', () => {
    expect(css).toContain('.sdh-page .sdh-dialog--editor');
    expect(css).toMatch(/\.sdh-page\.sdh-modal-open\s*\{\s*overflow: hidden/);
    expect(css).toMatch(/\.sdh-page \.sdh-dialog--editor \{\s*height: 94dvh/);
    // The editor's colliding legend rule is gone: one definition of .sdh-legend.
    expect(css.match(/\.sdh-page \.sdh-legend \{/g)).toHaveLength(2);
  });
});

describe('supplier dashboard editors: app.js wiring', () => {
  test('toggling opens the dialog through the overlays script and refills from the saved profile', () => {
    expect(appJs).toContain("window.SupplierDashboardOverlays?.open('profile'");
    expect(appJs).toContain("overlays.open('profile', { focusId: 'sup-name' })");
    expect(appJs).toContain("overlays.open('package', { focusId: 'pkg-title' })");
    // Reopening fills the saved profile, so it never saves as a new one.
    expect(appJs).toContain('window._efPopulateSupplierForm(savedProfile)');
  });

  test('closing resets the forms, so a cancelled form never comes back half filled', () => {
    expect(appJs).toContain("document.addEventListener('sdh:overlay-closed'");
    expect(appJs).toContain('function resetProfileForm()');
    expect(appJs).toContain('function resetPackageForm()');
    expect(appJs).toContain("idField.value = ''");
  });

  test('saving closes the editor without asking; validation messages stay inside the dialog', () => {
    expect(appJs).toContain("window.SupplierDashboardOverlays?.markClean('profile')");
    expect(appJs).toContain("window.SupplierDashboardOverlays?.close('package')");
    expect(appJs).toContain('function showPackageError(');
    expect(appJs).not.toContain("efSay('Please select a primary category.'");
    // A second submit while one is in flight is ignored.
    expect(appJs).toContain('A save is already in flight');
    expect(appJs).not.toContain("classList.contains('expanded')) {\n    togglePackageForm");
  });

  test('the profile photo delete control is a small red badge with a name, and asks before deleting', () => {
    expect(appJs).toContain('data-action="delete-profile-photo"');
    expect(appJs).toContain('aria-label="Delete profile photo"');
    expect(appJs).toContain("title: 'Remove your profile photo?'");
    // Actual visual/hit-area dimensions are checked in the browser regression suite;
    // declarations alone missed the generic touch-target override in this bug.
    expect(appJs).toMatch(/class="sdh-avatar__remove"[^>]*>[\s\S]*?<svg/);
  });

  test('the old banner drop zone code (an element that no longer exists) is gone', () => {
    expect(appJs).not.toContain("'sup-banner-drop'");
  });

  test('toasts are shown in the top layer so a dialog cannot hide them', () => {
    expect(homeJs).toContain("node.setAttribute('popover', 'manual')");
    expect(css).toMatch(/\.sdh-page \.sdh-toast \{\s*position: fixed;\s*inset: 88px auto auto 50%/);
  });
});

describe('supplier dashboard editors: overlays script', () => {
  const log = run('overlays', { confirm: false });

  test('opening shows the dialog, marks the section expanded, locks the page scroll and focuses the field', () => {
    expect(log.openedDialog).toBe(true);
    expect(log.expandedClass).toBe(true);
    expect(log.scrollLocked).toBe(true);
    expect(log.dirtyAtStart).toBe(false);
  });

  test('closing without edits asks nothing and unlocks everything', () => {
    expect(log.closedWithoutEdits).toBe(true);
    expect(log.askedWithoutEdits).toBe(0);
    expect(log.scrollLockedAfter).toBe(false);
    expect(log.expandedAfter).toBe(false);
  });

  test('closing with edits asks, and "Keep editing" leaves the editor and the edit as they were', () => {
    expect(log.dirtyAfterEdit).toBe(true);
    expect(log.keepResult).toBe(false);
    expect(log.stillOpenAfterKeep).toBe(true);
    expect(log.valueAfterKeep).toBe('Changed');
    expect(log.askedTitle).toBe('Discard your changes?');
    expect(log.askedConfirmLabel).toBe('Discard changes');
    expect(log.askedCancelLabel).toBe('Keep editing');
  });

  test('Escape asks too (it is not a way to lose edits)', () => {
    expect(log.escapeAsked).toBeGreaterThanOrEqual(2);
    expect(log.escapeDefaultPrevented).toBe(true);
    expect(log.stillOpenAfterEscape).toBe(true);
  });

  test('after a save (markClean) nothing is unsaved; Discard closes', () => {
    expect(log.dirtyAfterMarkClean).toBe(false);
    expect(log.discarded).toBe(true);
    expect(log.closedAfterDiscard).toBe(true);
  });

  test('a close the browser does by itself with unsaved edits puts the editor back', () => {
    expect(log.reopenedAfterRogueClose).toBe(true);
    expect(log.valueAfterRogueClose).toBe('Unsaved');
  });

  test('typing in a flagged field clears the flag and the message', () => {
    expect(log.flagCleared).toBe(true);
    expect(log.statusCleared).toBe(true);
  });

  test('app.js is told when an editor opens and closes', () => {
    expect(log.events).toEqual(
      expect.arrayContaining([
        'opened:profile',
        'closed:profile',
        'opened:package',
        'closed:package',
      ])
    );
  });
});

describe('supplier dashboard editors: banner field', () => {
  const log = run('banner', {});

  test('a dropped connection says so instead of "Failed to fetch"', () => {
    expect(log.offline).toBe(
      'The banner could not be uploaded. Check your connection and try again.'
    );
  });

  test('without a profile there is nothing to attach a banner to, and the field says so', () => {
    expect(log.noProfile.disabled).toBe(true);
    expect(log.noProfile.message).toBe('Save your profile first, then add a banner');
    expect(log.noProfile.removeVisible).toBe(false);
  });

  test('a profile without a banner offers "Add banner" and no Remove', () => {
    expect(log.noBanner).toEqual({ label: 'Add banner', disabled: false, removeVisible: false });
  });

  test('uploading posts the image to the supplier banner route, then shows it', () => {
    expect(log.upload.call).toEqual({
      url: '/api/me/suppliers/s1/banner',
      method: 'POST',
      hasImage: true,
    });
    expect(log.upload.status).toBe('Banner saved.');
    expect(log.upload.label).toBe('Change banner');
    expect(log.upload.removeVisible).toBe(true);
    expect(log.upload.imgSrc).toBe('/api/photos/new-banner');
    expect(log.upload.cached).toBe('/api/photos/new-banner');
  });

  test('a wrong type or a file over 5 MB is explained and never sent', () => {
    expect(log.wrongType).toEqual({ status: 'Use a JPG, PNG or WebP image.', requests: 0 });
    expect(log.tooBig).toEqual({
      status: 'That image is over 5 MB. Choose a smaller one.',
      requests: 0,
    });
  });

  test('removing asks first, then clears bannerUrl on the profile', () => {
    expect(log.remove.call).toEqual({ url: '/api/me/suppliers/s1', body: { bannerUrl: '' } });
    expect(log.remove.status).toBe('Banner removed.');
    expect(log.remove.label).toBe('Add banner');
    expect(log.remove.removeVisible).toBe(false);
  });

  test('a failed upload shows the server reason and keeps the saved banner', () => {
    expect(log.failed.status).toBe('Invalid image');
    expect(log.failed.imgSrc).toBe('/api/photos/old');
    expect(log.failed.uploadEnabled).toBe(true);
  });

  test('only http(s) and same-site addresses are ever put in an image tag', () => {
    expect(log.safe.path).toBe('/api/photos/abc');
    expect(log.safe.https).toBe('https://cdn.example.com/a.jpg');
    expect(log.safe.dataUrl).toBe('');
    expect(log.safe.script).toBe('');
    expect(log.safe.empty).toBe('');
  });
});
