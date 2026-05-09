'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/auth-google-init.js'),
  'utf8'
);

describe('auth-google-init context handling', () => {
  it('resolves Google auth context from the active create-account tab', () => {
    expect(source).toContain('function getGoogleAuthContext()');
    expect(source).toContain("document.getElementById('panel-create')");
    expect(source).toContain("createTab.getAttribute('aria-selected') === 'true'");
    expect(source).toContain("window.location.hash === '#create'");
    expect(source).toContain("query.get('tab') === 'create'");
  });

  it('deduplicates and times out the GIS script loader so auth controls fail visibly', () => {
    expect(source).toContain('window.__eventflowGoogleScriptPromise');
    expect(source).toContain('Google Identity Services script timed out');
    expect(source).toContain('setTimeout(');
    expect(source).toContain('clearTimeout(timeout)');
  });

  it('keeps Google Identity Services as the sign-in mechanism instead of deprecated gapi.auth2', () => {
    expect(source).toContain('https://accounts.google.com/gsi/client');
    expect(source).toContain('google.accounts.id.initialize');
    expect(source).toContain('google.accounts.id.renderButton');
    expect(source).not.toContain('gapi.auth2');
  });

  it('sets explicit context from multiple pre-click events that can fire before GIS iframe interaction', () => {
    expect(source).toContain('function setGoogleAuthContext(context)');
    expect(source).toContain("'pointerenter'");
    expect(source).toContain("'touchstart'");
    expect(source).toContain("setGoogleAuthContext('signin')");
    expect(source).toContain("setGoogleAuthContext('signup')");
  });

  it('applies visible status classes and loading states for a polished front-end fallback', () => {
    expect(source).toContain("status.classList.add('is-visible', `is-${statusType}`)");
    expect(source).toContain('function setGoogleButtonsBusy(isBusy)');
    expect(source).toContain("el.classList.add('is-loading')");
    expect(source).toContain("el.setAttribute('aria-busy', 'true')");
    expect(source).toContain("signInContainer.classList.add('is-ready')");
    expect(source).toContain("signUpContainer.classList.add('is-ready')");
  });

  it('uses server-side SIWG redirect mode instead of the popup transform flow', () => {
    expect(source).toContain("ux_mode: 'redirect'");
    expect(source).toContain('function getGoogleLoginUri()');
    expect(source).toContain('login_uri: getGoogleLoginUri()');
    expect(source).toContain("const GOOGLE_LOGIN_PATH = '/api/auth/callback/google'");
    expect(source).toContain('use_fedcm_for_prompt: false');
    expect(source).toContain('use_fedcm_for_button: false');
    expect(source).toContain(
      'Google sign-in could not be completed. Please try again or use email login.'
    );
    expect(source).not.toContain('submitGoogleCredential');
    expect(source).not.toContain('/api/v1/auth/google');
  });
});
