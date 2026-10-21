'use strict';

/**
 * Loads the sign-in redirect code from public/assets/js/app.js itself, so tests exercise the code
 * that ships and not a copy of it. The browser file is not a module, so the two declarations are cut
 * out of it by their markers and run against a stand-in `window.location`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJs = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');

/**
 * @param {string} [origin] - The page's origin
 * @returns {{safeRedirectTarget: Function, allowedPaths: Object}} The real helper and allowlist
 */
function loadAppRedirect(origin = 'https://event-flow.co.uk') {
  const start = appJs.indexOf('const REDIRECT_ALLOWED_PATHS');
  const end = appJs.indexOf('// Shared banner used by explicit page actions');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('The redirect code was not found in app.js');
  }
  const context = vm.createContext({
    window: { location: { origin } },
    URL,
    URLSearchParams,
  });
  vm.runInContext(
    `${appJs.slice(start, end)}\nthis.safeRedirectTarget = safeRedirectTarget;\nthis.allowedPaths = REDIRECT_ALLOWED_PATHS;`,
    context
  );
  return { safeRedirectTarget: context.safeRedirectTarget, allowedPaths: context.allowedPaths };
}

module.exports = { loadAppRedirect, appJs };
