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
  it('labels the signup choice as a guided two-step flow', () => {
    expect(authHtml).toContain('Step 1');
    expect(authHtml).toContain('Choose your account type');
    expect(authHtml).toContain('Plan, shortlist and message suppliers.');
    expect(authHtml).toContain('List your business and manage enquiries.');
    expect(authHtml).toContain('Step 2');
    expect(authHtml).toContain('Continue with Google or email');
  });
});
