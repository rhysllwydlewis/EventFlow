/**
 * The settings page (/settings), as source. The behaviour is covered in a real browser by
 * e2e/settings-page.spec.js; these pin the structural choices that behaviour depends on.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const html = read('public/settings.html');
const js = read('public/assets/js/pages/settings-init.js');
const css = read('public/assets/css/settings.css');

describe('the page does not hand itself to the old app.js settings code', () => {
  test('its ef-page tag is not "settings"', () => {
    // app.js still runs initSettings() for that tag: it adds a second handler to Save preferences
    // and replaces the whole page with "Unable to load settings." if its own request fails.
    expect(html).toMatch(/<meta name="ef-page" content="account_settings">/);
    expect(html).not.toMatch(/<meta name="ef-page" content="settings">/);
  });
});

describe('confirmations are native dialogs', () => {
  test.each(['delete-account-modal', 'remove-photo-dialog', 'downgrade-dialog'])(
    '#%s is a <dialog> opened with showModal()',
    id => {
      expect(html).toMatch(new RegExp(`<dialog id="${id}"`));
      expect(js).toContain(`byId('${id}')`);
    }
  );

  test('nothing falls back to confirm() or the shared Modal class', () => {
    expect(js).not.toMatch(/\bconfirm\(/);
    expect(js).not.toMatch(/new Modal\(/);
  });
});

describe('the markup', () => {
  test('has no inline <style> block: the styles live in settings.css', () => {
    expect(html).not.toMatch(/<style[\s>]/);
  });

  test('the photo upload is a button, not a label for a display:none input', () => {
    expect(html).toContain('<button type="button" id="avatar-upload-btn"');
    expect(html).not.toMatch(/<label[^>]*for="avatar-upload-input"/);
  });

  test('the email-change note and the unverified notice start hidden', () => {
    expect(html).toMatch(/id="email-change-hint"[^>]*\shidden/);
    expect(html).toMatch(/id="email-unverified-notice"[^>]*\shidden/);
  });

  test('the Restart Tour card is gone: there is no tour for it to restart', () => {
    expect(html).not.toContain('restart-tour');
    expect(js).not.toContain('ef_homepage_tour_completed');
  });
});

describe('the script', () => {
  test('status colours come from the stylesheet, never inline', () => {
    expect(js).not.toMatch(/\.style\.color\s*=/);
    expect(css).toMatch(/\[data-state="success"\]\s*\{\s*color:\s*#047857/);
    expect(css).toMatch(/\[data-state="error"\]\s*\{\s*color:\s*#b91c1c/);
  });

  test('the newsletter request uses the saved address', () => {
    expect(js).toMatch(/body: \{ email: _userEmail \}/);
    expect(js).not.toMatch(/getElementById\('profile-email'\)\?\.value \|\| ''/);
  });

  test('the password rule is the server rule: a letter and a number', () => {
    expect(js).toMatch(/\/\[A-Za-z\]\/\.test\(pw\) && \/\[0-9\]\/\.test\(pw\)/);
  });

  test('one /api/me/settings request feeds every preference', () => {
    expect(js.match(/fetch\('\/api\/me\/settings'/g)).toHaveLength(1);
  });
});

describe('the stylesheet', () => {
  test('is only for this page and carries no dead rules from removed features', () => {
    for (const dead of ['settings-beta-badge', 'settings-tag-btn', 'settings-progress-bar']) {
      expect(css).not.toContain(dead);
    }
  });

  test('every red used for text is the AA shade', () => {
    expect(css).not.toMatch(/color:\s*#(?:ef4444|dc2626)/i);
  });
});
