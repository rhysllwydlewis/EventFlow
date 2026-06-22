(function initCsrfTokenHelper(globalScope) {
  'use strict';

  function readCookie(name) {
    if (!name || typeof document === 'undefined') return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getCsrfToken() {
    if (
      globalScope &&
      typeof globalScope.__CSRF_TOKEN__ === 'string' &&
      globalScope.__CSRF_TOKEN__
    ) {
      return globalScope.__CSRF_TOKEN__;
    }
    return readCookie('csrf') || readCookie('csrfToken') || '';
  }

  const api = { get: getCsrfToken, readCookie };

  if (globalScope) {
    globalScope.EventFlowCsrf = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
