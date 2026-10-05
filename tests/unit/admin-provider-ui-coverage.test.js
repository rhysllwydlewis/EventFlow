/**
 * Every signup / verification method the admin backend can emit must be
 * selectable and renderable in the admin UI. Same bug class as the
 * notification-type maps in CLAUDE.md: a method missing from a hardcoded UI
 * map silently falls back to a generic "Unknown"/humanised label.
 */
'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../db-unified', () => ({ read: jest.fn(), find: jest.fn(), findOne: jest.fn() }));

const fs = require('fs');
const path = require('path');
const {
  classifySignupMethod,
  classifyVerificationMethod,
} = require('../../services/adminUserSummary.service');

const read = file => fs.readFileSync(path.join(__dirname, '../../public', file), 'utf8');

const usersHtml = read('admin-users.html');
const usersInit = read('assets/js/pages/admin-users-init.js');
const detailInit = read('assets/js/pages/admin-user-detail-init.js');
const dashboardInit = read('assets/js/pages/admin-init.js');
const verificationSourceInit = read('assets/js/pages/admin-verification-source-init.js');

const SIGNUP_SAMPLES = [
  { authProvider: 'google' },
  { authProvider: 'facebook' },
  { passwordHash: 'hash' },
  { role: 'admin' },
  { role: 'owner' },
  {},
];
const VERIFICATION_SAMPLES = [
  { verified: true, authProvider: 'google' },
  { verified: true, authProvider: 'facebook' },
  { verified: true, verifiedAt: '2026-01-01T00:00:00.000Z' },
  { verified: true, verifiedBy: 'admin' },
  { verified: true },
  { verified: false },
  { verified: true, verifiedAt: undefined, verificationMethod: 'unknown' },
];

function selectOptionValues(html, selectId) {
  const select = html.match(new RegExp(`<select id="${selectId}"[\\s\\S]*?</select>`));
  expect(select).not.toBeNull();
  return [...select[0].matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
}

function mapKeys(source, functionName) {
  const fn = source.match(new RegExp(`function ${functionName}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  expect(fn).not.toBeNull();
  const map = fn[0].match(/const map = \{([\s\S]*?)\n {4}\};/);
  expect(map).not.toBeNull();
  return [...map[1].matchAll(/^\s{6}(\w+):/gm)].map(match => match[1]);
}

describe('admin UI covers every signup and verification method', () => {
  const signupMethods = [...new Set(SIGNUP_SAMPLES.map(classifySignupMethod))];
  const verificationMethods = [...new Set(VERIFICATION_SAMPLES.map(classifyVerificationMethod))];

  test('classifier samples exercise Google, Facebook and email/password', () => {
    expect(signupMethods).toEqual(
      expect.arrayContaining(['google', 'facebook', 'email_password', 'admin_created', 'owner'])
    );
    expect(verificationMethods).toEqual(expect.arrayContaining(['google', 'facebook', 'pending']));
  });

  test.each(signupMethods)('signup filter has an option for "%s"', method => {
    expect(selectOptionValues(usersHtml, 'ucSignupFilter')).toContain(method);
  });

  test.each(verificationMethods)('verification filter has an option for "%s"', method => {
    // email_link is shown as "EventFlow email" and reached via the same value.
    expect(selectOptionValues(usersHtml, 'ucVerifFilter')).toContain(method);
  });

  test.each(signupMethods)('users list renders a signup badge for "%s"', method => {
    expect(mapKeys(usersInit, 'signupBadge')).toContain(method);
  });

  test.each(verificationMethods)('users list renders a verification badge for "%s"', method => {
    expect(mapKeys(usersInit, 'verificationBadge')).toContain(method);
  });

  test.each(signupMethods)('user detail labels signup method "%s"', method => {
    expect(mapKeys(detailInit, 'signupLabel')).toContain(method);
  });

  test.each(verificationMethods)('user detail renders a verification badge for "%s"', method => {
    expect(mapKeys(detailInit, 'verifBadge')).toContain(method);
  });

  test('dashboard health panel links a row for each social sign-in method', () => {
    expect(dashboardInit).toContain('/admin-users?signupMethod=google');
    expect(dashboardInit).toContain('/admin-users?signupMethod=facebook');
  });

  test('users summary cards link to Google and Facebook verified users', () => {
    expect(usersInit).toContain('health.googleVerified');
    expect(usersInit).toContain('health.facebookVerified');
  });

  test('verification-source page treats Facebook accounts as provider-verified', () => {
    expect(verificationSourceInit).toContain("user.authProvider === 'facebook'");
    expect(verificationSourceInit).toContain("['google', 'facebook'].includes(signupMethod(user))");
  });
});
