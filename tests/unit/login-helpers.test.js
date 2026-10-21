'use strict';

/**
 * What the sign-in form tells and does after a response. These run the real functions from
 * public/assets/js/app.js (see tests/helpers/load-app-redirect.js for how that file is read).
 */

const vm = require('vm');
const { appJs } = require('../helpers/load-app-redirect');

/**
 * @param {string} [origin] - The page's origin
 * @returns {{loginFailureMessage: Function, postLoginDestination: Function, warnings: string[]}}
 */
function loadLoginHelpers(origin = 'https://event-flow.co.uk') {
  const redirectStart = appJs.indexOf('const REDIRECT_ALLOWED_PATHS');
  const redirectEnd = appJs.indexOf('// Shared banner used by explicit page actions');
  const helpersStart = appJs.indexOf('function loginFailureMessage(');
  const helpersEnd = appJs.indexOf("document.addEventListener('DOMContentLoaded'", helpersStart);
  if ([redirectStart, redirectEnd, helpersStart, helpersEnd].includes(-1)) {
    throw new Error('The sign-in helpers were not found in app.js');
  }
  const warnings = [];
  const context = vm.createContext({
    window: { location: { origin } },
    URL,
    URLSearchParams,
    console: { warn: message => warnings.push(message) },
  });
  vm.runInContext(
    `${appJs.slice(redirectStart, redirectEnd)}\n${appJs.slice(helpersStart, helpersEnd)}\n` +
      'this.loginFailureMessage = loginFailureMessage;\nthis.postLoginDestination = postLoginDestination;',
    context
  );
  return {
    loginFailureMessage: context.loginFailureMessage,
    postLoginDestination: context.postLoginDestination,
    warnings,
  };
}

const { loginFailureMessage, postLoginDestination, warnings } = loadLoginHelpers();

describe('loginFailureMessage', () => {
  test('a wrong password is said plainly, whatever the server wrote', () => {
    expect(loginFailureMessage(401, 'bad creds')).toMatch(/^Invalid email or password/);
    expect(loginFailureMessage(401)).toMatch(/^Invalid email or password/);
  });

  test('an unverified account is told to check their inbox', () => {
    expect(loginFailureMessage(403, 'Please Verify your email')).toMatch(
      /^Please verify your email address/
    );
  });

  test('too many attempts asks for a moment', () => {
    expect(loginFailureMessage(429, 'slow down')).toMatch(/^Too many login attempts/);
  });

  test('another refusal keeps the server wording, and no wording gets the generic line', () => {
    expect(loginFailureMessage(403, 'Account suspended')).toBe('Account suspended');
    expect(loginFailureMessage(500, 'Something broke')).toBe('Something broke');
    expect(loginFailureMessage(500)).toBe(
      'Unable to sign in. Please check your email and password.'
    );
    expect(
      loginFailureMessage(500, 'Could not sign in. Please check your details and try again.')
    ).toBe('Unable to sign in. Please check your email and password.');
  });
});

describe('postLoginDestination', () => {
  test.each([
    ['admin', '/admin'],
    ['supplier', '/dashboard/supplier'],
    ['customer', '/dashboard/customer'],
    [undefined, '/dashboard/customer'],
  ])('with no redirect, %s goes to %s', (role, expected) => {
    expect(postLoginDestination(role, '')).toBe(expected);
  });

  test('an allowed page for the role wins, from redirect or return', () => {
    expect(postLoginDestination('customer', '?redirect=%2Fpricing%3Fplan%3Dpro')).toBe(
      '/pricing?plan=pro'
    );
    expect(postLoginDestination('admin', '?return=/admin-users')).toBe('/admin-users');
  });

  test('the plan parameter rides along', () => {
    expect(postLoginDestination('customer', '?redirect=/pricing&plan=pro_plus')).toBe(
      '/pricing?plan=pro_plus'
    );
  });

  test('an untrusted address is ignored with a warning, and the role page is used', () => {
    warnings.length = 0;
    expect(postLoginDestination('customer', '?redirect=https%3A%2F%2Fevil.example')).toBe(
      '/dashboard/customer'
    );
    expect(postLoginDestination('supplier', '?redirect=/admin')).toBe('/dashboard/supplier');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Ignoring untrusted redirect param');
  });
});
