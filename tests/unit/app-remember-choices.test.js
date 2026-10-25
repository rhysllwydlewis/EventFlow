'use strict';

/**
 * app.js remembers a dismissed welcome card only when the shared check
 * (utils/auth-state.js, efMayKeepFunctionalStorage) allows it. app.js is not a module, so the
 * function is cut out of the source and run with a stand-in window.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
const start = source.indexOf('function efMayRememberChoices()');
const end = source.indexOf('\nfunction efMaybeShowOnboarding');
const fnSource = source.slice(start, end);

function mayRemember(window) {
  const context = vm.createContext({ window });
  vm.runInContext(`${fnSource}\nthis.result = efMayRememberChoices();`, context);
  return context.result;
}

describe('efMayRememberChoices', () => {
  it('is found in app.js', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  // The rule itself (consent accepted / declined / not asked yet / no banner) lives in
  // utils/auth-state.js and is tested against the real script in the customer-dashboard-resilience
  // suite; app.js only asks it.
  it('asks the shared check and returns its answer', () => {
    expect(mayRemember({ efMayKeepFunctionalStorage: () => true })).toBe(true);
    expect(mayRemember({ efMayKeepFunctionalStorage: () => false })).toBe(false);
  });

  it('remembers nothing on a page that does not load the shared check', () => {
    expect(mayRemember({})).toBe(false);
  });

  it('has no copy of the consent rule of its own', () => {
    expect(fnSource).not.toMatch(/CookieConsent|getConsent/);
  });

  it('is what gates both writes', () => {
    expect(source).toMatch(
      /if \(efMayRememberChoices\(\)\) \{\s*localStorage\.setItem\('ef_onboarding_dismissed'/
    );
    expect(source).toMatch(
      /if \(efMayRememberChoices\(\)\) \{\s*localStorage\.setItem\('eventflow_onboarding_new'/
    );
  });
});
