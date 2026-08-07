'use strict';

/**
 * Guards the homepage sign-up popup's client-side contract. Jest does not run
 * this browser script, so these assert the properties that are easy to break
 * in a refactor and expensive to notice in production.
 */

const fs = require('fs');
const path = require('path');

const POPUP_JS = path.join(__dirname, '../../public/assets/js/signup-popup.js');
const POPUP_CSS = path.join(__dirname, '../../public/assets/css/signup-popup.css');
const COOKIE_CONSENT = path.join(__dirname, '../../public/assets/js/cookie-consent.js');
const INDEX_HTML = path.join(__dirname, '../../public/index.html');
const COMPONENTS_JS = path.join(__dirname, '../../public/assets/js/components.js');

let popupJs;
let popupCss;
let indexHtml;

beforeAll(() => {
  popupJs = fs.readFileSync(POPUP_JS, 'utf8');
  popupCss = fs.readFileSync(POPUP_CSS, 'utf8');
  indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');
});

describe('Sign-up popup — dismissal persistence', () => {
  it('uses localStorage, not sessionStorage', () => {
    // auth-state.js calls a blanket sessionStorage.clear() on every 401 from
    // /auth/me — i.e. every page load for a signed-out visitor — so a
    // sessionStorage flag would be wiped and the popup would re-nag on
    // every page view.
    expect(popupJs).toContain("STORAGE_KEY = 'ef_signup_popup_dismissed'");
    expect(popupJs).toContain('localStorage.getItem(STORAGE_KEY)');
    expect(popupJs).toContain("localStorage.setItem(STORAGE_KEY, '1')");
    expect(popupJs).not.toContain('sessionStorage.getItem');
    expect(popupJs).not.toContain('sessionStorage.setItem');
  });

  it('still calls sessionStorage.clear() in auth-state on sign-out, which is what forces the above', () => {
    const authState = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/utils/auth-state.js'),
      'utf8'
    );
    expect(authState).toContain('sessionStorage.clear()');
  });

  it('registers its key as functional storage so a cookie-consent opt-out clears it', () => {
    const consent = fs.readFileSync(COOKIE_CONSENT, 'utf8');
    const listStart = consent.indexOf('FUNCTIONAL_STORAGE_KEYS');
    const list = consent.slice(listStart, consent.indexOf('];', listStart));
    expect(list).toContain('ef_signup_popup_dismissed');
  });

  it('reads the flag before doing any work, and again before showing after the delay', () => {
    // The second check matters: the delay window is long enough for the
    // visitor to dismiss an earlier prompt or sign in mid-wait.
    expect(popupJs.match(/alreadyDismissed\(\)/g).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Sign-up popup — targeting', () => {
  it('never shows to a signed-in visitor', () => {
    expect(popupJs).toContain('isSignedIn');
    expect(popupJs).toContain('auth.isAuthenticated()');
    expect(popupJs).toContain('if (await isSignedIn())');
  });

  it('only shows when the admin setting is explicitly enabled', () => {
    expect(popupJs).toContain('data.enabled !== true');
    expect(popupJs).toContain('/api/v1/public/signup-popup');
  });

  it('sends the CTA to the real auth route', () => {
    expect(popupJs).toContain("window.location.href = '/auth'");
  });
});

describe('Sign-up popup — reuses the shared Modal', () => {
  it('builds on the Modal component rather than hand-rolling a dialog', () => {
    expect(popupJs).toContain('new Modal(');
    expect(popupJs).toContain("typeof Modal === 'undefined'");
  });

  it('inherits Esc-to-close and the focus trap from that component', () => {
    const components = fs.readFileSync(COMPONENTS_JS, 'utf8');
    expect(components).toContain("e.key === 'Escape'");
    expect(components).toContain('trapFocus');
  });

  it('marks the dialog dismissed on every close path by wrapping hide()', () => {
    expect(popupJs).toContain('modal.hide = ');
    expect(popupJs).toContain('markDismissed()');
  });

  it('labels the dialog for screen readers', () => {
    expect(popupJs).toContain("setAttribute('aria-labelledby'");
  });
});

describe('Sign-up popup — homepage wiring', () => {
  it('is loaded on the homepage after components.js so Modal is defined', () => {
    expect(indexHtml).toContain('/assets/js/signup-popup.js');
    expect(indexHtml).toContain('/assets/css/signup-popup.css');
    expect(indexHtml.indexOf('/assets/js/components.js')).toBeLessThan(
      indexHtml.indexOf('/assets/js/signup-popup.js')
    );
  });
});

describe('Sign-up popup — styling', () => {
  it('layers on the shared modal classes instead of redefining the glass card', () => {
    expect(popupCss).toContain('.signup-popup-overlay');
    expect(popupCss).toContain('.signup-popup-modal');
    expect(popupCss).not.toContain('backdrop-filter');
  });

  it('outranks the cookie-consent banner so the two overlays never collide', () => {
    expect(popupCss).toMatch(/\.signup-popup-overlay\s*\{[^}]*z-index:\s*10000/);
  });

  it('pins the close button to the top-right corner at a fixed icon size', () => {
    const block = popupCss.slice(popupCss.indexOf('.signup-popup-overlay .modal-close'));
    expect(block).toContain('position: absolute');
    // .ef-cta forces width:100% below 600px sitewide; without !important the
    // close button becomes a full-width pill on mobile.
    expect(block).toContain('width: 32px !important');
  });

  it('respects prefers-reduced-motion', () => {
    expect(popupCss).toContain('prefers-reduced-motion');
  });
});
