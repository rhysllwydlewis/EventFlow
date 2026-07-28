'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/partner-init.js'),
  'utf8'
);

test('partner signup keeps unverified users on the entry page with verification instructions', () => {
  expect(source).toContain('if (data.requiresVerification)');
  expect(source).toContain('Check your email to verify your address before logging in.');
  expect(source).not.toContain(
    "showStatus(status, '✓ Account created! Redirecting to your dashboard…', 'success')"
  );
});

test('partner signup does not navigate directly to the dashboard after account creation', () => {
  const signupSection = source.slice(source.indexOf('function initSignupForm()'));
  expect(signupSection).not.toContain(
    "setTimeout(() => window.location.replace('/partner/dashboard')"
  );
});
