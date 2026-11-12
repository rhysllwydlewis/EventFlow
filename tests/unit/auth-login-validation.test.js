/**
 * Log-in form validation.
 *
 * Three things went wrong together on /auth: the log-in password was held to
 * the sign-up strength rules, an empty form produced three error messages for
 * two fields, and a malformed email was still sent to the server.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const FormValidator = require('../../public/assets/js/utils/form-validator');

const ROOT = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** A stand-in for an <input>, with only what getValidationRules reads. */
function fakeField({ id, name, type = 'password', autocomplete, strengthFlag = false }) {
  const attrs = { autocomplete };
  if (strengthFlag) {
    attrs['data-password-strength'] = '';
  }
  return {
    id,
    name,
    type,
    minLength: -1,
    maxLength: -1,
    pattern: '',
    hasAttribute: attr =>
      Object.prototype.hasOwnProperty.call(attrs, attr) && attrs[attr] !== undefined,
    getAttribute: attr => (attrs[attr] === undefined ? null : attrs[attr]),
  };
}

describe('FormValidator password strength rule', () => {
  // No form element: init() returns early, which is all these checks need.
  const validator = new FormValidator(null);

  it('does not apply to a current-password (log-in) field', () => {
    const rules = validator.getValidationRules(
      fakeField({ id: 'login-password', name: 'password', autocomplete: 'current-password' })
    );
    expect(rules.password).toBe(false);
  });

  it('applies to a new-password field', () => {
    const rules = validator.getValidationRules(
      fakeField({ id: 'reg-password', name: 'password', autocomplete: 'new-password' })
    );
    expect(rules.password).toBe(true);
  });

  it('can still be opted into explicitly', () => {
    const rules = validator.getValidationRules(
      fakeField({ id: 'pw', name: 'pw', strengthFlag: true })
    );
    expect(rules.password).toBe(true);
  });
});

describe('auth page log-in wiring', () => {
  const html = read('public/auth.html');
  const formInit = read('public/assets/js/pages/auth-form-init.js');
  const css = read('public/assets/css/auth.css');

  it('marks the two password fields so the rule lands on the right one', () => {
    expect(html).toMatch(/id="login-password"[\s\S]{0,300}autocomplete="current-password"/);
    expect(html).toMatch(/id="reg-password"[\s\S]{0,300}autocomplete="new-password"/);
  });

  it('validates in the capture phase and stops an invalid form reaching app.js', () => {
    expect(formInit).toContain('loginValidator.validateAll()');
    expect(formInit).toContain('e.stopImmediatePropagation()');
    expect(formInit).toMatch(/loginForm\.addEventListener\(\s*'submit',[\s\S]+?,\s*true\s*\);/);
  });

  it('no longer repeats the field errors as a summary line', () => {
    expect(formInit).not.toContain("errors.map(([_field, msg]) => msg).join(', ')");
    expect(formInit).not.toContain('Please fix the errors above');
  });

  it('shows a failed sign-in once, not in the alert and the status line', () => {
    expect(css).toContain('#login-form:has(#login-error:not(:empty)) #login-status');
  });

  it('versions the scripts it changed', () => {
    expect(html).toMatch(/\/assets\/js\/utils\/form-validator\.js\?v=[\d.]+/);
    expect(html).toMatch(/\/assets\/js\/pages\/auth-form-init\.js\?v=[\d.]+/);
  });
});
