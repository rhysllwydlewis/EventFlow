(function () {
  'use strict';

  const COOKIE_NAME = 'eventflow_cookie_consent';
  const EXPIRY_DAYS = 365;

  function writeFullConsent() {
    const value = encodeURIComponent(
      JSON.stringify({
        v: 1,
        essential: true,
        functional: true,
        analytics: true,
      })
    );
    const expires = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toUTCString();
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; expires=${expires}; path=/; SameSite=Lax${secure}`;
    window.dispatchEvent(
      new CustomEvent('cookieConsentChanged', {
        detail: {
          accepted: true,
          essential: true,
          functional: true,
          analytics: true,
        },
      })
    );
  }

  function upgradeConsentCopy(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.cookie-consent-message p').forEach(paragraph => {
      if (paragraph.textContent && paragraph.textContent.includes('functional cookies')) {
        paragraph.textContent =
          'We use essential cookies to make our site work. With your consent, we also use functional cookies to remember preferences and analytics cookies to understand page engagement and improve EventFlow. You can change these choices at any time.';
      }
    });
    scope.querySelectorAll('.cookie-prefs-category-desc').forEach(description => {
      if (description.textContent && description.textContent.includes('Currently unused')) {
        description.textContent =
          'Help us understand page engagement, journeys and website performance. Analytics only runs after you consent.';
      }
    });
  }

  document.addEventListener(
    'click',
    event => {
      const target = event.target && event.target.closest
        ? event.target.closest('#cookie-consent-accept, #cookie-prefs-accept-all')
        : null;
      if (!target) {
        return;
      }
      // The legacy handler runs during the same click and writes analytics:false.
      // Apply the corrected full-consent value immediately afterwards.
      window.setTimeout(writeFullConsent, 0);
    },
    true
  );

  function init() {
    upgradeConsentCopy(document);
    if (typeof MutationObserver !== 'function' || !document.body) {
      return;
    }
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node && node.nodeType === 1) {
            upgradeConsentCopy(node);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();