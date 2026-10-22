'use strict';

/**
 * app.js remembers a dismissed welcome card only when the visitor has allowed functional storage
 * (it is a remembered preference). app.js is not a module, so the function is cut out of the source
 * and run with a stand-in window.
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

  it('allows it when functional storage was accepted', () => {
    expect(mayRemember({ CookieConsent: { getConsent: () => ({ functional: true }) } })).toBe(true);
  });

  it.each([{ functional: false }, {}, null])('refuses it for the choice %j', choice => {
    expect(mayRemember({ CookieConsent: { getConsent: () => choice } })).toBe(false);
  });

  it('refuses it when the consent check throws', () => {
    const consent = {
      getConsent() {
        throw new Error('boom');
      },
    };
    expect(mayRemember({ CookieConsent: consent })).toBe(false);
  });

  it('keeps it when there is no consent banner on the page (no choice to follow)', () => {
    expect(mayRemember({})).toBe(true);
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
