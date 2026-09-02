const fs = require('fs');
const path = require('path');

describe('auth signup layout', () => {
  const authHtml = fs.readFileSync(path.join(__dirname, '../../public/auth.html'), 'utf8');

  it('puts account type and supplier essentials before Google signup', () => {
    const createPanelStart = authHtml.indexOf('id="panel-create"');
    const rolePicker = authHtml.indexOf('id="reg-role-picker"', createPanelStart);
    const locationField = authHtml.indexOf('id="reg-location"', createPanelStart);
    const supplierFields = authHtml.indexOf('id="supplier-fields"', createPanelStart);
    const googleSignup = authHtml.indexOf('id="google-signup-button"', createPanelStart);

    expect(createPanelStart).toBeGreaterThan(-1);
    expect(rolePicker).toBeGreaterThan(createPanelStart);
    expect(locationField).toBeGreaterThan(rolePicker);
    expect(supplierFields).toBeGreaterThan(locationField);
    expect(googleSignup).toBeGreaterThan(supplierFields);
  });

  it('does not leak signup controls into the sign in form', () => {
    const loginStart = authHtml.indexOf('id="login-form"');
    const loginEnd = authHtml.indexOf('</form>', loginStart);
    const loginForm = authHtml.slice(loginStart, loginEnd);

    expect(loginForm).not.toContain('id="reg-role-picker"');
    expect(loginForm).not.toContain('id="supplier-fields"');
  });

  it('keeps the auth page compact and free from unwanted skip-link chrome', () => {
    expect(authHtml).not.toContain('Skip to sign in');
    expect(authHtml).not.toContain('auth-skip-link');
    expect(authHtml).toContain('/assets/css/auth.css?v=18.6.0');
    expect(authHtml).toContain('County or region *');
    expect(authHtml).toContain('Company name *');
    expect(authHtml).toContain('Profile picture');
  });

  it('labels the signup choice as a guided two-step flow', () => {
    expect(authHtml).toContain('Step 1');
    expect(authHtml).toContain('Choose your account type');
    expect(authHtml).toContain('Plan, shortlist and message suppliers.');
    expect(authHtml).toContain('List your business and manage enquiries.');
    expect(authHtml).toContain('Step 2');
    expect(authHtml).toContain('Continue with Google, Facebook or email');
  });

  it('keeps auth tabs readable and Google buttons fitted to the card', () => {
    const authCss = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/auth.css'),
      'utf8'
    );
    const googleSignupCss = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/auth-google-signup.css'),
      'utf8'
    );

    expect(authCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(authCss).toContain('white-space: normal;');
    expect(authCss).toContain('inline-size: min(100%, var(--google-button-width, 320px));');
    expect(authCss).toContain('overflow: hidden;');
    expect(googleSignupCss).toContain(
      'inline-size: min(100%, var(--google-button-width, 320px));'
    );
  });

  it('locks only the EventFlow Google container and preserves the GIS iframe bleed', () => {
    const googleSignupCss = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/auth-google-signup.css'),
      'utf8'
    );

    expect(googleSignupCss).toContain(
      'width: min(100%, var(--google-button-width, 320px)) !important;'
    );
    expect(googleSignupCss).toMatch(
      /body\.auth-page \.auth-google-button\s*\{[^}]*overflow: visible;/s
    );
    expect(googleSignupCss).toMatch(
      /body\.auth-page \.auth-google-button iframe\s*\{[^}]*max-width: none;[^}]*max-inline-size: none;/s
    );
    expect(googleSignupCss).not.toMatch(
      /\.auth-google-button > div[\s\S]*\.auth-google-button iframe[\s\S]*inline-size:\s*100%\s*!important/
    );
  });

  it('keeps the Facebook control synchronized to the visible Google footprint', () => {
    const googleSignupCss = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/auth-google-signup.css'),
      'utf8'
    );
    const facebookInit = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/auth-facebook-init.js'),
      'utf8'
    );

    expect(googleSignupCss).toMatch(
      /body\.auth-page \.auth-facebook-button\s*\{[^}]*width: min\(100%, var\(--google-button-width, 320px\)\);[^}]*margin-inline: auto;/s
    );
    expect(googleSignupCss).not.toMatch(
      /body\.auth-page \.auth-facebook-button\s*\{[^}]*width:[^;}]*!important/s
    );
    expect(facebookInit).toContain('const SOCIAL_BUTTON_MAX_WIDTH = 320;');
    expect(facebookInit).toContain('function getGoogleRenderedControl(card)');
    expect(facebookInit).toContain('function getGoogleVisibleFootprintWidth(card)');
    expect(facebookInit).toContain("renderedControl.tagName === 'IFRAME'");
    expect(facebookInit).toContain('renderedWidth + marginLeft + marginRight');
    expect(facebookInit).toContain('function syncFacebookButtonWidths()');
    expect(facebookInit).toContain('button.style.width = `${targetWidth}px`;');
    expect(facebookInit).toContain('new window.ResizeObserver(syncFacebookButtonWidths)');
    expect(facebookInit).toContain('new window.MutationObserver(observeRenderedTargets)');
  });
});
