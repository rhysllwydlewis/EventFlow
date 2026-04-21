/**
 * Messenger page asset-loading tests.
 * Ensures the messenger page (public/messenger/index.html) loads the same
 * global CSS baseline as all other pages so the navbar and typography are
 * visually consistent, and that the CSS defines the variables it needs to
 * render attachments and muted-text correctly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Messenger page CSS consistency', () => {
  let messengerHtml;
  let messengerCss;
  let legacyMessengerCss;
  let messagingGlassEnhancementsCss;

  beforeAll(() => {
    messengerHtml = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'messenger', 'index.html'),
      'utf8'
    );
    messengerCss = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'assets', 'css', 'messenger-v4.css'),
      'utf8'
    );
    legacyMessengerCss = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'messenger', 'css', 'messenger.css'),
      'utf8'
    );
    messagingGlassEnhancementsCss = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        'public',
        'assets',
        'css',
        'messaging-glass-enhancements.css'
      ),
      'utf8'
    );
  });

  // ── Navbar parity ───────────────────────────────────────────────────────────

  it('loads styles.css (global font, typography, brand CSS variables)', () => {
    expect(messengerHtml).toContain('/assets/css/styles.css');
  });

  it('loads styles.css BEFORE navbar.css so variables resolve correctly', () => {
    const stylesPos = messengerHtml.indexOf('/assets/css/styles.css');
    const navbarPos = messengerHtml.indexOf('/assets/css/navbar.css');
    expect(stylesPos).toBeGreaterThan(-1);
    expect(navbarPos).toBeGreaterThan(-1);
    expect(stylesPos).toBeLessThan(navbarPos);
  });

  it('loads navbar.css for the standard EventFlow nav component', () => {
    expect(messengerHtml).toContain('/assets/css/navbar.css');
  });

  it('uses the standard .ef-header nav markup (not a custom header)', () => {
    expect(messengerHtml).toContain('class="ef-header"');
  });

  // ── Attachment / text-muted variable coverage ────────────────────────────────

  it('messenger-v4.css defines --ef-text-muted locally so attachment text is always visible', () => {
    expect(messengerCss).toContain('--ef-text-muted:');
  });

  it('messenger-v4.css defines --ef-text-base locally for body text colour', () => {
    expect(messengerCss).toContain('--ef-text-base:');
  });

  // ── Core messenger CSS ───────────────────────────────────────────────────────

  it('loads messenger-v4.css for the chat UI', () => {
    expect(messengerHtml).toContain('messenger-v4.css');
  });

  it('loads messenger-v4-polish.css which contains attachment CSS classes', () => {
    expect(messengerHtml).toContain('messenger-v4-polish.css');
  });

  it('uses reduced 12px dimensions for attachment remove chips in messenger preview CSS', () => {
    expect(legacyMessengerCss).toContain('.attachment-remove {');
    expect(legacyMessengerCss).toContain('top: 4px;');
    expect(legacyMessengerCss).toContain('right: 4px;');
    expect(legacyMessengerCss).toContain('width: 12px;');
    expect(legacyMessengerCss).toContain('height: 12px;');
    expect(messagingGlassEnhancementsCss).toContain('.attachment-remove {');
    expect(messagingGlassEnhancementsCss).toContain('width: 12px;');
    expect(messagingGlassEnhancementsCss).toContain('height: 12px;');
  });
});
